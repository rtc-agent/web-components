import {Centrifuge, HistoryOptions} from 'centrifuge';
import {RpcMethod, SendMessageRequest, ForkSessionRequest, Update} from '@rtc-agent/protocol';
import type {
  ListSessionsResponse,
  MessageListResponse,
  TurnListResponse,
  RtcListResponse,
  GetSessionResponse,
  SendMessageResponse,
  ForkSessionResponse,
  CloseSessionResponse,
  StopTurnResponse,
  SubmitRtcResultResponse,
  UpdateRtcStatusResponse,
} from '@rtc-agent/protocol';
import type {
  IRTCAgentClient,
  RTCAgentClientOptions,
  ConnectionState,
  ConnectionStateEvent,
  EventName,
  EventCallback,
  Unsubscribe,
  RTCAgentClientEvents,
  TokenExpiredAction,
  PublicationEvent,
} from './types.js';

/**
 * Centrifuge 实现的 RTCAgentClient。
 *
 * 职责：
 * - 管理 Centrifuge WebSocket 连接
 * - 封装所有 RPC 调用（会话、消息、Turn、RTC）
 * - 订阅 Topic 频道（topic:u={userId}）接收 Update 事件，支持离线恢复
 * - 订阅 Live 频道（live:u={userId}）接收流式消息，不支持恢复
 * - 处理 Token 失效：支持自动刷新或停止重连等待重新登录
 */
export class RTCAgentClient implements IRTCAgentClient {
  private readonly options: RTCAgentClientOptions;
  private centrifuge: Centrifuge | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private readonly listeners = new Map<EventName, Set<EventCallback<EventName>>>();
  /** 是否应该继续重连（token 失效时可能被设为 false） */
  private shouldReconnect = true;
  /** Updates 处理串行化队列 */
  private applyUpdatesQueue: Promise<void> | null = null;
  /** 缓存的订阅对象 */
  private readonly subscriptions = new Map<string, ReturnType<Centrifuge['newSubscription']>>();
  /** 缓存的 epoch（按频道） */
  private readonly epochCache = new Map<string, string>();

  constructor(options: RTCAgentClientOptions) {
    this.options = options;
  }

  // ========== 生命周期 ==========

