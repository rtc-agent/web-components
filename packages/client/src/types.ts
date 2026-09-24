import type {
  Session,
  Turn,
  Message,
  Rtc,
  Update,
  ListSessionsResponse,
  MessageListResponse,
  TurnListResponse,
  RtcListResponse,
  GetSessionResponse,
  SendMessageResponse,
  SendMessageRequest,
  ForkSessionResponse,
  ForkSessionRequest,
  CloseSessionResponse,
  OpenSessionResponse,
  StopTurnResponse,
  SubmitRtcResultResponse,
  UpdateRtcStatusResponse,
  CompactSessionRequest,
  CompactSessionResponse,
} from '@rtc-agent/protocol';

// ========== Connection State ==========

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface ConnectionStateEvent {
  state: ConnectionState;
  reason?: string;
}

// ========== Streaming Chunks ==========

export interface StreamChunk {
  session_id: string; // UUID
  message_id: string; // UUID
  content: string; // Incremental chunk content
}

export interface StreamStart {
  session_id: string; // UUID
  message_id: string; // UUID
}

export interface StreamEnd {
  session_id: string; // UUID
  message_id: string; // UUID
  final_content: string; // Aggregated full content
}

// ========== Client Configuration ==========

/** Action to take when a token expires. */
export type TokenExpiredAction = 'refresh' | 'relogin';

/** Channel publication event (forwarded uniformly to callers). */
export interface PublicationEvent {
  /** Channel name, e.g. 'topic:u=123' or 'live:u=123'. */
  channel: string;
  /** Message offset (topic channel only, strictly +1 continuous). */
  offset?: number;
  /** Message data payload. */
  data: unknown;
}

export interface RTCAgentClientOptions {
  /** Centrifuge WebSocket endpoint, e.g. 'wss://api.example.com/connection'. */
  endpoint: string;
  /** Returns the current JWT (may be async; client calls it on demand). */
  getToken: () => string | Promise<string>;
  /** Optional: device ID; falls back to a UUID persisted in localStorage. */
  deviceId?: string;
  /** Optional: user ID (UUID string) for subscribing to user_updates. */
  userId?: string;
  /** Optional: connection state change callback. */
  onConnectionStateChange?: (event: ConnectionStateEvent) => void;
  /**
   * Optional: callback when a token expires.
   *
   * - Return 'refresh': token has been refreshed, client continues reconnecting.
   * - Return 'relogin': user must re-login, client stops reconnecting until reconnect() is called.
   *
   * If not provided, getToken will keep being called on expiry, potentially causing infinite retries.
   */
  onTokenExpired?: () => Promise<TokenExpiredAction> | TokenExpiredAction;
  /**
   * Optional: retrieve the last processed offset and epoch (caller-provided, topic channel only).
   *
   * - Client calls this on subscribe to set the starting position for recovery.
   * - Return undefined to start from the beginning.
   * - Caller is responsible for persisting offset/epoch (e.g. in onPublication).
   * - Can be sync or async (supports async stores like IndexedDB).
   *
   * @param channel Channel name, e.g. 'topic:u=xxx'
   */
  getLastOffset?: (channel: string) => Promise<{ offset: number; epoch: string } | undefined> | { offset: number; epoch: string } | undefined;
  /**
   * Optional: persist the offset and epoch after processing.
   *
   * @param channel Channel name
   * @param offset New offset
   * @param epoch New epoch
   */
  updateOffset?: (channel: string, offset: number, epoch: string) => Promise<void> | void;
  /**
   * Optional: channel publication callback (messages from all channels are forwarded here).
   *
   * - Must be awaited to guarantee ordered processing.
   * - Topic channel messages guarantee strict +1 offset continuity (client fills gaps internally).
   * - If this throws, the subscription is cancelled (crash semantics).
   * - Caller branches on channel prefix (topic:/live:) to decide processing logic.
   */
  onPublication?: (event: PublicationEvent) => Promise<void> | void;
  /**
   * Optional: suspend UI update bus before batch operations (e.g., gap fill).
   * When suspended, UI events are collected but not dispatched until resumeUIUpdates is called.
   * This prevents UI thrashing when processing large batches of historical updates.
   */
  suspendUIUpdates?: () => void;
  /**
   * Optional: resume UI update bus after batch operations.
   * Triggers a bulk-update event so UI can reload data.
   */
  resumeUIUpdates?: () => void;
  /**
   * Optional: called when gap fill starts (for large gaps).
   * UI can show a syncing overlay to indicate background sync is in progress.
   */
  onGapFillStart?: () => void;
  /**
   * Optional: called when gap fill completes or fails.
   * UI can hide the syncing overlay.
   */
  onGapFillEnd?: () => void;
}

