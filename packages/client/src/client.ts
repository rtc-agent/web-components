/**
 * RTC Agent Client
 *
 * WebSocket client built on Centrifuge for real-time communication with the backend.
 * Handles connection lifecycle, subscriptions (topic + live channels), message
 * scheduling with buffer deduplication, gap fill management, and reconnection logic.
 *
 * This file is intentionally large (1200+ lines) because it encapsulates the entire
 * client-side real-time protocol: connection management, subscription handling,
 * update scheduling, and gap fill logic are tightly coupled and form a cohesive
 * state machine. Splitting would scatter the protocol flow across files, making
 * it harder to reason about ordering guarantees and error recovery.
 */
import { Centrifuge, HistoryOptions } from 'centrifuge';
import {
  RPC_METHODS,
  SendMessageRequest,
  ForkSessionRequest,
  Update,
  UpdateItem,
  createLogger,
  parseJwtPayload,
} from '@rtc-agent/protocol';
import type {
  RtcStatus,
  ListSessionsResponse,
  MessageListResponse,
  TurnListResponse,
  RtcListResponse,
  GetSessionResponse,
  SendMessageResponse,
  ForkSessionResponse,
  CloseSessionResponse,
  OpenSessionResponse,
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

const log = createLogger('RTCAgentClient');

/**
 * Error thrown when gap fill operation exceeds the maximum wait time.
 *
 * RECOVERY STRATEGY: When this error occurs, the client should:
 * 1. Log the error for diagnostics (channel, targetOffset, remainingGap)
 * 2. Disconnect and reconnect the channel to trigger a fresh state sync
 * 3. If the error persists, notify the user that real-time updates may be delayed
 * 4. Consider reducing the polling interval or increasing timeout for high-latency networks
 *
 * The error contains diagnostic information to help identify the root cause:
 * - channel: The affected channel name
 * - targetOffset: The offset we were trying to reach
 * - elapsedMs: How long we waited before timing out
 * - currentOffset: The offset we actually reached
 * - remainingGap: How many events we're still missing
 */
export class GapFillTimeoutError extends Error {
  constructor(
    readonly channel: string,
    readonly targetOffset: number,
    readonly elapsedMs: number,
    readonly currentOffset: number,
    readonly remainingGap: number,
  ) {
    super(
      `Gap fill timeout after ${elapsedMs}ms: channel=${channel}, ` +
        `target=${targetOffset}, current=${currentOffset}, remaining=${remainingGap}`,
    );
    this.name = 'GapFillTimeoutError';
  }
}

/**
 * RTCAgentClient implementation backed by Centrifuge WebSocket.
 *
 * Responsibilities:
 * - Manage Centrifuge WebSocket connection lifecycle
 * - Wrap all RPC calls (sessions, messages, turns, RTC)
 * - Subscribe to topic channel (topic:u={userId}) for Update events with offline recovery
 * - Subscribe to live channel (live:u={userId}) for streaming messages (no recovery)
 * - Handle token expiration: automatic refresh or stop-and-wait-for-relogin
 *
 * NOTE: JSON serialization/deserialization happens on the main thread via Centrifuge's
 * internal WebSocket handling. For very large messages (>100KB), this may block the main
 * thread for 10-50ms per message. This is generally acceptable for typical RTC Agent usage
 * (most messages are <10KB), but could become noticeable with bulk data transfers.
 *
 * SERIALIZATION OPTIMIZATION LIMITATION:
 * Centrifuge SDK handles WebSocket message serialization internally, and the application
 * layer does not have direct access to raw message buffers. Implementing Transferable Objects
 * or Worker-based serialization would require:
 * 1. Creating a custom transport layer for Centrifuge (complex, invasive)
 * 2. Or modifying the SDK itself to support pluggable serialization
 *
 * If large message latency becomes a problem, consider:
 * - Optimizing message size at the protocol level (compression, pagination)
 * - Using Centrifuge's built-in compression features
 * - Evaluating alternative real-time protocols that support custom serialization
 *
 * Current status: No application-level serialization optimization is feasible without
 * significant architectural changes to the Centrifuge integration.
 */
export class RTCAgentClient implements IRTCAgentClient {
  private readonly options: RTCAgentClientOptions;
  private centrifuge: Centrifuge | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private readonly listeners = new Map<
    EventName,
    Set<EventCallback<EventName>>
  >();
  /** Whether reconnection should continue (set to false when relogin is required). */
  private shouldReconnect = true;
  /** Whether a connection was ever established (distinguishes first connect from reconnect). */
  private wasConnected = false;
  /** Guard flag to prevent concurrent reconnect() calls. */
  private _reconnecting = false;
  /** Serialised queue for processing updates. */
  private applyUpdatesQueue: Promise<void> | null = null;
  /** Cached subscription objects keyed by channel name. */
  private readonly subscriptions = new Map<
    string,
    ReturnType<Centrifuge['newSubscription']>
  >();
  /** Cached epoch per channel. */
  private readonly epochCache = new Map<string, string>();
  /** Pending reconnect timer (cleared on explicit disconnect to prevent zombie reconnects). */
  private _reconnectTimer?: ReturnType<typeof setTimeout>;
  /** Active gap fill tasks per channel (for deduplication and merging). */
  private readonly gapFillTasks = new Map<
    string,
    { targetOffset: number; epoch: string }
  >();
  /** Whether gap fill processing is currently running. */
  private isGapFillProcessing = false;
  /** AbortControllers for active gap fill waits (cleared on disconnect). */
  private readonly _gapFillAbortControllers = new Map<
    string,
    AbortController
  >();
  /** Current delay for exponential backoff after gap fill failure. Initialized in constructor. */
  private _reconnectDelay!: number;
  /** Guard flag to prevent concurrent handleInvalidToken() calls. */
  private _handlingInvalidToken = false;
  /**
   * In-flight token refresh promise for deduplication.
   *
   * **Race condition scenario:**
   * Multiple callbacks (e.g., Centrifuge's token refresh callback, reconnection logic,
   * or multiple tabs sharing the same client instance) may detect token expiry simultaneously.
   * Without deduplication, each callback would trigger a separate refresh request, causing:
   * 1. Redundant network requests to the auth server
   * 2. Potential token invalidation (if the auth server rotates tokens on refresh)
   * 3. Wasted resources and increased latency
   *
   * **Deduplication mechanism:**
   * The first caller to detect expiry creates this promise and caches it. Subsequent callers
   * check this field and await the same promise instead of initiating new refreshes.
   * After completion (success or failure), the promise is cleared to allow retry.
   *
   * **Why this is safe:**
   * - JavaScript is single-threaded: the check-and-assign is atomic (no interleaving)
   * - The promise is cleared in `finally`, ensuring cleanup even on exceptions
   * - Callers awaiting the same promise receive the same result (success or failure)
   *
   * See: WorkerBridge Token Caching Bug (memory) for historical context on similar issues.
   */
  private _refreshPromise: Promise<string> | null = null;

  // ========== P2-7: Token refresh failure tracking with exponential backoff ==========
  /**
   * Track consecutive token refresh failures to implement exponential backoff.
   * Prevents overwhelming the auth server when it's experiencing issues.
   *
   * - _refreshFailureCount: Number of consecutive refresh failures
   * - REFRESH_BACKOFF_MS: Base delay for exponential backoff (1s, 2s, 4s, 8s...)
   * - REFRESH_MAX_BACKOFF_MS: Maximum backoff delay (30s)
   */
  private _refreshFailureCount: number = 0;
  private static readonly REFRESH_BACKOFF_MS = 1000;
  private static readonly REFRESH_MAX_BACKOFF_MS = 30000;

  // ========== Update Scheduler: dispatch -> [buffer] -> serial executor ==========
  /**
   * Buffer for pending updates (deduplication happens here before enqueue).
   * Publication callbacks fire-and-forget into this buffer; the executor
   * drains it serially so Centrifuge callbacks never block on async work.
   */
  private readonly pendingUpdates: Update[] = [];
  /** Whether the update executor is currently draining the buffer. */
  private isUpdateProcessing = false;
  /**
   * Synchronous offset cache per channel — mirrors IndexedDB state so that
   * scheduleUpdate can deduplicate expired/duplicate offsets without awaiting
   * IndexedDB (which would re-introduce callback blocking).
   */
  private readonly lastOffsetCache = new Map<string, number>();

  /** Delay (ms) before reconnecting after "message size limit exceeded" rejection. */
  private static readonly RECONNECT_AFTER_SIZE_LIMIT_DELAY_MS = 3000;
  /** Delay (ms) before reconnecting after a successful token refresh. */
  private static readonly RECONNECT_AFTER_TOKEN_REFRESH_DELAY_MS = 1000;
  /** Initial delay (ms) for exponential backoff after gap fill failure. */
  private static readonly RECONNECT_INITIAL_DELAY_MS = 1000;
  /** Maximum delay (ms) for exponential backoff. */
  private static readonly RECONNECT_MAX_DELAY_MS = 30000;
  /** Multiplier for exponential backoff. */
  private static readonly RECONNECT_BACKOFF_MULTIPLIER = 2;

  /** Initial polling interval (ms) for gap fill wait with exponential backoff. */
  private static readonly GAP_FILL_INITIAL_POLL_INTERVAL_MS = 100;
  /** Maximum polling interval (ms) for gap fill wait with exponential backoff. */
  private static readonly GAP_FILL_MAX_POLL_INTERVAL_MS = 2000;
  /**
   * Threshold for switching to batch mode when processing gap fill updates.
   * When deduplicated update count >= this value, use batch UI updates to avoid
   * suspended events limit (UIUpdateBus.MAX_SUSPENDED_EVENTS = 1000).
   * Rationale: 100 updates * ~5 entities/update = ~500 events, well below 1000 limit.
   */
  private static readonly BATCH_MODE_THRESHOLD = 100;

  /**
   * Network status event handlers for online/offline detection.
   * Added in connect() and removed in disconnect() to trigger reconnection
   * when network recovers from offline state.
   */
  private _onOnlineHandler?: () => void;
  private _onOfflineHandler?: () => void;

  // ========== P2-6: Application-level heartbeat monitoring ==========
  /**
   * Heartbeat monitoring to detect stale connections that Centrifuge's internal
   * mechanism might miss (e.g., half-open connections, proxy timeouts).
   *
   * - _lastMessageTime: Timestamp of last received message/publication
   * - _heartbeatCheckTimer: Periodic timer to check for message staleness
   * - HEARTBEAT_TIMEOUT_MS: If no message received within this window, trigger reconnect
   *
   * This is a safety net - Centrifuge's ping/pong handles most cases, but application-level
   * monitoring catches edge cases where the connection appears alive but data stops flowing.
   */
  private _lastMessageTime: number = 0;
  private _heartbeatCheckTimer?: ReturnType<typeof setInterval>;
  private static readonly HEARTBEAT_TIMEOUT_MS = 60000; // 60 seconds
  private static readonly HEARTBEAT_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds

  /**
   * Create a new RTCAgentClient instance.
   *
   * IMPORTANT: The `options.userId` field must be extracted from the RTC JWT's `user_id` claim.
   * This is a non-standard claim specific to the RTC system (not the standard JWT `sub` claim).
   *
   * TOKEN EXCHANGE MODE: When using Token Exchange (RFC 8693), the external JWT provider may use
   * standard claims (like `sub`), but the RTC JWT issued by the backend will always use `user_id`.
   * The caller must parse the RTC JWT (not the external JWT) to extract the userId.
   *
   * Example of parsing userId from RTC JWT:
   * ```typescript
   * const payload = parseJwtPayload(rtcJwt);
   * const userId = payload.user_id; // NOT payload.sub
   * ```
   *
   * SECURITY: The userId is used to construct channel names and must match the JWT's user_id claim
   * for proper authorization and data isolation. Mismatched userIds will cause subscription failures.
   *
   * @param options - Configuration options for the client
   */
  constructor(options: RTCAgentClientOptions) {
    this.options = options;
    this._reconnectDelay = RTCAgentClient.RECONNECT_INITIAL_DELAY_MS;
  }

  // ========== Lifecycle ==========

  async connect(): Promise<void> {
    log.debug('connect() called, current state:', this.connectionState);
    if (
      this.connectionState === 'connected' ||
      this.connectionState === 'connecting'
    ) {
      log.debug('connect() early return, already', this.connectionState);
      return;
    }
    this.shouldReconnect = true;
    this.setConnectionState('connecting');

    // P1-FIX: Register network status listeners to trigger reconnection on recovery.
    // When the browser goes offline, WebSocket connections are suspended. Upon coming
    // back online, we proactively reconnect instead of waiting for Centrifuge's timeout.
    //
    // SECURITY: Only trigger reconnection if we were previously connected (wasConnected=true).
    // This prevents attempting to reconnect on initial page load before any connection was established,
    // which could cause unnecessary network traffic and race conditions with the initial connect() call.
    this._onOnlineHandler = () => {
      log.info('Network online event received, triggering reconnection');
      if (this.connectionState === 'disconnected' && this.shouldReconnect && this.wasConnected) {
        // Clear any pending reconnect timer to reconnect immediately
        if (this._reconnectTimer) {
          clearTimeout(this._reconnectTimer);
          this._reconnectTimer = undefined;
        }
        this.connect().catch((err) => {
          log.error('Reconnection after online event failed:', err);
        });
      }
    };
    this._onOfflineHandler = () => {
      log.warn('Network offline event received, connection suspended');
      // Centrifuge will detect the connection drop; we just log for observability
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this._onOnlineHandler);
      window.addEventListener('offline', this._onOfflineHandler);
    }

    this.centrifuge = new Centrifuge(this.options.endpoint, {
      // Weak network tolerance: increase timeout from default 5s to 15s.
      // This timeout applies to all RPC calls (including history()),
      // transport connections, and ready() calls.
      timeout: 30000,
      getToken: async () => {
        return this._getToken();
      },
    });

    this.centrifuge.on('connecting', (ctx) => {
      // If we should not reconnect (e.g. token expired, relogin required), block the connection.
      if (!this.shouldReconnect) {
        this.centrifuge?.disconnect();
        return;
      }
      // Distinguish first connect from reconnect (Issue 2).
      const state = this.wasConnected ? 'reconnecting' : 'connecting';
      this.setConnectionState(state, ctx?.reason);
    });
    this.centrifuge.on('connected', () => {
      log.debug('centrifuge connected, setting state to connected');
      this.wasConnected = true;
      // Reset exponential backoff on successful connection
      this._reconnectDelay = RTCAgentClient.RECONNECT_INITIAL_DELAY_MS;
      // P2-6: Initialize heartbeat timestamp and start monitoring
      this._lastMessageTime = Date.now();
      this._startHeartbeatMonitoring();
      this.setConnectionState('connected');
      this.subscribeChannels();
    });
    this.centrifuge.on('disconnected', (ctx) => {
      log.debug(
        'centrifuge disconnected, reason:',
        ctx?.reason,
        '| code:',
        ctx?.code,
        '| wasConnected:',
        this.wasConnected,
        '| shouldReconnect:',
        this.shouldReconnect,
        '| activeGapFills:',
        this.gapFillTasks.size,
      );

      // Detect account banned (disconnect code 4501).
      // Server uses terminal disconnect code 4501 (application-specific, no auto-reconnect).
      // Stop reconnecting and notify the application.
      if (ctx?.code === 4501) {
        log.warn('account banned, disconnect code 4501, reason:', ctx?.reason);
        this.shouldReconnect = false;
        this.wasConnected = false;
        // Call onAccountBanned callback if provided
        if (this.options.onAccountBanned) {
          const banReason = ctx?.reason || 'account banned';
          this.options.onAccountBanned(banReason);
        }
        this.setConnectionState('disconnected', 'account banned (code 4501)');
        return;
      }

      // Detect server-side token rejection (e.g. "invalid token").
      // Even if the JWT is not expired, we need to trigger the refresh mechanism.
      if (ctx?.reason === 'invalid token' && this.options.onTokenExpired) {
        // Critical fix: immediately disconnect the Centrifuge instance to prevent it from
        // auto-reconnecting with the cached old token. Centrifuge reuses cached tokens on
        // reconnect, so the newly refreshed token would never take effect.
        const oldCentrifuge = this.centrifuge;
        this.centrifuge = null; // Clear reference to prevent subsequent ops on old instance.
        oldCentrifuge?.disconnect(); // Explicit disconnect to stop auto-reconnect.
        // Fix: Remove all event listeners from the old instance to prevent memory leaks.
        // Centrifuge SDK provides removeAllListeners() method for cleanup.
        if (oldCentrifuge && typeof oldCentrifuge.removeAllListeners === 'function') {
          oldCentrifuge.removeAllListeners();
        }
        // Fire-and-forget: handleInvalidToken() manages its own error handling and
        // reconnection scheduling. We return here to avoid falling through to the
        // generic setConnectionState() below — handleInvalidToken() will set the
        // appropriate connection state itself.
        // Fix: Add catch to prevent unhandled promise rejection
        this.handleInvalidToken().catch((err) => {
          log.error('handleInvalidToken failed:', err);
          this.setConnectionState('disconnected', 'token refresh failed');
        });
        return;
      }

      // Detect message-size-limit exceeded: server rejects the connection and Centrifuge
      // does not auto-retry this type of server-side rejection.
      if (ctx?.reason === 'message size limit exceeded') {
        log.warn(
          'message size limit exceeded, will retry connection after delay',
        );
        // P1-FIX: Clear any existing reconnect timer to prevent multiple concurrent timers.
        if (this._reconnectTimer) {
          clearTimeout(this._reconnectTimer);
        }
        // Delay reconnect to give the server some buffer time.
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = undefined;
          if (this.shouldReconnect && this.connectionState === 'disconnected') {
            log.debug('attempting reconnect after message size limit error');
            this.reconnect().catch((err) => {
              log.error('reconnect failed:', err);
            });
          }
        }, RTCAgentClient.RECONNECT_AFTER_SIZE_LIMIT_DELAY_MS);
      }

      this.setConnectionState('disconnected', ctx?.reason);
    });
    this.centrifuge.on('error', (ctx) => {
      log.error('centrifuge error:', ctx?.error);
      this.emit('error', new Error(ctx?.error?.message ?? 'centrifuge error'));
    });

    log.debug('calling centrifuge.connect() synchronously');
    this.centrifuge.connect();
    log.debug(
      'centrifuge.connect() returned, state:',
      this.connectionState,
      '(WebSocket not yet established)',
    );
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.wasConnected = false;
    // P1-FIX: Remove network status listeners to prevent leaks and unwanted reconnects.
    if (typeof window !== 'undefined') {
      if (this._onOnlineHandler) {
        window.removeEventListener('online', this._onOnlineHandler);
      }
      if (this._onOfflineHandler) {
        window.removeEventListener('offline', this._onOfflineHandler);
      }
    }
    this._onOnlineHandler = undefined;
    this._onOfflineHandler = undefined;
    // Clear any pending reconnect timer to prevent zombie reconnects after explicit disconnect.
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }
    // P2-6: Stop heartbeat monitoring on disconnect
    this._stopHeartbeatMonitoring();
    // Abort all active gap fill waits to prevent zombie timers
    this._gapFillAbortControllers.forEach((controller) => controller.abort());
    this._gapFillAbortControllers.clear();
    // Clear pending gap fill tasks to prevent stale tasks after reconnect
    this.gapFillTasks.clear();
    // Reset processing flags to ensure clean state
    this.isGapFillProcessing = false;
    this.isUpdateProcessing = false;
    this.centrifuge?.disconnect();
    this.centrifuge = null;
    // Clear old subscriptions: they are bound to the destroyed Centrifuge instance
    // and must be rebuilt on reconnect.
    this.subscriptions.clear();
    // Clear the update scheduler buffer and sync cache — they are tied to the
    // previous connection's offset state and must be rebuilt on reconnect.
    this.pendingUpdates.length = 0;
    this.lastOffsetCache.clear();
    this.setConnectionState('disconnected');
  }

  async reconnect(): Promise<void> {
    if (this._reconnecting) {
      log.debug('reconnect already in progress, skipping');
      return;
    }
    this._reconnecting = true;
    try {
      this.disconnect();
      await this.connect();
    } finally {
      this._reconnecting = false;
    }
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get the current user ID.
   *
   * SECURITY REQUIREMENT: The userId must be extracted from the RTC JWT's `user_id` claim.
   * This is a non-standard claim (not the standard `sub` claim) that is specific to the RTC system.
   *
   * The userId is used to construct channel names (topic:u={userId}, live:u={userId}) and must
   * match the user_id claim in the JWT to ensure proper authorization and data isolation.
   *
   * @returns The user ID, or undefined if not set in options.
   */
  getUserId(): string | undefined {
    return this.options.userId;
  }

  // ========== Sessions ==========

  async listSessions(
    cursor?: string,
    limit?: number,
  ): Promise<ListSessionsResponse> {
    return this.rpc<ListSessionsResponse>(RPC_METHODS.SessionList, {
      cursor,
      limit,
    });
  }

  async getSession(sessionId: string): Promise<GetSessionResponse> {
    return this.rpc<GetSessionResponse>(RPC_METHODS.SessionGet, {
      session_id: sessionId,
    });
  }

  async closeSession(sessionId: string): Promise<CloseSessionResponse> {
    return this.rpc<CloseSessionResponse>(RPC_METHODS.SessionClose, {
      session_id: sessionId,
    });
  }

  async openSession(sessionId: string): Promise<OpenSessionResponse> {
    return this.rpc<OpenSessionResponse>(RPC_METHODS.SessionOpen, {
      session_id: sessionId,
    });
  }

  async compactSession(
    req: CompactSessionRequest,
  ): Promise<CompactSessionResponse> {
    return this.rpc<CompactSessionResponse>(RPC_METHODS.SessionCompact, req);
  }

  async updateSession(
    req: UpdateSessionRequest,
  ): Promise<UpdateSessionResponse> {
    return this.rpc<UpdateSessionResponse>(RPC_METHODS.SessionUpdate, req);
  }

  // ========== Messages & Turns ==========

  /**
   * Send a message.
   *
   * @param req - SendMessageRequest; client_id is used by the server for idempotent dedup.
   */
  async sendMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
    return this.rpc<SendMessageResponse>(RPC_METHODS.MessageSend, req);
  }

  async forkSession(req: ForkSessionRequest): Promise<ForkSessionResponse> {
    return this.rpc<ForkSessionResponse>(RPC_METHODS.SessionFork, req);
  }

  async stopTurn(server_session_id: string): Promise<StopTurnResponse> {
    return this.rpc<StopTurnResponse>(RPC_METHODS.TurnStop, {
      session_id: server_session_id,
    });
  }

  async listMessages(
    sessionId: string,
    cursor?: number,
    limit?: number,
  ): Promise<MessageListResponse> {
    return this.rpc<MessageListResponse>(RPC_METHODS.MessageList, {
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
    return this.rpc<TurnListResponse>(RPC_METHODS.TurnList, {
      session_id: sessionId,
      cursor,
      limit,
    });
  }

  // ========== RTC (Tool Calls) ==========

  async listRtc(
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<RtcListResponse> {
    return this.rpc<RtcListResponse>(RPC_METHODS.RtcList, {
      session_id: sessionId,
      cursor,
      limit,
    });
  }

  async updateRtcStatus(
    rtcId: string,
    status: RtcStatus,
  ): Promise<UpdateRtcStatusResponse> {
    return this.rpc<UpdateRtcStatusResponse>(RPC_METHODS.RtcUpdateStatus, {
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
    return this.rpc<SubmitRtcResultResponse>(RPC_METHODS.RtcSubmitResult, {
      rtc_id: rtcId,
      success,
      result,
      error,
    });
  }

  // ========== Updates Processing ==========

  /**
   * Process updates with continuity detection + gap fill + serialisation.
   *
   * Both Publication events and RPC responses should call this method.
   * Guarantees serial execution — only one applyUpdates runs at a time.
   *
   * @param updates Array of updates to process (ignored if callback is provided).
   * @param callback Optional custom callback for serialised execution (used by subscribed handler).
   */
  async applyUpdates(
    updates: Update[],
    callback?: () => Promise<void>,
  ): Promise<void> {
    // Serialise: chain the current task after the previous one.
    // Critical: must await previousPromise, otherwise concurrent calls will see
    // the same lastOffset and both skip the gap fill, breaking offset continuity.
    let previousPromise = this.applyUpdatesQueue;

    const currentPromise = (async () => {
      if (previousPromise) {
        await previousPromise;
      }

      if (callback) {
        await callback();
      } else {
        for (const update of updates) {
          await this.processUpdate(update);
        }
      }
    })();

    this.applyUpdatesQueue = currentPromise;

    try {
      await currentPromise;
    } finally {
      // Clear queue reference: only clear if the current task is still the tail,
      // to avoid clearing tasks that were enqueued after us.
      if (this.applyUpdatesQueue === currentPromise) {
        this.applyUpdatesQueue = null;
      }
    }
  }

  /**
   * Process a single Update (internal method).
   */
  private async processUpdate(update: Update): Promise<void> {
    const channel = `topic:u=${this.options.userId}`;

    if (update.offset > 0) {
      // Topic channel: detect continuity.
      const position = await this.options.getLastOffset?.(channel);
      const lastOffset = position?.offset;
      const lastEpoch = position?.epoch ?? this.epochCache.get(channel) ?? '';

      // Skip duplicate/expired messages: if offset <= lastOffset, this message was
      // already processed. Prevents offset rollback and duplicate onPublication calls.
      if (lastOffset !== undefined && update.offset <= lastOffset) {
        log.debug(
          `Skipping duplicate/expired message: offset=${update.offset}, lastOffset=${lastOffset}`,
        );
        return;
      }

      if (lastOffset !== undefined && update.offset > lastOffset + 1) {
        // Gap detected — schedule async gap fill and wait for completion.
        this.scheduleGapFill(channel, update.offset, lastEpoch);

        // Wait for gap fill to catch up to this update's offset.
        await this.waitForGapFill(channel, update.offset - 1);

        // Post-fill verification: did gap fill advance the offset to update.offset - 1?
        const newPosition = await this.options.getLastOffset?.(channel);
        const newLastOffset = newPosition?.offset;
        const newLastEpoch = newPosition?.epoch;

        // Verify both offset and epoch:
        // - offset must reach update.offset - 1 (ensuring continuity)
        // - epoch must match expectation (preventing data corruption after server restart)
        const expectedEpoch = this.epochCache.get(channel) ?? '';
        if (
          newLastOffset === undefined ||
          newLastOffset !== update.offset - 1
        ) {
          // Gap fill failed — reject this update to maintain strict +1 continuity.
          throw new Error(
            `[RTCAgentClient] Offset gap fill failed: expected ${update.offset - 1}, got ${newLastOffset}. ` +
              `Rejecting update ${update.offset} to maintain strict +1 continuity.`,
          );
        }
        if (newLastEpoch !== undefined && newLastEpoch !== expectedEpoch) {
          // Epoch changed (possible server restart) — reject to prevent data corruption.
          throw new Error(
            `[RTCAgentClient] Epoch mismatch after gap fill: expected '${expectedEpoch}', got '${newLastEpoch}'. ` +
              `Rejecting update ${update.offset} to prevent data corruption.`,
          );
        }
      }
    }

    // Call onPublication callback to handle the update.
    if (this.options.onPublication) {
      const event: PublicationEvent = {
        channel: `topic:u=${this.options.userId}`,
        offset: update.offset,
        data: update,
      };
      // P2-6: Update heartbeat timestamp on message receipt
      this._lastMessageTime = Date.now();
      await this.options.onPublication(event);
    }

    // Update offset and epoch.
    if (update.offset > 0) {
      // Use cached epoch (from the subscribed event).
      const epoch = this.epochCache.get(channel) ?? '';
      await this.options.updateOffset?.(channel, update.offset, epoch);
    }
  }

  /**
   * Wait for gap fill to reach the target offset.
   * Polls the current offset until it reaches the target or gap fill completes.
   * Uses exponential backoff (100ms → 200ms → 400ms → ... → 2000ms) to reduce
   * frequent IndexedDB queries during large gap fills.
   * @throws {GapFillTimeoutError} If gap fill doesn't complete within timeout
   * @throws {Error} If wait is aborted (e.g., during disconnect)
   */
  private async waitForGapFill(
    channel: string,
    targetOffset: number,
  ): Promise<void> {
    const MAX_WAIT_MS = 30000; // 30 seconds timeout
    const INITIAL_POLL_INTERVAL_MS = RTCAgentClient.GAP_FILL_INITIAL_POLL_INTERVAL_MS;
    const MAX_POLL_INTERVAL_MS = RTCAgentClient.GAP_FILL_MAX_POLL_INTERVAL_MS;
    const BACKOFF_MULTIPLIER = 2;

    let pollInterval = INITIAL_POLL_INTERVAL_MS;
    const startTime = Date.now();

    // Create AbortController for this gap fill wait
    const waitAbort = new AbortController();
    const mapKey = `${channel}:${targetOffset}`;
    // Clean up old controllers for the same channel to prevent memory leaks.
    // If a previous gap fill wait is still pending for this channel (with a different targetOffset),
    // abort it — the new request supersedes it.
    for (const [key, controller] of this._gapFillAbortControllers.entries()) {
      if (key.startsWith(`${channel}:`)) {
        controller.abort();
        this._gapFillAbortControllers.delete(key);
      }
    }
    this._gapFillAbortControllers.set(mapKey, waitAbort);

    try {
      while (Date.now() - startTime < MAX_WAIT_MS) {
        // Check if aborted (e.g., during disconnect) - MUST be first check
        if (waitAbort.signal.aborted) {
          throw new Error(`Gap fill aborted for channel ${channel}`);
        }

        const position = await this.options.getLastOffset?.(channel);
        const currentOffset = position?.offset ?? 0;

        if (currentOffset >= targetOffset) {
          return; // Gap fill caught up
        }

        // Check again after await in case abort happened during getLastOffset
        if (waitAbort.signal.aborted) {
          throw new Error(`Gap fill aborted for channel ${channel}`);
        }

        // Check if gap fill is still running for this channel.
        // Only the per-channel task entry matters here; isGapFillProcessing is a global
        // flag that may still be true while waiting for an unrelated channel to finish.
        if (!this.gapFillTasks.has(channel)) {
          return; // Gap fill completed (or failed) for this channel
        }

        // Wait with exponential backoff before checking again, but abortable
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, pollInterval);
          waitAbort.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error(`Gap fill aborted for channel ${channel}`));
            },
            { once: true },
          );
        });

        // Increase poll interval for next iteration (exponential backoff)
        pollInterval = Math.min(
          pollInterval * BACKOFF_MULTIPLIER,
          MAX_POLL_INTERVAL_MS,
        );
      }

      // Timeout — throw explicit error instead of silent return
      const elapsedMs = Date.now() - startTime;
      const position = await this.options.getLastOffset?.(channel);
      const currentOffset = position?.offset ?? 0;
      throw new GapFillTimeoutError(
        channel,
        targetOffset,
        elapsedMs,
        currentOffset,
        targetOffset - currentOffset,
      );
    } finally {
      // Only delete if this controller is still the stored one (fix: concurrent calls don't clobber)
      if (this._gapFillAbortControllers.get(mapKey) === waitAbort) {
        this._gapFillAbortControllers.delete(mapKey);
      }
    }
  }

  // ========== Events ==========

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

  // ========== Update Scheduler: dispatch -> [buffer] -> serial executor ==========

  /**
   * Schedule an update for async serial processing (non-blocking).
   *
   * Pattern: scheduleGapFill — fire-and-forget into a buffer, the executor
   * drains it serially. Deduplication happens at enqueue time using the
   * synchronous lastOffsetCache (avoids awaiting IndexedDB in the callback).
   *
   * Why this matters: Centrifuge dispatches publication callbacks serially
   * per subscription — if the callback awaits slow work (gap fill polling,
   * IndexedDB, user's onPublication), new messages queue up behind it and
   * Centrifuge's internal ping/pong can timeout.
   */
  private scheduleUpdate(update: Update): void {
    const channel = `topic:u=${this.options.userId}`;

    // Buffer dedup 1: stale message (offset <= already-processed lastOffset)
    if (update.offset > 0) {
      const cachedLastOffset = this.lastOffsetCache.get(channel);
      if (cachedLastOffset !== undefined && update.offset <= cachedLastOffset) {
        log.debug(
          `scheduleUpdate: skip expired offset=${update.offset}, lastOffset=${cachedLastOffset}`,
        );
        return;
      }
    }

    // Buffer dedup 2: same offset already in queue
    if (
      update.offset > 0 &&
      this.pendingUpdates.some((u) => u.offset === update.offset)
    ) {
      log.debug(
        `scheduleUpdate: skip duplicate in buffer offset=${update.offset}`,
      );
      return;
    }

    this.pendingUpdates.push(update);
    void this.processUpdateQueue();
  }

  /**
   * Executor: drain pendingUpdates serially.
   *
   * Each update goes through applyUpdates (which provides its own Promise-chain
   * serialisation and integrates with gap fill / external RPC callers).
   * The two-level serialisation (buffer loop + applyUpdates Promise chain) is
   * intentional — the buffer deduplicates and decouples from Centrifuge,
   * applyUpdates coordinates with external callers and gap fill.
   */
  private async processUpdateQueue(): Promise<void> {
    if (this.isUpdateProcessing) return;
    this.isUpdateProcessing = true;

    try {
      while (this.pendingUpdates.length > 0) {
        const update = this.pendingUpdates.shift()!;
        try {
          await this.applyUpdates([update]);
          // Update sync cache on success (for subsequent enqueue dedup)
          if (update.offset > 0) {
            const channel = `topic:u=${this.options.userId}`;
            this.lastOffsetCache.set(channel, update.offset);
          }
        } catch (err) {
          log.error(
            `processUpdateQueue failed for offset ${update.offset}:`,
            err,
          );
          this.emit(
            'error',
            err instanceof Error ? err : new Error(String(err)),
          );

          // Critical error (e.g., gap fill failure) -> trigger reconnect, same as publication error handling
          if (this.shouldReconnect) {
            this.centrifuge?.disconnect();
            this.setConnectionState('disconnected', 'update processing failed');
            this.emit('syncRequired', {
              reason: 'gap_fill_failed',
              lastKnownOffset: update.offset - 1,
              serverOffset: update.offset,
            });
            // P1-FIX: Clear any existing reconnect timer to prevent multiple concurrent timers.
            if (this._reconnectTimer) {
              clearTimeout(this._reconnectTimer);
            }
            this._reconnectTimer = setTimeout(() => {
              this._reconnectTimer = undefined;
              if (
                this.shouldReconnect &&
                this.connectionState === 'disconnected'
              ) {
                log.debug(
                  'attempting reconnect after update processing failure',
                );
                this.reconnect().catch((e) =>
                  log.error('reconnect failed:', e),
                );
              }
            }, this._reconnectDelay);
            // Exponential backoff for next failure
            this._reconnectDelay = Math.min(
              this._reconnectDelay *
                RTCAgentClient.RECONNECT_BACKOFF_MULTIPLIER,
              RTCAgentClient.RECONNECT_MAX_DELAY_MS,
            );
          }
          // Critical error: stop processing remaining queue — reconnect will clear state
          break;
        }
      }
    } finally {
      this.isUpdateProcessing = false;
    }
  }

  // ========== Gap Fill Manager ==========

  /**
   * Schedule an async gap fill (non-blocking).
   *
   * Multiple calls for the same channel are automatically deduplicated:
   * the targetOffset is merged to the maximum value.
   *
   * @param channel Channel name
   * @param targetOffset Target offset to reach (exclusive)
   * @param epoch Current epoch
   */
  private scheduleGapFill(
    channel: string,
    targetOffset: number,
    epoch: string,
  ): void {
    const pending = this.gapFillTasks.get(channel);
    if (pending) {
      // Merge: extend to the maximum range, no re-trigger needed.
      pending.targetOffset = Math.max(pending.targetOffset, targetOffset);
      pending.epoch = epoch;
      log.debug(
        `scheduleGapFill merged: channel=${channel}, ` +
          `targetOffset=${pending.targetOffset}, isProcessing=${this.isGapFillProcessing}`,
      );
    } else {
      this.gapFillTasks.set(channel, { targetOffset, epoch });
      // Only trigger processing when there is no existing task (avoid duplicate loops).
      void this.processGapFillQueue();
    }
  }

  /**
   * Process all pending gap fill requests serially.
   * Uses a loop that dynamically checks for new requests after each fill.
   */
  private async processGapFillQueue(): Promise<void> {
    if (this.isGapFillProcessing) return;
    this.isGapFillProcessing = true;

    try {
      while (this.gapFillTasks.size > 0) {
        // Take the first pending channel
        const [channel, { targetOffset, epoch }] = this.gapFillTasks
          .entries()
          .next().value!;

        // Run gap fill until caught up
        await this.runGapFill(channel, targetOffset, epoch);

        // Remove if no new requests arrived during fill
        const current = this.gapFillTasks.get(channel);
        if (current && current.targetOffset <= targetOffset) {
          this.gapFillTasks.delete(channel);
        }
        // If targetOffset increased, loop continues to handle it
      }
    } finally {
      this.isGapFillProcessing = false;
    }
  }

  /**
   * Run gap fill for a channel until reaching targetOffset.
   * Fetches history in batches, accumulates to 100+ updates, then deduplicates at item level.
   *
   * RECOVERY: If the connection drops during gap fill, disconnect() clears gapFillTasks
   * and lastOffsetCache. On reconnect, subscribeChannels() re-detects offset continuity
   * and re-schedules gap fill from the last persisted offset (in IndexedDB). This may
   * cause some updates to be re-fetched, but deduplicateUpdates() ensures idempotency.
   */
  private async runGapFill(
    channel: string,
    targetOffset: number,
    epoch: string,
  ): Promise<void> {
    const sub = this.subscriptions.get(channel);
    if (!sub) {
      log.warn(`runGapFill: subscription not found for channel ${channel}`);
      return;
    }

    // Debug log: record connection state and subscription state at gap fill start
    log.debug(
      `runGapFill started: channel=${channel}, targetOffset=${targetOffset}, ` +
        `connectionState=${this.connectionState}, centrifuge=${!!this.centrifuge}, ` +
        `subState=${sub.state}`,
    );

    const BATCH_SIZE = 100; // Number of items per RPC call (avoid oversized responses)
    // ACCUMULATE_THRESHOLD: Maximum number of updates to accumulate before flushing.
    // Each Update generates multiple UIUpdateEvents (one per entity field change),
    // so we keep this conservative to stay well below UIUpdateBus.MAX_SUSPENDED_EVENTS (1000).
    // With ~150 updates × ~5 fields each = ~750 events, safely under the limit.
    // After each flush, UI is resumed to dispatch events before the next accumulation cycle.
    const ACCUMULATE_THRESHOLD = 150;
    // Only suspend UI updates for large gaps to prevent UI thrashing.
    // Small gaps (< 100) can update UI normally for real-time feedback.
    const SUSPEND_THRESHOLD = 100;

    // Get current offset to determine gap size
    const startPosition = await this.options.getLastOffset?.(channel);
    const currentOffset = startPosition?.offset ?? 0;
    const gapSize = targetOffset - currentOffset;

    log.debug(
      `[BulkUpdate] runGapFill: gapSize=${gapSize}, threshold=${SUSPEND_THRESHOLD}`,
    );

    // Buffer hoisted outside try so content fetched before disconnect can still be applied
    let buffer: Update[] = [];
    let gapOffsets: number[] = [];
    let offset = currentOffset;

    // Determine if this is a large gap that needs UI suspension.
    // For large gaps, we show a syncing overlay via onGapFillStart/onGapFillEnd.
    // The actual UIUpdateBus suspend/resume is handled per-flush by flushGapFillBuffer
    // to prevent event accumulation beyond the 1000 event limit.
    const isLargeGap = gapSize > SUSPEND_THRESHOLD;

    try {
      // Notify UI that gap fill is starting (for large gaps only).
      if (isLargeGap) {
        log.debug('[BulkUpdate] runGapFill: calling onGapFillStart');
        this.options.onGapFillStart?.();
      }

      // Outer loop: continue until reaching targetOffset
      while (offset < targetOffset - 1) {
        buffer = [];
        gapOffsets = [];

        // Inner loop: fetch in batches, accumulate to ACCUMULATE_THRESHOLD+
        // Each flush cycle will suspend/resume UIUpdateBus independently to prevent
        // event accumulation beyond the 1000 event limit.
        while (
          buffer.length < ACCUMULATE_THRESHOLD &&
          offset < targetOffset - 1
        ) {
          const remaining = targetOffset - offset - 1;
          const limit = Math.min(BATCH_SIZE, remaining);
          if (limit <= 0) break;

          const opts: HistoryOptions = {
            since: { offset, epoch },
            limit,
            reverse: false,
          };

          // Debug log: record connection state before calling history
          log.debug(
            `Calling sub.history(): offset=${offset}, limit=${limit}, ` +
              `connectionState=${this.connectionState}, hasCentrifuge=${!!this.centrifuge}, ` +
              `subState=${sub.state}`,
          );

          const historyResult = await sub.history(opts);
          const publications = historyResult.publications;

          if (publications.length === 0) break;

          // Validate batch continuity using Publication.offset
          const firstOffset = publications[0].offset ?? 0;
          if (firstOffset !== offset + 1) {
            throw new Error(
              `Gap fill missing messages: expected first offset ${offset + 1}, got ${firstOffset}`,
            );
          }

          for (let i = 1; i < publications.length; i++) {
            const prev = publications[i - 1].offset ?? 0;
            const curr = publications[i].offset ?? 0;
            if (curr !== prev + 1) {
              throw new Error(
                `Gap fill non-continuous: offset jumped from ${prev} to ${curr}`,
              );
            }
          }

          // Separate real updates from gap placeholders
          for (const pub of publications) {
            const data = pub.data as Record<string, unknown>;
            const pubOffset = pub.offset ?? 0;
            if (data?.type === 'gap') {
              // Gap placeholder: record offset for batch processing later
              gapOffsets.push(pubOffset);
            } else {
              buffer.push(pub.data as Update);
            }
          }

          // Advance offset to the last item in current batch
          offset = publications[publications.length - 1].offset ?? offset;

          // If we got fewer publications than requested, we've reached the end
          if (publications.length < limit) break;
        }

        // Apply current batch buffer content
        // flushGapFillBuffer handles its own suspend/resume per cycle to prevent
        // event accumulation beyond the 1000 event limit.
        await this.flushGapFillBuffer(
          channel,
          buffer,
          gapOffsets,
          epoch,
          false,
        );
      }
    } catch (err) {
      // On network error, apply already-fetched buffer content first
      if (buffer.length > 0 || gapOffsets.length > 0) {
        log.debug(
          `Network error, flushing buffer before error handling: ${buffer.length} updates, ${gapOffsets.length} gap offsets`,
        );
        try {
          await this.flushGapFillBuffer(
            channel,
            buffer,
            gapOffsets,
            epoch,
            false,
          );
        } catch (flushErr) {
          log.error(`Failed to flush buffer on error:`, flushErr);
        }
      }

      // Debug log: record detailed context when error occurs
      log.error(
        `runGapFill failed for channel ${channel}:`,
        err,
        `| connectionState=${this.connectionState}`,
        `| hasCentrifuge=${!!this.centrifuge}`,
        `| targetOffset=${targetOffset}`,
        `| epoch=${epoch}`,
      );
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.emit('syncRequired', {
        reason: 'gap_fill_failed',
        lastKnownOffset: (await this.options.getLastOffset?.(channel))?.offset,
        serverOffset: targetOffset,
      });
    } finally {
      // Notify UI that gap fill is complete (for large gaps only).
      // UIUpdateBus suspend/resume is handled per-flush by flushGapFillBuffer,
      // so we only need to hide the syncing overlay here.
      if (isLargeGap) {
        log.debug('[BulkUpdate] runGapFill: calling onGapFillEnd');
        this.options.onGapFillEnd?.();
      }
    }
  }

  /**
   * Deduplicate updates at item level.
   * Key: `${entity}:${entity_id}`, keep both the first (smallest offset) and last (largest offset) updates.
   *
   * Why keep both first and last?
   * - First update: ensures creation/initialization operations are executed (prerequisite for subsequent updates)
   * - Last update: ensures the final state is correct
   * - Middle updates: discarded to reduce IndexedDB writes (server returns complete entity data in each update)
   *
   * Example:
   * - offset=100: message created (status=pending)
   * - offset=101: message updated (status=sent)
   * - offset=102: message updated (status=delivered)
   * Result: keep offset=100 (creation) and offset=102 (final state), apply in order
   */
  private deduplicateUpdates(updates: Update[]): Update[] {
    const map = new Map<
      string,
      {
        first: { item: UpdateItem; data: unknown; offset: number };
        last: { item: UpdateItem; data: unknown; offset: number };
      }
    >();

    for (const update of updates) {
      for (let i = 0; i < update.items.length; i++) {
        const item = update.items[i];
        const data = update.data_list?.[i];

        if (!data) continue;

        const key = `${item.entity}:${item.entity_id}`;
        const existing = map.get(key);

        if (!existing) {
          // First occurrence: initialize both first and last
          map.set(key, {
            first: { item, data, offset: update.offset },
            last: { item, data, offset: update.offset },
          });
        } else {
          // Update last if this offset is larger
          if (update.offset > existing.last.offset) {
            existing.last = { item, data, offset: update.offset };
          }
          // Update first if this offset is smaller
          if (update.offset < existing.first.offset) {
            existing.first = { item, data, offset: update.offset };
          }
        }
      }
    }

    // Reconstruct as Update array
    const result: Update[] = [];

    for (const { first, last } of map.values()) {
      // Add first (smallest offset) - ensures creation/initialization
      result.push({
        id: '', // Original Update id is not preserved after deduplication
        items: [first.item],
        data_list: [first.data],
        offset: first.offset,
      });

      // Add last (largest offset) if different from first - ensures final state
      if (last.offset !== first.offset) {
        result.push({
          id: '',
          items: [last.item],
          data_list: [last.data],
          offset: last.offset,
        });
      }
    }

    // Sort by offset to ensure correct application order (first → last)
    const resultSorted = result.sort((a, b) => a.offset - b.offset);

    return resultSorted;
  }

  /**
   * Flush gap fill buffer: process gap placeholders and deduplicated updates.
   * Used both in normal flow and on network error to apply buffered content.
   *
   * CRITICAL: Offset is only advanced AFTER all data is successfully persisted.
   * This prevents data loss if applyUpdates fails — the offset stays behind,
   * allowing retry to re-fetch the missing data.
   *
   * @param uiAlreadySuspended - If true, caller has already suspended UI updates.
   *                             This function will not call suspend/resume internally
   *                             to avoid nested suspend calls which accumulate events
   *                             beyond UIUpdateBus.MAX_SUSPENDED_EVENTS (1000).
   */
  private async flushGapFillBuffer(
    channel: string,
    buffer: Update[],
    gapOffsets: number[],
    epoch: string,
    uiAlreadySuspended: boolean = false,
  ): Promise<void> {
    // Process accumulated updates: deduplicate then apply in batch
    if (buffer.length > 0) {
      const deduplicated = this.deduplicateUpdates(buffer);

      // Use batch mode for large updates to avoid suspended events limit.
      // Batch mode collects UI events in memory without persisting or dispatching,
      // then emits a single bulk update at the end.
      //
      // Threshold: 100 updates = ~500 UI events (5 entities per update on average)
      // This is well below the 1000 event limit, but using batch mode for 100+ updates
      // provides a safety margin while avoiding unnecessary overhead for small batches.
      const useBatchMode = deduplicated.length >= RTCAgentClient.BATCH_MODE_THRESHOLD;
      const batchId = useBatchMode ? `gap-fill-${channel}-${Date.now()}` : undefined;

      if (useBatchMode) {
        this.options.startBatchUIUpdates?.(batchId!);
      } else if (!uiAlreadySuspended) {
        // Only suspend UI updates if not already suspended by caller.
        // Nested suspend calls cause event accumulation beyond the 1000 event limit.
        this.options.suspendUIUpdates?.();
      }

      try {
        // Prefer batch callback for optimized processing
        if (this.options.onPublications) {
          const events = deduplicated.map((update) => ({
            channel,
            offset: update.offset,
            data: update,
          }));
          await this.options.onPublications(events);
        } else {
          // Fallback: per-item processing (backward compatible)
          for (const update of deduplicated) {
            if (this.options.onPublication) {
              const event: PublicationEvent = {
                channel,
                offset: update.offset,
                data: update,
              };
              await this.options.onPublication(event);
            }
          }
        }

        // Key fix: advance offset to max(gapOffsets, buffer offsets) only after
        // data persistence succeeds. This ensures offset is not advanced without
        // persisted data.
        const allOffsets = [...gapOffsets, ...buffer.map((u) => u.offset)];
        const maxOffset = Math.max(...allOffsets);
        await this.options.updateOffset?.(channel, maxOffset, epoch);
      } finally {
        // Match the suspend/batch mode logic from above
        if (useBatchMode) {
          this.options.endBatchUIUpdates?.(batchId!);
        } else if (!uiAlreadySuspended) {
          // Only resume UI updates if we suspended them in this function call.
          // If caller already suspended, they are responsible for resuming.
          this.options.resumeUIUpdates?.();
        }
      }
    } else if (gapOffsets.length > 0) {
      // Only gap placeholders (no real data): safe to advance offset directly
      const maxGapOffset = Math.max(...gapOffsets);
      await this.options.updateOffset?.(channel, maxGapOffset, epoch);
    }
  }

  // ========== Internal ==========

  private emit<E extends EventName>(
    event: E,
    payload: RTCAgentClientEvents[E],
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        (cb as EventCallback<E>)(payload);
      } catch (err) {
        log.error(`listener for '${event}' threw:`, err);
      }
    }
  }

  /** Tracks the last reason emitted for connection state changes. */
  private _connectionReason?: string;

  private setConnectionState(state: ConnectionState, reason?: string): void {
    log.debug(
      'setConnectionState:',
      state,
      'reason:',
      reason,
      '| previous:',
      this.connectionState,
      '| timestamp:',
      new Date().toISOString(),
    );
    // Only skip if both state and reason are unchanged
    if (this.connectionState === state && this._connectionReason === reason)
      return;
    this.connectionState = state;
    this._connectionReason = reason;
    const event: ConnectionStateEvent = { state, reason };
    this.emit('connection', event);
    this.options.onConnectionStateChange?.(event);
  }

  /**
   * Handle server-side token rejection (e.g. "invalid token").
   *
   * Even if the JWT is not expired, the server may reject the token due to:
   * - Server restart causing JWT secret rotation
   * - Server-side token revocation
   * - Token format or signature issues
   *
   * This method calls onTokenExpired and decides whether to reconnect based on the action.
   * If onTokenExpired throws, treats it as relogin required to prevent infinite retry loops.
   */
  private async handleInvalidToken(): Promise<void> {
    if (this._handlingInvalidToken) {
      log.debug('handleInvalidToken already in progress, skipping');
      return;
    }
    this._handlingInvalidToken = true;
    try {
      if (!this.options.onTokenExpired) {
        log.warn('invalid token but no onTokenExpired callback provided');
        return;
      }

      log.info('handleInvalidToken: server rejected token, triggering refresh');

      try {
        const action: TokenExpiredAction = await this.options.onTokenExpired();
        if (action === 'relogin') {
          // Relogin required — stop reconnecting.
          this.shouldReconnect = false;
          this.centrifuge?.disconnect();
          this.setConnectionState(
            'disconnected',
            'token expired, relogin required',
          );
        } else {
          // action === 'refresh' — token refreshed, attempt reconnect.
          log.debug('token refreshed, attempting to reconnect');
          // P1-FIX: Clear any existing reconnect timer to prevent multiple concurrent timers.
          if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
          }
          // Delayed reconnect to avoid rapid retry loops.
          this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = undefined;
            if (this.shouldReconnect) {
              this.reconnect().catch((err) => {
                log.error('reconnect after token refresh failed:', err);
              });
            }
          }, RTCAgentClient.RECONNECT_AFTER_TOKEN_REFRESH_DELAY_MS);
        }
      } catch (err) {
        // SECURITY: onTokenExpired threw an error — treat as relogin required to prevent
        // infinite retry loops. Log the error but do not expose details to the user.
        log.error(
          'handleInvalidToken: onTokenExpired threw an error, treating as relogin required:',
          err,
        );
        this.shouldReconnect = false;
        this.centrifuge?.disconnect();
        this.setConnectionState('disconnected', 'token refresh failed');
      }
    } finally {
      this._handlingInvalidToken = false;
    }
  }

  /**
   * Check whether a JWT has expired.
   *
   * SECURITY BOUNDARY: This method only checks the `exp` claim without verifying the signature.
   * It is used solely to optimize network requests (avoid using known-expired tokens), NOT for
   * authorization decisions. The server ALWAYS validates the signature; even if a client token
   * is forged, the server will reject the connection. This client-side check is purely a
   * performance optimization to reduce unnecessary round trips.
   *
   * Parses the exp claim from the JWT payload (Unix timestamp in seconds)
   * and compares it with the current time. Returns true on parse failure
   * (to trigger refresh instead of using a potentially broken token).
   */
  private _isTokenExpired(token: string): boolean {
    const payload = parseJwtPayload(token);
    if (!payload) {
      // Unparseable token is treated as expired to trigger refresh
      log.debug(
        '_isTokenExpired: failed to parse JWT, treating as expired to trigger refresh',
      );
      return true;
    }
    if (typeof payload.exp !== 'number') {
      log.debug(
        '_isTokenExpired: payload.exp is not a number, treating as expired',
      );
      return true;
    }
    const expired = payload.exp * 1000 < Date.now();
    log.debug('_isTokenExpired: exp=', payload.exp, 'expired=', expired);
    return expired;
  }

  /**
   * Get a valid token, refreshing if necessary.
   *
   * Implements Promise-based deduplication to prevent concurrent refresh requests:
   * - If a refresh is in-flight, returns the existing promise
   * - Otherwise, creates a new refresh promise and caches it
   * - Clears the cache after completion (success or failure) to allow retry
   *
   * This solves the race condition where multiple Centrifuge callbacks (e.g., during
   * reconnection) detect token expiry simultaneously and would otherwise trigger
   * parallel refresh requests.
   *
   * P2-7: Implements exponential backoff on refresh failures to prevent overwhelming
   * the auth server during outages.
   */
  private async _getToken(): Promise<string> {
    const token = await this.options.getToken();

    // Only trigger the refresh callback when the token is actually expired,
    // avoiding unnecessary HTTP requests on every reconnect.
    if (this._isTokenExpired(token) && this.options.onTokenExpired) {
      // Deduplication: if a refresh is already in-flight, await it instead of starting a new one
      if (this._refreshPromise) {
        log.debug('token refresh already in-flight, awaiting existing promise');
        return this._refreshPromise;
      }

      // P2-7: Check if we need to back off due to recent failures
      if (this._refreshFailureCount > 0) {
        const backoffDelay = Math.min(
          RTCAgentClient.REFRESH_BACKOFF_MS * Math.pow(2, this._refreshFailureCount - 1),
          RTCAgentClient.REFRESH_MAX_BACKOFF_MS,
        );
        log.warn(
          `Token refresh backing off for ${backoffDelay}ms due to ${this._refreshFailureCount} consecutive failures`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }

      log.warn('[Centrifuge] token is expired, requesting refresh...');

      // Create and cache the refresh promise
      this._refreshPromise = (async () => {
        try {
          const action: TokenExpiredAction = await this.options.onTokenExpired!();
          if (action === 'relogin') {
            // Relogin required — stop reconnecting.
            this.shouldReconnect = false;
            this.centrifuge?.disconnect();
            this.setConnectionState(
              'disconnected',
              'token expired, relogin required',
            );
            throw new Error('Token expired, user needs to re-login');
          }
          // action === 'refresh' — token has been refreshed, fetch the new one.
          const newToken = await this.options.getToken();
          // P2-7: Success - reset failure count
          this._refreshFailureCount = 0;
          log.debug('Token refresh successful, reset failure count');
          return newToken;
        } catch (err) {
          // P2-7: Increment failure count on refresh failure
          // SECURITY: Only increment for transient errors (network, server errors).
          // If the error indicates permanent failure (e.g., invalid refresh token),
          // the caller should handle it and not retry.
          this._refreshFailureCount++;
          log.error(
            `Token refresh failed (failure #${this._refreshFailureCount}):`,
            err,
          );
          // Prevent unbounded growth of failure count (max 10 retries = ~17min backoff)
          if (this._refreshFailureCount > 10) {
            this._refreshFailureCount = 10;
          }
          throw err;
        } finally {
          // Clear the promise after completion (success or failure) to allow retry
          this._refreshPromise = null;
        }
      })();

      return this._refreshPromise;
    }

    return token;
  }

  /**
   * Send an RPC request to the backend via Centrifuge RPC.
   */
  private async rpc<T>(method: string, payload: unknown): Promise<T> {
    if (!this.centrifuge) {
      throw new Error('RTCAgentClient not connected');
    }
    if (this.connectionState !== 'connected') {
      throw new Error(
        `Cannot call RPC '${method}': connection state is ${this.connectionState}`,
      );
    }

    try {
      const result = await this.centrifuge.rpc(method, payload);
      return result.data as T;
    } catch (error) {
      log.error(`RPC '${method}' failed:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to the user's Topic and Live channels.
   *
   * - Topic channel (topic:u={userId}): persistent, supports offline recovery
   *   - Detects offset gaps and fills history automatically
   *   - Guarantees strict +1 offset continuity in onPublication callbacks
   * - Live channel (live:u={userId}): fire-and-forget, no recovery
   *
   * SECURITY: Validates userId before constructing channel names to prevent
   * injection attacks via malformed userId (e.g., containing ':' or '=')).
   */
  private subscribeChannels(): void {
    if (!this.centrifuge || !this.options.userId) return;

    const userId = this.options.userId;

    // SECURITY: Validate userId format (UUID-like) to prevent channel name injection.
    // Accepts standard UUID format (8-4-4-4-12) or simple alphanumeric strings.
    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
      log.error('invalid userId format, refusing to subscribe:', userId);
      this.emit('error', new Error('Invalid userId format for channel subscription'));
      return;
    }

    // Topic channel: supports offline recovery (Centrifuge handles this by default).
    const topicChannel = `topic:u=${userId}`;
    if (!this.subscriptions.has(topicChannel)) {
      const topicSub = this.centrifuge.newSubscription(topicChannel);
      this.subscriptions.set(topicChannel, topicSub);

      // dispatch -> [buffer] -> serial executor
      // Callback only dispatches to pendingUpdates buffer, returns immediately, never blocks Centrifuge.
      // Deduplication, serialization, and error handling are all handled by scheduleUpdate / processUpdateQueue.
      topicSub.on('publication', (ctx) => {
        this.scheduleUpdate(ctx.data as Update);
      });

      topicSub.on('subscribed', async (ctx) => {
        try {
          // Debug log: record subscribed event trigger
          log.debug(
            `Subscription 'subscribed' event: channel=${topicChannel}, ` +
              `serverOffset=${ctx.streamPosition?.offset}, epoch=${ctx.streamPosition?.epoch}, ` +
              `connectionState=${this.connectionState}`,
          );

          // On successful subscription, detect offset continuity to prevent losing offline messages.
          if (ctx.streamPosition) {
            const epoch = ctx.streamPosition.epoch;
            const serverOffset = ctx.streamPosition.offset;

            // Update epoch cache first (regardless of offset changes, epoch must be synced).
            this.epochCache.set(topicChannel, epoch);

            // Detect offset continuity (fast, sync check).
            const position = await this.options.getLastOffset?.(topicChannel);
            let localOffset: number | undefined;

            // Detect epoch change (e.g. server restart) and reset offset.
            if (position && position.epoch !== epoch) {
              log.warn(
                `Epoch changed: '${position.epoch}' -> '${epoch}', resetting offset to 0`,
              );
              await this.options.updateOffset?.(topicChannel, 0, epoch);
              localOffset = 0;
            } else {
              localOffset = position?.offset;
            }

            if (localOffset === undefined) {
              // No local record (first subscription) — use the server offset directly.
              await this.options.updateOffset?.(
                topicChannel,
                serverOffset,
                epoch,
              );
              localOffset = serverOffset;
            } else if (serverOffset <= localOffset) {
              // Server offset <= local offset: duplicate subscription or rollback — keep local.
            } else {
              // Gap exists — schedule async gap fill (non-blocking).
              // The gap fill will fetch history in batches and process through applyUpdates.
              // Note: serverOffset + 1 because toOffset is exclusive.
              this.scheduleGapFill(topicChannel, serverOffset + 1, epoch);
            }

            // Sync-update lastOffsetCache for scheduleUpdate enqueue dedup
            // (avoids awaiting IndexedDB during enqueue, which would re-block the callback)
            if (localOffset !== undefined) {
              this.lastOffsetCache.set(topicChannel, localOffset);
            }
          }
        } catch (err) {
          // SECURITY: Async callback errors won't be caught by Centrifuge.
          // Log and emit error to prevent silent failures.
          log.error('subscribed callback failed:', err);
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      });
    }
    // Ensure subscription is active (first connect calls this; reconnect relies on Centrifuge auto-resume).
    this.subscriptions.get(topicChannel)?.subscribe();

    // Live channel: fire-and-forget, no recovery.
    const liveChannel = `live:u=${userId}`;
    if (!this.subscriptions.has(liveChannel)) {
      const liveSub = this.centrifuge.newSubscription(liveChannel);
      this.subscriptions.set(liveChannel, liveSub);

      // Live channel: no offset continuity, but still fire-and-forget so slow
      // onPublication callbacks don't block Centrifuge's internal processing.
      liveSub.on('publication', (ctx) => {
        const event: PublicationEvent = {
          channel: liveChannel,
          data: ctx.data,
        };
        void this.handlePublication(event, liveSub);
      });
    }
    this.subscriptions.get(liveChannel)?.subscribe();
  }

  /**
   * Handle channel publication callback.
   *
   * If the callback throws, unsubscribe (crash semantics).
   *
   * PERFORMANCE MONITORING: Logs a warning for large messages (>10KB) to help identify
   * potential performance bottlenecks. Large messages can block the main thread during
   * JSON parsing and processing.
   */
  private async handlePublication(
    event: PublicationEvent,
    sub: ReturnType<Centrifuge['newSubscription']>,
  ): Promise<void> {
    if (!this.options.onPublication) return;

    // P2-2: Monitor large WebSocket messages for performance debugging
    const LARGE_MESSAGE_THRESHOLD = 10 * 1024; // 10KB
    try {
      const messageStr = JSON.stringify(event.data);
      if (messageStr.length > LARGE_MESSAGE_THRESHOLD) {
        log.warn(
          `Large WebSocket message: ${(messageStr.length / 1024).toFixed(1)}KB`,
          {
            channel: event.channel,
            type: (event.data as Record<string, unknown>)?.type,
          }
        );
      }
    } catch {
      // JSON.stringify failed (e.g., circular reference) - skip size monitoring
      log.debug('handlePublication: failed to estimate message size (non-fatal)');
    }

    try {
      await this.options.onPublication(event);
    } catch (err) {
      // Callback threw — unsubscribe to prevent further errors.
      log.error(`onPublication threw for channel '${event.channel}':`, err);
      sub.unsubscribe();
      throw err; // Propagate upward so the caller knows an error occurred.
    }
  }

  // ========== P2-6: Application-level heartbeat monitoring ==========

  /**
   * Start periodic heartbeat monitoring to detect stale connections.
   * If no message is received within HEARTBEAT_TIMEOUT_MS, trigger reconnection.
   *
   * SECURITY: This is a safety net to catch half-open connections that Centrifuge's
   * internal ping/pong might miss (e.g., due to proxy timeouts, NAT issues).
   * The timeout is intentionally conservative (60s) to avoid false positives on slow networks.
   */
  private _startHeartbeatMonitoring(): void {
    this._stopHeartbeatMonitoring(); // Clear any existing timer
    this._heartbeatCheckTimer = setInterval(() => {
      const timeSinceLastMessage = Date.now() - this._lastMessageTime;
      if (timeSinceLastMessage > RTCAgentClient.HEARTBEAT_TIMEOUT_MS) {
        log.warn(
          `Heartbeat timeout: no message received for ${timeSinceLastMessage}ms, triggering reconnect`,
        );
        // Emit error event to notify application
        this.emit(
          'error',
          new Error(
            `Heartbeat timeout: no message received for ${timeSinceLastMessage}ms`,
          ),
        );
        // Trigger reconnection
        // SECURITY: Only reconnect if we should reconnect and are not already in a reconnecting state
        if (this.shouldReconnect && !this._reconnecting) {
          this.reconnect().catch((err) => {
            log.error('Heartbeat-triggered reconnect failed:', err);
            // Restart heartbeat monitoring to continue detecting connection issues
            this._startHeartbeatMonitoring();
          });
        } else {
          log.debug(
            `Heartbeat timeout skipped: shouldReconnect=${this.shouldReconnect}, reconnecting=${this._reconnecting}`,
          );
        }
      } else {
        log.debug(
          `Heartbeat check: last message ${timeSinceLastMessage}ms ago (threshold: ${RTCAgentClient.HEARTBEAT_TIMEOUT_MS}ms)`,
        );
      }
    }, RTCAgentClient.HEARTBEAT_CHECK_INTERVAL_MS);
  }

  /**
   * Stop heartbeat monitoring.
   */
  private _stopHeartbeatMonitoring(): void {
    if (this._heartbeatCheckTimer) {
      clearInterval(this._heartbeatCheckTimer);
      this._heartbeatCheckTimer = undefined;
    }
  }
}
