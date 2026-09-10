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
  CompactSessionRequest,
  CompactSessionResponse,
  UpdateSessionRequest,
  UpdateSessionResponse,
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
  /** 是否曾经连接成功过（用于区分首次连接和重连） */
  private wasConnected = false;
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
    console.log('[RTCAgentClient] connect() called, current state:', this.connectionState);
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      console.log('[RTCAgentClient] connect() early return, already', this.connectionState);
      return;
    }
    this.shouldReconnect = true;
    this.setConnectionState('connecting');

    this.centrifuge = new Centrifuge(this.options.endpoint, {
      getToken: async () => {
        const token = await this.options.getToken();

        // 仅当 token 确实过期时才触发刷新回调，避免每次重连都触发 HTTP 请求
        if (this._isTokenExpired(token) && this.options.onTokenExpired) {
          const action: TokenExpiredAction = await this.options.onTokenExpired();
          if (action === 'relogin') {
            // 需要重新登录，停止重连
            this.shouldReconnect = false;
            this.centrifuge?.disconnect();
            this.setConnectionState('disconnected', 'token expired, relogin required');
            throw new Error('Token expired, user needs to re-login');
          }
          // action === 'refresh'，刷新成功，重新获取 token
          return this.options.getToken();
        }

        return token;
      },
    });

    this.centrifuge.on('connecting', (ctx) => {
      // 如果不应该重连（如 token 失效需要重新登录），阻止连接
      if (!this.shouldReconnect) {
        this.centrifuge?.disconnect();
        return;
      }
      // 区分首次连接和重连（Issue 2）
      const state = this.wasConnected ? 'reconnecting' : 'connecting';
      this.setConnectionState(state, ctx?.reason);
    });
    this.centrifuge.on('connected', () => {
      console.log('[RTCAgentClient] centrifuge connected, setting state to connected');
      this.wasConnected = true;
      this.setConnectionState('connected');
      this.subscribeChannels();
    });
    this.centrifuge.on('disconnected', (ctx) => {
      console.log('[RTCAgentClient] centrifuge disconnected, reason:', ctx?.reason);
      this.setConnectionState('disconnected', ctx?.reason);
    });
    this.centrifuge.on('error', (ctx) => {
      console.error('[RTCAgentClient] centrifuge error:', ctx?.error);
      this.emit('error', new Error(ctx?.error?.message ?? 'centrifuge error'));
    });

    console.log('[RTCAgentClient] calling centrifuge.connect() synchronously');
    this.centrifuge.connect();
    console.log('[RTCAgentClient] centrifuge.connect() returned, state:', this.connectionState, '(WebSocket not yet established)');
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.wasConnected = false;
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

  async compactSession(
    req: CompactSessionRequest,
  ): Promise<CompactSessionResponse> {
    return this.rpc<CompactSessionResponse>(RpcMethod.SessionCompact, req);
  }

  async updateSession(
    req: UpdateSessionRequest,
  ): Promise<UpdateSessionResponse> {
    return this.rpc<UpdateSessionResponse>(RpcMethod.SessionUpdate, req);
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
    // 串行化：将当前任务链到上一次任务之后。
    // 关键：必须 await previousPromise，否则并发调用会同时执行 processUpdate，
    // 导致 offset 跳跃检测失效（两次调用看到相同的 lastOffset，都跳过 gap fill）。
    let previousPromise = this.applyUpdatesQueue;

    const currentPromise = (async () => {
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
      // 清理队列引用：仅当当前任务仍是队尾时才清空，
      // 避免清空后来者排入的任务。
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

        // 补全后再次检查：fillOffsetGap 是否成功将 offset 推进到 update.offset - 1
        const newPosition = await this.options.getLastOffset?.(channel);
        const newLastOffset = newPosition?.offset;
        const newLastEpoch = newPosition?.epoch;

        // 同时验证 offset 和 epoch：
        // - offset 必须达到 update.offset - 1（保证连续性）
        // - epoch 必须与预期一致（防止服务端重启后 epoch 变更导致数据错乱）
        const expectedEpoch = this.epochCache.get(channel) ?? '';
        if (newLastOffset === undefined || newLastOffset !== update.offset - 1) {
          // 补全失败，拒绝执行当前 update，保持 offset 不连续的安全性
          throw new Error(
            `[RTCAgentClient] Offset gap fill failed: expected ${update.offset - 1}, got ${newLastOffset}. ` +
            `Rejecting update ${update.offset} to maintain strict +1 continuity.`
          );
        }
        if (newLastEpoch !== undefined && newLastEpoch !== expectedEpoch) {
          // epoch 变更（服务端可能重启），拒绝执行并通知调用方
          throw new Error(
            `[RTCAgentClient] Epoch mismatch after gap fill: expected '${expectedEpoch}', got '${newLastEpoch}'. ` +
            `Rejecting update ${update.offset} to prevent data corruption.`
          );
        }
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
    console.log('[RTCAgentClient] setConnectionState:', state, 'reason:', reason, 'previous:', this.connectionState);
    if (this.connectionState === state) return;
    this.connectionState = state;
    const event: ConnectionStateEvent = { state, reason };
    this.emit('connection', event);
    this.options.onConnectionStateChange?.(event);
  }

  /**
   * 检查 JWT 是否已过期
   *
   * 解析 JWT payload 中的 exp 字段（Unix 时间戳，秒），
   * 与当前时间比较。解析失败时返回 false（不阻止连接）。
   */
  private _isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(atob(parts[1]));
      if (typeof payload.exp !== 'number') return false;
      return payload.exp * 1000 < Date.now();
    } catch {
      // JWT 解析失败，不阻止连接
      return false;
    }
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
        // applyUpdates 可能抛出异常（如 gap fill 失败），必须 catch 防止 unhandled rejection。
        // 异常意味着 offset 连续性被破坏，后续消息将无法处理，需要重新连接或重置 offset。
        try {
          await this.applyUpdates([update]);
        } catch (err) {
          console.error(
            `[RTCAgentClient] applyUpdates failed for offset ${update.offset} on channel ${topicChannel}:`,
            err,
          );
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      });

      topicSub.on('subscribed', async (ctx) => {
        // 订阅成功时，检测 offset 连续性，防止离线消息丢失
        if (ctx.streamPosition) {
          const epoch = ctx.streamPosition.epoch;
          const serverOffset = ctx.streamPosition.offset;

          // 先更新 epoch 缓存（无论 offset 是否变化，epoch 都需要同步）
          this.epochCache.set(topicChannel, epoch);

          // 检测 offset 连续性
          const position = await this.options.getLastOffset?.(topicChannel);
          const localOffset = position?.offset;

          if (localOffset === undefined) {
            // 本地没有记录（首次订阅），直接使用服务器 offset
            await this.options.updateOffset?.(topicChannel, serverOffset, epoch);
          } else if (serverOffset <= localOffset) {
            // 服务器 offset <= 本地 offset：重复订阅或回退，保持不变
            // 不覆盖，避免回退导致后续消息被重复处理
          } else {
            // serverOffset > localOffset：存在间隙（包括 +1 的情况），补全历史
            // 注意：serverOffset === localOffset + 1 时，表示服务器有一条新消息（offset=serverOffset）
            // 客户端还没收到，也需要补全
            const lastEpoch = position?.epoch ?? this.epochCache.get(topicChannel) ?? '';
            try {
              // 补全范围：(localOffset, serverOffset]，即 localOffset+1 到 serverOffset
              // fillOffsetGap 的 toOffset 参数是不包含的，所以传 serverOffset + 1
              await this.fillOffsetGap(topicChannel, localOffset, lastEpoch, serverOffset + 1);

              // 补全后验证：offset 应该推进到 serverOffset
              const newPosition = await this.options.getLastOffset?.(topicChannel);
              const newOffset = newPosition?.offset;
              const newEpoch = newPosition?.epoch;

              if (newOffset === undefined || newOffset !== serverOffset) {
                throw new Error(
                  `[RTCAgentClient] Offset gap fill failed on subscribe: expected ${serverOffset}, got ${newOffset}. ` +
                  `Offline updates may be lost.`
                );
              }
              if (newEpoch !== undefined && newEpoch !== epoch) {
                throw new Error(
                  `[RTCAgentClient] Epoch mismatch after gap fill on subscribe: expected '${epoch}', got '${newEpoch}'. ` +
                  `Server may have restarted.`
                );
              }

              // 补全成功，更新到最新 offset
              await this.options.updateOffset?.(topicChannel, serverOffset, epoch);
            } catch (err) {
              console.error(
                `[RTCAgentClient] fillOffsetGap failed on subscribe for offset ${serverOffset}:`,
                err,
              );
              this.emit('error', err instanceof Error ? err : new Error(String(err)));
              // 注意：即使补全失败，epoch 已更新到缓存（已在上面完成）
              // 但不更新 offset，保持不连续状态，后续 publication 会再次尝试补全或报错
            }
          }
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
      // 重新抛出错误，让调用方（processUpdate）知道补全失败
      // 调用方会拒绝执行后续 update，保证 offset 严格 +1 连续性
      console.error(`[RTCAgentClient] fillOffsetGap failed for channel ${channel}:`, err);
      throw err;
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