// ========== Event Map ==========

/** Emitted when gap fill fails and application-level sync is required. */
export interface SyncRequiredEvent {
  reason: string;
  lastKnownOffset?: number;
  serverOffset?: number;
}

export interface RTCAgentClientEvents {
  connection: ConnectionStateEvent;
  /** Events pushed by the backend via user_updates channel (multi-device sync). */
  update: Update;
  /** Stream message started. */
  'stream:start': StreamStart;
  /** Stream message chunk. */
  'stream:chunk': StreamChunk;
  /** Stream message ended (aggregated full content available). */
  'stream:end': StreamEnd;
  /** Error event. */
  error: Error;
  /** Gap fill failed — application must perform full sync. */
  syncRequired: SyncRequiredEvent;
}

export type EventName = keyof RTCAgentClientEvents;
export type EventCallback<E extends EventName> = (payload: RTCAgentClientEvents[E]) => void;

export interface Unsubscribe {
  (): void;
}

// ========== Client Interface ==========

/**
 * Public interface for RTCAgentClient.
 *
 * E2E tests can implement this as a fake client, or mock it in unit tests.
 * The component layer depends only on this interface, never on Centrifuge directly.
 *
 * Note: all ID parameters are UUID strings, consistent with protocol definitions.
 */
export interface IRTCAgentClient {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): void;
  /** Reconnect (e.g. after re-login to restore the connection). */
  reconnect(): Promise<void>;
  getConnectionState(): ConnectionState;
  /** Get the current user ID. */
  getUserId(): string | undefined;

  // Sessions
  listSessions(cursor?: string, limit?: number): Promise<ListSessionsResponse>;
  getSession(sessionId: string): Promise<GetSessionResponse>;
  closeSession(sessionId: string): Promise<CloseSessionResponse>;
  openSession(sessionId: string): Promise<OpenSessionResponse>;
  forkSession(req: ForkSessionRequest): Promise<ForkSessionResponse>;
  compactSession(req: CompactSessionRequest): Promise<CompactSessionResponse>;

  // Messages & Turns
  sendMessage(req: SendMessageRequest): Promise<SendMessageResponse>;
  stopTurn(turnId: string): Promise<StopTurnResponse>;
  listMessages(sessionId: string, cursor?: number, limit?: number): Promise<MessageListResponse>;
  listTurns(sessionId: string, cursor?: string, limit?: number): Promise<TurnListResponse>;

  // RTC (Tool Calls)
  listRtc(sessionId: string, cursor?: string, limit?: number): Promise<RtcListResponse>;
  updateRtcStatus(rtcId: string, status: string): Promise<UpdateRtcStatusResponse>;
  submitRtcResult(
    rtcId: string,
    success: boolean,
    result?: unknown,
    error?: string,
  ): Promise<SubmitRtcResultResponse>;

  // Events
  on<E extends EventName>(event: E, cb: EventCallback<E>): Unsubscribe;

  // Updates Processing
  /**
   * Process updates with continuity detection + gap fill + serialisation.
   *
   * Both Publication events and RPC responses should call this method.
   */
  applyUpdates(updates: Update[], callback?: () => Promise<void>): Promise<void>;
}

// Re-export protocol types for single-import convenience.
export type { Session, Turn, Message, Rtc, Update };
