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
import {Centrifuge, HistoryOptions} from 'centrifuge';
import {RpcMethod, SendMessageRequest, ForkSessionRequest, Update, UpdateItem} from '@rtc-agent/protocol';
import type {
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
import {createLogger} from './logger.js';

const log = createLogger('RTCAgentClient');

/**
 * Error thrown when gap fill operation times out.
 */
export class GapFillTimeoutError extends Error {
  constructor(
    readonly channel: string,
    readonly targetOffset: number,
    readonly elapsedMs: number
  ) {
    super(`Gap fill timeout after ${elapsedMs}ms: channel=${channel}, target=${targetOffset}`);
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
 */
export class RTCAgentClient implements IRTCAgentClient {
  private readonly options: RTCAgentClientOptions;
  private centrifuge: Centrifuge | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private readonly listeners = new Map<EventName, Set<EventCallback<EventName>>>();
  /** Whether reconnection should continue (set to false when relogin is required). */
  private shouldReconnect = true;
  /** Whether a connection was ever established (distinguishes first connect from reconnect). */
  private wasConnected = false;
  /** Serialised queue for processing updates. */
  private applyUpdatesQueue: Promise<void> | null = null;
  /** Cached subscription objects keyed by channel name. */
  private readonly subscriptions = new Map<string, ReturnType<Centrifuge['newSubscription']>>();
  /** Cached epoch per channel. */
  private readonly epochCache = new Map<string, string>();
  /** Pending reconnect timer (cleared on explicit disconnect to prevent zombie reconnects). */
  private _reconnectTimer?: ReturnType<typeof setTimeout>;
  /** Active gap fill tasks per channel (for deduplication and merging). */
  private readonly gapFillTasks = new Map<string, { targetOffset: number; epoch: string }>();
  /** Whether gap fill processing is currently running. */
  private isGapFillProcessing = false;
  /** AbortControllers for active gap fill waits (cleared on disconnect). */
  private readonly _gapFillAbortControllers = new Map<string, AbortController>();
  /** Current delay for exponential backoff after gap fill failure. Initialized in constructor. */
  private _reconnectDelay!: number;

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

  constructor(options: RTCAgentClientOptions) {
    this.options = options;
    this._reconnectDelay = RTCAgentClient.RECONNECT_INITIAL_DELAY_MS;
  }

  // ========== Lifecycle ==========

  async connect(): Promise<void> {
    log.debug('connect() called, current state:', this.connectionState);
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      log.debug('connect() early return, already', this.connectionState);
      return;
    }
    this.shouldReconnect = true;
    this.setConnectionState('connecting');

    this.centrifuge = new Centrifuge(this.options.endpoint, {
      getToken: async () => {
        const token = await this.options.getToken();

        // Only trigger the refresh callback when the token is actually expired,
        // avoiding unnecessary HTTP requests on every reconnect.
        if (this._isTokenExpired(token) && this.options.onTokenExpired) {
          log.warn('[Centrifuge] token is expired, requesting refresh...');
          const action: TokenExpiredAction = await this.options.onTokenExpired();
          if (action === 'relogin') {
            // Relogin required — stop reconnecting.
            this.shouldReconnect = false;
            this.centrifuge?.disconnect();
            this.setConnectionState('disconnected', 'token expired, relogin required');
            throw new Error('Token expired, user needs to re-login');
          }
          // action === 'refresh' — token has been refreshed, fetch the new one.
          return this.options.getToken();
        }

        return token;
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
      this.setConnectionState('connected');
      this.subscribeChannels();
    });
    this.centrifuge.on('disconnected', (ctx) => {
      log.debug(
        'centrifuge disconnected, reason:', ctx?.reason,
        '| code:', ctx?.code,
        '| wasConnected:', this.wasConnected,
        '| shouldReconnect:', this.shouldReconnect,
        '| activeGapFills:', this.gapFillTasks.size
      );

      // Detect server-side token rejection (e.g. "invalid token").
      // Even if the JWT is not expired, we need to trigger the refresh mechanism.
      if (ctx?.reason === 'invalid token' && this.options.onTokenExpired) {
        // Critical fix: immediately disconnect the Centrifuge instance to prevent it from
        // auto-reconnecting with the cached old token. Centrifuge reuses cached tokens on
        // reconnect, so the newly refreshed token would never take effect.
        const oldCentrifuge = this.centrifuge;
        this.centrifuge = null; // Clear reference to prevent subsequent ops on old instance.
        oldCentrifuge?.disconnect(); // Explicit disconnect to stop auto-reconnect.
        this.handleInvalidToken();
      }

      // Detect message-size-limit exceeded: server rejects the connection and Centrifuge
      // does not auto-retry this type of server-side rejection.
      if (ctx?.reason === 'message size limit exceeded') {
        log.warn('message size limit exceeded, will retry connection after delay');
        // Delay reconnect to give the server some buffer time.
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = undefined;
          if (this.shouldReconnect && this.connectionState === 'disconnected') {
            log.debug('attempting reconnect after message size limit error');
            this.reconnect().catch(err => {
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
    log.debug('centrifuge.connect() returned, state:', this.connectionState, '(WebSocket not yet established)');
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.wasConnected = false;
    // Clear any pending reconnect timer to prevent zombie reconnects after explicit disconnect.
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }
    // Abort all active gap fill waits to prevent zombie timers
    this._gapFillAbortControllers.forEach(controller => controller.abort());
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
    this.disconnect();
    await this.connect();
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get the current user ID.
   */
  getUserId(): string | undefined {
    return this.options.userId;
  }

  // ========== Sessions ==========

  async listSessions(cursor?: string, limit?: number): Promise<ListSessionsResponse> {
    return this.rpc<ListSessionsResponse>(RpcMethod.SessionList, { cursor, limit });
  }

  async getSession(sessionId: string): Promise<GetSessionResponse> {
    return this.rpc<GetSessionResponse>(RpcMethod.SessionGet, { session_id: sessionId });
  }

  async closeSession(sessionId: string): Promise<CloseSessionResponse> {
    return this.rpc<CloseSessionResponse>(RpcMethod.SessionClose, { session_id: sessionId });
  }

  async openSession(sessionId: string): Promise<OpenSessionResponse> {
    return this.rpc<OpenSessionResponse>(RpcMethod.SessionOpen, { session_id: sessionId });
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

  // ========== Messages & Turns ==========

  /**
   * Send a message.
   *
   * @param req - SendMessageRequest; client_id is used by the server for idempotent dedup.
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

  // ========== RTC (Tool Calls) ==========

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
  async applyUpdates(updates: Update[], callback?: () => Promise<void>): Promise<void> {
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
        if (newLastOffset === undefined || newLastOffset !== update.offset - 1) {
          // Gap fill failed — reject this update to maintain strict +1 continuity.
          throw new Error(
            `[RTCAgentClient] Offset gap fill failed: expected ${update.offset - 1}, got ${newLastOffset}. ` +
            `Rejecting update ${update.offset} to maintain strict +1 continuity.`
          );
        }
        if (newLastEpoch !== undefined && newLastEpoch !== expectedEpoch) {
          // Epoch changed (possible server restart) — reject to prevent data corruption.
          throw new Error(
            `[RTCAgentClient] Epoch mismatch after gap fill: expected '${expectedEpoch}', got '${newLastEpoch}'. ` +
            `Rejecting update ${update.offset} to prevent data corruption.`
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
   * @throws {GapFillTimeoutError} If gap fill doesn't complete within timeout
   * @throws {Error} If wait is aborted (e.g., during disconnect)
   */
  private async waitForGapFill(channel: string, targetOffset: number): Promise<void> {
    const MAX_WAIT_MS = 30000; // 30 seconds timeout
    const POLL_INTERVAL_MS = 100;
    const startTime = Date.now();

    // Create AbortController for this gap fill wait
    const waitAbort = new AbortController();
    const mapKey = `${channel}:${targetOffset}`;
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

        // Wait a bit before checking again, but abortable
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, POLL_INTERVAL_MS);
          waitAbort.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error(`Gap fill aborted for channel ${channel}`));
          }, { once: true });
        });
      }

      // Timeout — throw explicit error instead of silent return
      const elapsedMs = Date.now() - startTime;
      throw new GapFillTimeoutError(channel, targetOffset, elapsedMs);
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
    if (update.offset > 0 && this.pendingUpdates.some(u => u.offset === update.offset)) {
      log.debug(`scheduleUpdate: skip duplicate in buffer offset=${update.offset}`);
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
          log.error(`processUpdateQueue failed for offset ${update.offset}:`, err);
          this.emit('error', err instanceof Error ? err : new Error(String(err)));

          // Critical error (e.g., gap fill failure) -> trigger reconnect, same as publication error handling
          if (this.shouldReconnect) {
            this.centrifuge?.disconnect();
            this.setConnectionState('disconnected', 'update processing failed');
            this.emit('syncRequired', {
              reason: 'gap_fill_failed',
              lastKnownOffset: update.offset - 1,
              serverOffset: update.offset,
            });
            this._reconnectTimer = setTimeout(() => {
              this._reconnectTimer = undefined;
              if (this.shouldReconnect && this.connectionState === 'disconnected') {
                log.debug('attempting reconnect after update processing failure');
                this.reconnect().catch(e => log.error('reconnect failed:', e));
              }
            }, this._reconnectDelay);
            // Exponential backoff for next failure
            this._reconnectDelay = Math.min(
              this._reconnectDelay * RTCAgentClient.RECONNECT_BACKOFF_MULTIPLIER,
              RTCAgentClient.RECONNECT_MAX_DELAY_MS
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
  private scheduleGapFill(channel: string, targetOffset: number, epoch: string): void {
    const pending = this.gapFillTasks.get(channel);
    if (pending) {
      // Merge: extend to the maximum range, no re-trigger needed.
      pending.targetOffset = Math.max(pending.targetOffset, targetOffset);
      pending.epoch = epoch;
      log.debug(
        `scheduleGapFill merged: channel=${channel}, ` +
        `targetOffset=${pending.targetOffset}, isProcessing=${this.isGapFillProcessing}`
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
        const [channel, { targetOffset, epoch }] = this.gapFillTasks.entries().next().value!;

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
   */
  private async runGapFill(channel: string, targetOffset: number, epoch: string): Promise<void> {
    const sub = this.subscriptions.get(channel);
    if (!sub) {
      log.warn(`runGapFill: subscription not found for channel ${channel}`);
      return;
    }

    // Debug log: record connection state and subscription state at gap fill start
    log.debug(
      `runGapFill started: channel=${channel}, targetOffset=${targetOffset}, ` +
      `connectionState=${this.connectionState}, centrifuge=${!!this.centrifuge}, ` +
      `subState=${sub.state}`
    );

    const BATCH_SIZE = 100; // Number of items per RPC call (avoid oversized responses)
    // ACCUMULATE_THRESHOLD: Maximum number of updates to accumulate before flushing.
    // Must be kept well below UIUpdateBus.MAX_SUSPENDED_EVENTS (1000) to prevent
    // "Suspended events limit exceeded" errors during gap fill. Each update can
    // generate multiple UI events (one per entity change), so we use a conservative
    // threshold to account for this multiplier effect.
    const ACCUMULATE_THRESHOLD = 800;
    // Only suspend UI updates for large gaps to prevent UI thrashing.
    // Small gaps (< 100) can update UI normally for real-time feedback.
    const SUSPEND_THRESHOLD = 100;

    // Get current offset to determine gap size
    const startPosition = await this.options.getLastOffset?.(channel);
    const currentOffset = startPosition?.offset ?? 0;
    const gapSize = targetOffset - currentOffset;

    log.debug(`[BulkUpdate] runGapFill: gapSize=${gapSize}, threshold=${SUSPEND_THRESHOLD}`);

    // Buffer hoisted outside try so content fetched before disconnect can still be applied
    let buffer: Update[] = [];
    let gapOffsets: number[] = [];
    let offset = currentOffset;

    // Track suspend state to avoid nested suspend calls.
    // Nested suspends cause event accumulation beyond UIUpdateBus.MAX_SUSPENDED_EVENTS (1000).
    // We use a flag to ensure only the outermost gap fill operation suspends UI updates.
    const shouldSuspendUI = gapSize > SUSPEND_THRESHOLD;
    let isUISuspended = false;

    try {
      // Outer loop: continue until reaching targetOffset
      while (offset < targetOffset - 1) {
        buffer = [];
        gapOffsets = [];

        // Suspend UI updates once at the start of bulk processing (if needed).
        // This avoids nested suspend/resume calls which would accumulate events.
        if (shouldSuspendUI && !isUISuspended) {
          log.debug('[BulkUpdate] runGapFill: calling onGapFillStart');
          this.options.onGapFillStart?.();
          this.options.suspendUIUpdates?.();
          isUISuspended = true;
        }

        // Inner loop: fetch in batches, accumulate to ACCUMULATE_THRESHOLD+
        // Note: We no longer call flushGapFillBuffer inside this loop with suspend/resume.
        // Instead, we accumulate updates and flush them in batches to prevent
        // exceeding the UI event limit.
        while (buffer.length < ACCUMULATE_THRESHOLD && offset < targetOffset - 1) {
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
            `subState=${sub.state}`
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
              throw new Error(`Gap fill non-continuous: offset jumped from ${prev} to ${curr}`);
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
        // Pass isUISuspended to indicate UI updates are already suspended at outer level
        await this.flushGapFillBuffer(channel, buffer, gapOffsets, epoch, isUISuspended);
      }
    } catch (err) {
      // On network error, apply already-fetched buffer content first
      if (buffer.length > 0 || gapOffsets.length > 0) {
        log.debug(`Network error, flushing buffer before error handling: ${buffer.length} updates, ${gapOffsets.length} gap offsets`);
        try {
          await this.flushGapFillBuffer(channel, buffer, gapOffsets, epoch, isUISuspended);
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
        `| epoch=${epoch}`
      );
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.emit('syncRequired', {
        reason: 'gap_fill_failed',
        lastKnownOffset: (await this.options.getLastOffset?.(channel))?.offset,
        serverOffset: targetOffset,
      });
    } finally {
      // Resume UI updates and notify UI only if we suspended at the outer level.
      // This check is critical to avoid resuming when suspend was never called,
      // which would break the suspend depth counter.
      if (isUISuspended) {
        log.debug('[BulkUpdate] runGapFill: calling resumeUIUpdates and onGapFillEnd');
        this.options.resumeUIUpdates?.();
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
    const map = new Map<string, {
      first: { item: UpdateItem; data: unknown; offset: number };
      last: { item: UpdateItem; data: unknown; offset: number };
    }>();

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
    uiAlreadySuspended: boolean = false
  ): Promise<void> {
    // Process accumulated updates: deduplicate then apply in batch
    if (buffer.length > 0) {
      const deduplicated = this.deduplicateUpdates(buffer);

      // Only suspend UI updates if not already suspended by caller.
      // Nested suspend calls cause event accumulation beyond the 1000 event limit.
      if (!uiAlreadySuspended) {
        this.options.suspendUIUpdates?.();
      }

      try {
        // Prefer batch callback for optimized processing
        if (this.options.onPublications) {
          const events = deduplicated.map(update => ({
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
        const allOffsets = [...gapOffsets, ...buffer.map(u => u.offset)];
        const maxOffset = Math.max(...allOffsets);
        await this.options.updateOffset?.(channel, maxOffset, epoch);
      } finally {
        // Only resume UI updates if we suspended them in this function call.
        // If caller already suspended, they are responsible for resuming.
        if (!uiAlreadySuspended) {
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

  private emit<E extends EventName>(event: E, payload: RTCAgentClientEvents[E]): void {
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
    log.debug('setConnectionState:', state, 'reason:', reason,
      '| previous:', this.connectionState,
      '| timestamp:', new Date().toISOString()
    );
    // Only skip if both state and reason are unchanged
    if (this.connectionState === state && this._connectionReason === reason) return;
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
   */
  private async handleInvalidToken(): Promise<void> {
    if (!this.options.onTokenExpired) {
      log.warn('invalid token but no onTokenExpired callback provided');
      return;
    }

    try {
      const action: TokenExpiredAction = await this.options.onTokenExpired();
      if (action === 'relogin') {
        // Relogin required — stop reconnecting.
        this.shouldReconnect = false;
        this.centrifuge?.disconnect();
        this.setConnectionState('disconnected', 'token expired, relogin required');
      } else {
        // action === 'refresh' — token refreshed, attempt reconnect.
        log.debug('token refreshed, attempting to reconnect');
        // Delayed reconnect to avoid rapid retry loops.
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = undefined;
          if (this.shouldReconnect) {
            this.reconnect().catch(err => {
              log.error('reconnect after token refresh failed:', err);
            });
          }
        }, RTCAgentClient.RECONNECT_AFTER_TOKEN_REFRESH_DELAY_MS);
      }
    } catch (err) {
      log.error('handleInvalidToken failed:', err);
    }
  }

  /**
   * Check whether a JWT has expired.
   *
   * Parses the exp claim from the JWT payload (Unix timestamp in seconds)
   * and compares it with the current time. Returns false on parse failure
   * (to avoid blocking connections due to malformed tokens).
   */
  private _isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        log.debug('_isTokenExpired: token does not have 3 parts, treating as not expired');
        return false;
      }
      const payload = JSON.parse(atob(parts[1]));
      if (typeof payload.exp !== 'number') {
        log.debug('_isTokenExpired: payload.exp is not a number, treating as not expired');
        return false;
      }
      const expired = payload.exp * 1000 < Date.now();
      log.debug('_isTokenExpired: exp=', payload.exp, 'expired=', expired);
      return expired;
    } catch (err) {
      // JWT parse failed — don't block the connection.
      log.debug('_isTokenExpired: failed to parse JWT, treating as not expired:', err);
      return false;
    }
  }

  /**
   * Send an RPC request to the backend via Centrifuge RPC.
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
   */
  private subscribeChannels(): void {
    if (!this.centrifuge || !this.options.userId) return;

    const userId = this.options.userId;

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
        // Debug log: record subscribed event trigger
        log.debug(
          `Subscription 'subscribed' event: channel=${topicChannel}, ` +
          `serverOffset=${ctx.streamPosition?.offset}, epoch=${ctx.streamPosition?.epoch}, ` +
          `connectionState=${this.connectionState}`
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
            log.warn(`Epoch changed: '${position.epoch}' -> '${epoch}', resetting offset to 0`);
            await this.options.updateOffset?.(topicChannel, 0, epoch);
            localOffset = 0;
          } else {
            localOffset = position?.offset;
          }

          if (localOffset === undefined) {
            // No local record (first subscription) — use the server offset directly.
            await this.options.updateOffset?.(topicChannel, serverOffset, epoch);
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
   */
  private async handlePublication(
    event: PublicationEvent,
    sub: ReturnType<Centrifuge['newSubscription']>
  ): Promise<void> {
    if (!this.options.onPublication) return;

    try {
      await this.options.onPublication(event);
    } catch (err) {
      // Callback threw — unsubscribe to prevent further errors.
      log.error(`onPublication threw for channel '${event.channel}':`, err);
      sub.unsubscribe();
      throw err; // Propagate upward so the caller knows an error occurred.
    }
  }
}
