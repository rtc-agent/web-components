import {
  Session,
  Turn,
  Message,
  Rtc,
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
  Update, SendMessageRequest, ForkSessionRequest,
} from '@rtc-agent/protocol';

// ========== 连接状态 ==========

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface ConnectionStateEvent {
  state: ConnectionState;
  reason?: string;
}

// ========== 流式 chunk ==========

export interface StreamChunk {
  session_id: string; // UUID
  message_id: string; // UUID
  content: string; // 增量 chunk 内容
}

export interface StreamStart {
  session_id: string; // UUID
  message_id: string; // UUID
}

export interface StreamEnd {
  session_id: string; // UUID
  message_id: string; // UUID
  final_content: string; // 聚合后的完整内容
}

// ========== Client 配置 ==========

/** Token 失效时的处理动作 */
export type TokenExpiredAction = 'refresh' | 'relogin';

/** 频道消息事件（统一转发给调用方） */
export interface PublicationEvent {
  /** 频道名称，如 'topic:u=123' 或 'live:u=123' */
  channel: string;
  /** 消息的 offset（仅 topic 频道有，严格 +1 连续） */
  offset?: number;
  /** 消息的数据 */
  data: unknown;
}

export interface RTCAgentClientOptions {
  /** Centrifuge WebSocket 端点，如 'wss://api.example.com/connection' */
  endpoint: string;
  /** 返回当前 JWT（可以是异步，client 会在需要时调用） */
  getToken: () => string | Promise<string>;
  /** 可选：设备 ID，不提供则使用 localStorage 中持久化的 UUID */
  deviceId?: string;
  /** 可选：用户 ID（UUID 字符串），用于订阅 user_updates */
  userId?: string;
  /** 可选：连接状态变化回调 */
  onConnectionStateChange?: (event: ConnectionStateEvent) => void;
  /**
   * 可选：Token 失效时的回调
   *
   * - 返回 'refresh'：已刷新 token，客户端继续重连
   * - 返回 'relogin'：需要重新登录，客户端停止重连，等待调用 reconnect()
   *
   * 如果不提供此回调，token 失效时会继续调用 getToken，可能导致无限重试
   */
  onTokenExpired?: () => Promise<TokenExpiredAction> | TokenExpiredAction;
  /**
   * 可选：获取当前已处理的 offset 和 epoch（由调用方提供，仅用于 topic 频道）
   *
   * - client 在订阅时调用，用于恢复时指定起始位置
   * - 返回 undefined 表示从头开始
   * - 调用方负责持久化 offset/epoch（例如在 onPublication 中更新）
   * - 可以是同步或异步（支持 IndexedDB 等异步存储）
   *
   * @param channel 频道名称，如 'topic:u=xxx'
   */
  getLastOffset?: (channel: string) => Promise<{ offset: number; epoch: string } | undefined> | { offset: number; epoch: string } | undefined;
  /**
   * 可选：更新 offset 和 epoch（由调用方持久化）
   *
   * @param channel 频道名称
   * @param offset 新的 offset
   * @param epoch 新的 epoch
   */
  updateOffset?: (channel: string, offset: number, epoch: string) => Promise<void> | void;
  /**
   * 可选：频道消息回调（所有频道的消息都通过此回调转发）
   *
   * - 必须 await，保证顺序处理
   * - topic 频道的消息 offset 保证严格 +1 连续（client 内部自动补全历史）
   * - 如果抛出异常，断开订阅（崩溃语义）
   * - 调用方根据 channel 前缀（topic:/live:）决定处理逻辑
   */
  onPublication?: (event: PublicationEvent) => Promise<void> | void;
}

// ========== 事件映射 ==========

export interface RTCAgentClientEvents {
  connection: ConnectionStateEvent;
  /** 后端通过 user_updates 频道推送的事件（多设备同步） */
  update: Update;
  /** 流式消息开始 */
  'stream:start': StreamStart;
  /** 流式消息 chunk */
  'stream:chunk': StreamChunk;
  /** 流式消息结束（已聚合完整内容） */
  'stream:end': StreamEnd;
  /** 错误 */
  error: Error;
}

export type EventName = keyof RTCAgentClientEvents;
export type EventCallback<E extends EventName> = (payload: RTCAgentClientEvents[E]) => void;

export interface Unsubscribe {
  (): void;
}

// ========== Client 接口 ==========

/**
 * RTCAgentClient 的公共接口。
 *
 * e2e 测试可以实现该接口作为 Fake Client，或在测试中 mock 它。
 * 组件层只依赖这个接口，不直接依赖 Centrifuge。
 *
 * 注意：所有 ID 参数均为 UUID 字符串，与 protocol 定义保持一致。
 */
export interface IRTCAgentClient {
  // 生命周期
  connect(): Promise<void>;
  disconnect(): void;
  /** 重新连接（用于重新登录后恢复连接） */
  reconnect(): Promise<void>;
  getConnectionState(): ConnectionState;
  /** 获取当前用户 ID */
  getUserId(): string | undefined;

  // 会话
  listSessions(cursor?: string, limit?: number): Promise<ListSessionsResponse>;
  getSession(sessionId: string): Promise<GetSessionResponse>;
  closeSession(sessionId: string): Promise<CloseSessionResponse>;
  forkSession(req: ForkSessionRequest): Promise<ForkSessionResponse>;

  // 消息 & Turn
  sendMessage(req: SendMessageRequest): Promise<SendMessageResponse>;
  stopTurn(turnId: string): Promise<StopTurnResponse>;
  listMessages(sessionId: string, cursor?: number, limit?: number): Promise<MessageListResponse>;
  listTurns(sessionId: string, cursor?: string, limit?: number): Promise<TurnListResponse>;

  // RTC (Tool 调用)
  listRtc(sessionId: string, cursor?: string, limit?: number): Promise<RtcListResponse>;
  updateRtcStatus(rtcId: string, status: string): Promise<UpdateRtcStatusResponse>;
  submitRtcResult(
    rtcId: string,
    success: boolean,
    result?: unknown,
    error?: string,
  ): Promise<SubmitRtcResultResponse>;

  // 事件
  on<E extends EventName>(event: E, cb: EventCallback<E>): Unsubscribe;

  // Updates 处理
  /**
   * 处理 Updates（包含连续性检测 + 历史补全 + 串行化）
   *
   * Publication 和 RPC 响应都应该调用此方法
   */
  applyUpdates(updates: Update[]): Promise<void>;
}

// 重新导出 protocol 类型，方便组件层一次性 import
export type { Session, Turn, Message, Rtc, Update };