  async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }
    this.shouldReconnect = true;
    this.setConnectionState('connecting');

    console.log('[RTCAgentClient] connect() → endpoint:', this.options.endpoint);

    this.centrifuge = new Centrifuge(this.options.endpoint, {
      getToken: async () => {
        console.log('[RTCAgentClient] getToken callback invoked');
        // 检查是否需要处理 token 失效
        if (this.options.onTokenExpired) {
          const action: TokenExpiredAction = await this.options.onTokenExpired();
          if (action === 'relogin') {
            // 需要重新登录，停止重连
            this.shouldReconnect = false;
            this.centrifuge?.disconnect();
            this.setConnectionState('disconnected', 'token expired, relogin required');
            throw new Error('Token expired, user needs to re-login');
          }
          // action === 'refresh'，继续获取新 token
        }
        const token = await this.options.getToken();
        // 安全规范：token 不在日志中打印，仅记录是否存在
        console.log('[RTCAgentClient] getToken returning token:', token ? 'present' : 'UNDEFINED');
        return token;
      },
    });

    this.centrifuge.on('connecting', (ctx) => {
      // 如果不应该重连（如 token 失效需要重新登录），阻止连接
      if (!this.shouldReconnect) {
        this.centrifuge?.disconnect();
        return;
      }
      this.setConnectionState('connecting', ctx?.reason);
    });
    this.centrifuge.on('connected', () => {
      this.setConnectionState('connected');
      this.subscribeChannels();
    });
    this.centrifuge.on('disconnected', (ctx) => {
      this.setConnectionState('disconnected', ctx?.reason);
    });
    this.centrifuge.on('error', (ctx) => {
      this.emit('error', new Error(ctx?.error?.message ?? 'centrifuge error'));
    });

    this.centrifuge.connect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.centrifuge?.disconnect();
    this.centrifuge = null;
    // 清理旧订阅：它们绑定在已销毁的 Centrifuge 实例上，重连时需重建
    this.subscriptions.clear();
    this.setConnectionState('disconnected');
  }

  async reconnect(): Promise<void> {
    this.disconnect();
    await this.connect();
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * 获取当前用户 ID
   */
  getUserId(): string | undefined {
    return this.options.userId;
  }

  // ========== 会话 ==========

  async listSessions(cursor?: string, limit?: number): Promise<ListSessionsResponse> {
    return this.rpc<ListSessionsResponse>(RpcMethod.SessionList, { cursor, limit });
  }

  async getSession(sessionId: string): Promise<GetSessionResponse> {
    return this.rpc<GetSessionResponse>(RpcMethod.SessionGet, { session_id: sessionId });
  }

  async closeSession(sessionId: string): Promise<CloseSessionResponse> {
    return this.rpc<CloseSessionResponse>(RpcMethod.SessionClose, { session_id: sessionId });
  }

  // ========== 消息 & Turn ==========

  /**
   * 发送消息
   *
   * @param req - SendMessageRequest，其中 client_id 用于服务端幂等去重
   */
  async sendMessage(
    req: SendMessageRequest,
  ): Promise<SendMessageResponse> {
    return this.rpc<SendMessageResponse>(RpcMethod.MessageSend, req);
  }

  async forkSession(
    req: ForkSessionRequest,
  ): Promise<ForkSessionResponse> {
    return this.rpc<ForkSessionResponse>(RpcMethod.SessionFork, req);
  }

  async stopTurn(server_session_id: string): Promise<StopTurnResponse> {
    return this.rpc<StopTurnResponse>(RpcMethod.TurnStop, { session_id: server_session_id });
  }

  async listMessages(
    sessionId: string,
    cursor?: number,
    limit?: number,
  ): Promise<MessageListResponse> {
    return this.rpc<MessageListResponse>(RpcMethod.MessageList, {
      session_id: sessionId,
      cursor,
      limit,
    });
  }

  async listTurns(
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<TurnListResponse> {
    return this.rpc<TurnListResponse>(RpcMethod.TurnList, {
      session_id: sessionId,
      cursor,
      limit,
    });
  }

  // ========== RTC (Tool 调用) ==========

  async listRtc(
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<RtcListResponse> {
    return this.rpc<RtcListResponse>(RpcMethod.RtcList, {
      session_id: sessionId,
      cursor,
      limit,
    });
  }

  async updateRtcStatus(rtcId: string, status: string): Promise<UpdateRtcStatusResponse> {
    return this.rpc<UpdateRtcStatusResponse>(RpcMethod.RtcUpdateStatus, {
      rtc_id: rtcId,
      status,
    });
  }

  async submitRtcResult(
    rtcId: string,
    success: boolean,
    result?: unknown,
    error?: string,
  ): Promise<SubmitRtcResultResponse> {
    return this.rpc<SubmitRtcResultResponse>(RpcMethod.RtcSubmitResult, {
      rtc_id: rtcId,
      success,
      result,
      error,
    });
  }

  // ========== Updates 处理 ==========

  /**
   * 处理 Updates（包含连续性检测 + 历史补全 + 串行化）
   *
   * Publication 和 RPC 响应都应该调用此方法。
   * 保证串行执行，同时只有一个 applyUpdates 在运行。
   */
  async applyUpdates(updates: Update[]): Promise<void> {
    // 串行化：等待上一次完成
    const previousPromise = this.applyUpdatesQueue;

    const currentPromise = (async () => {
      // 等待上一次完成（如果有）
      if (previousPromise) {
        await previousPromise;
      }

      for (const update of updates) {
        await this.processUpdate(update);
      }
    })();

    this.applyUpdatesQueue = currentPromise;

    try {
      await currentPromise;
    } finally {
      // 清理队列引用
      if (this.applyUpdatesQueue === currentPromise) {
        this.applyUpdatesQueue = null;
      }
    }
  }

  /**
   * 处理单个 Update（内部方法）
   */
  private async processUpdate(update: Update): Promise<void> {
    const channel = `topic:u=${this.options.userId}`;

    if (update.offset > 0) {
      // Topic 频道：检测连续性
      const position = await this.options.getLastOffset?.(channel);
      const lastOffset = position?.offset;
      const lastEpoch = position?.epoch ?? this.epochCache.get(channel) ?? '';

      if (lastOffset !== undefined && update.offset > lastOffset + 1) {
        // 有跳跃，补全历史
        await this.fillOffsetGap(channel, lastOffset, lastEpoch, update.offset);
      }
    }

    // 调用 onPublication 回调处理 update
    if (this.options.onPublication) {
      const event: PublicationEvent = {
        channel: `topic:u=${this.options.userId}`,
        offset: update.offset,
        data: update,
      };
      await this.options.onPublication(event);
    }

    // 更新 offset 和 epoch
    if (update.offset > 0) {
      // 使用缓存的 epoch（从 subscribed 事件中获取）
      const epoch = this.epochCache.get(channel) ?? '';
      await this.options.updateOffset?.(channel, update.offset, epoch);
    }
  }

  // ========== 事件 ==========

  on<E extends EventName>(event: E, cb: EventCallback<E>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as EventCallback<EventName>);
    return () => {
      set!.delete(cb as EventCallback<EventName>);
    };
  }

  // ========== 内部 ==========

  private emit<E extends EventName>(event: E, payload: RTCAgentClientEvents[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        (cb as EventCallback<E>)(payload);
      } catch (err) {
        console.error(`[RTCAgentClient] listener for '${event}' threw:`, err);
      }
    }
  }

  private setConnectionState(state: ConnectionState, reason?: string): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    const event: ConnectionStateEvent = { state, reason };
    this.emit('connection', event);
    this.options.onConnectionStateChange?.(event);
  }

  /**
   * 发送 RPC 请求到后端（通过 Centrifuge RPC 机制）。
   *
   * 当前为占位实现：真实实现应调用 centrifuge.request()。
   * TODO: 接入 Centrifuge RPC，处理错误和重试。
   */
  private async rpc<T>(method: string, payload: unknown): Promise<T> {
    if (!this.centrifuge) {
      throw new Error('RTCAgentClient not connected');
    }
    if (this.connectionState !== 'connected') {
      throw new Error(`Cannot call RPC '${method}': connection state is ${this.connectionState}`);
    }

    try {
      const result = await this.centrifuge.rpc(method, payload);
      return result.data as T;
    } catch (error) {
      console.error(`[RTCAgentClient] RPC '${method}' failed:`, error);
      throw error;
    }
  }

  /**
   * 订阅用户的 Topic 和 Live 频道。
   *
   * - Topic 频道（topic:u={userId}）：持久化，支持离线恢复
   *   - 自动检测 offset 跳跃并补全历史
   *   - 保证 onPublication 回调的 offset 严格 +1 连续
   * - Live 频道（live:u={userId}）：即发即弃，不支持恢复
   */
  private subscribeChannels(): void {
    if (!this.centrifuge || !this.options.userId) return;

    const userId = this.options.userId;

    // Topic 频道：支持离线恢复（Centrifuge 默认会处理）
    const topicChannel = `topic:u=${userId}`;
    if (!this.subscriptions.has(topicChannel)) {
      const topicSub = this.centrifuge.newSubscription(topicChannel);
      this.subscriptions.set(topicChannel, topicSub);

      topicSub.on('publication', async (ctx) => {
        // 构造 Update 对象（假设 data 是 Update 类型）
        const update = ctx.data as Update;

        // 通过 applyUpdates 统一处理（包含连续性检测 + 历史补全 + 串行化）
        await this.applyUpdates([update]);
      });

      topicSub.on('subscribed', async (ctx) => {
        // 订阅成功时，保存 epoch 到缓存和持久化存储
        if (ctx.streamPosition) {
          const epoch = ctx.streamPosition.epoch;
          const offset = ctx.streamPosition.offset;
          this.epochCache.set(topicChannel, epoch);
          await this.options.updateOffset?.(topicChannel, offset, epoch);
        }
      });
    }
    // 确保处于订阅状态（首次连接时调用；重连时 Centrifuge 会自动恢复）
    this.subscriptions.get(topicChannel)?.subscribe();

    // Live 频道：即发即弃，不恢复
    const liveChannel = `live:u=${userId}`;
    if (!this.subscriptions.has(liveChannel)) {
      const liveSub = this.centrifuge.newSubscription(liveChannel);
      this.subscriptions.set(liveChannel, liveSub);

      liveSub.on('publication', async (ctx) => {
        const event: PublicationEvent = {
          channel: liveChannel,
          data: ctx.data,
        };

        await this.handlePublication(event, liveSub);
      });
    }
    this.subscriptions.get(liveChannel)?.subscribe();
  }

  /**
   * 补全 offset 间隙的历史消息。
   *
   * @param channel 频道名称
   * @param fromOffset 起始 offset（不包含）
   * @param epoch 起始 epoch
   * @param toOffset 目标 offset（不包含），undefined 表示拉取到最新
   */
  private async fillOffsetGap(
    channel: string,
    fromOffset: number,
    epoch: string,
    toOffset?: number
  ): Promise<void> {
    const sub = this.subscriptions.get(channel);
    if (!sub) {
      console.warn(`[RTCAgentClient] fillOffsetGap: subscription not found for channel ${channel}`);
      return;
    }

    let opts: HistoryOptions = {
      since: { offset: fromOffset, epoch },
      limit: undefined,
      reverse: false, // 正序：从旧到新
    };
    if (toOffset) {
      const limit = toOffset - fromOffset - 1;
      if (limit <= 0) return;
      opts.limit = limit;
    }

    try {
      const historyResult = await sub.history(opts);

      // 按顺序处理历史消息
      for (const pub of historyResult.publications) {
        const update = pub.data as Update;
        await this.processUpdate(update);
      }
    } catch (err) {
      // 错误码 112：Unrecoverable Position Error - epoch 已变更
      // 清空本地 offset，从当前最新位置开始接收
      console.warn(`[RTCAgentClient] fillOffsetGap failed for channel ${channel}:`, err);
      // 调用方会在下次收到消息时重新检测并处理
    }
  }

  /**
   * 处理频道消息回调。
   *
   * 如果回调抛出异常，取消订阅（崩溃语义）。
   */
  private async handlePublication(
    event: PublicationEvent,
    sub: ReturnType<Centrifuge['newSubscription']>
  ): Promise<void> {
    if (!this.options.onPublication) return;

    try {
      await this.options.onPublication(event);
    } catch (err) {
      // 回调抛出异常，取消订阅
      console.error(`[RTCAgentClient] onPublication threw for channel '${event.channel}':`, err);
      sub.unsubscribe();
      throw err; // 向上抛出，让调用方知道发生了错误
    }
  }
}
