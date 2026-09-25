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

  // ========== Update Scheduler: 调度 → [缓冲区] → 阻塞执行器 ==========
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

  constructor(options: RTCAgentClientOptions) {
    this.options = options;
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
      this.setConnectionState('connected');
      this.subscribeChannels();
    });
    this.centrifuge.on('disconnected', (ctx) => {
      log.debug(
        '[GAP_FILL_DEBUG] centrifuge disconnected, reason:', ctx?.reason,
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
   */
  private async waitForGapFill(channel: string, targetOffset: number): Promise<void> {
    const MAX_WAIT_MS = 30000; // 30 seconds timeout
    const POLL_INTERVAL_MS = 100;
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT_MS) {
      const position = await this.options.getLastOffset?.(channel);
      const currentOffset = position?.offset ?? 0;

      if (currentOffset >= targetOffset) {
        return; // Gap fill caught up
      }

      // Check if gap fill is still running for this channel
      if (!this.gapFillTasks.has(channel) && !this.isGapFillProcessing) {
        return; // Gap fill completed (or failed)
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Timeout — gap fill didn't complete in time
    log.warn(`waitForGapFill timeout: channel=${channel}, targetOffset=${targetOffset}`);
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

  // ========== Update Scheduler: 调度 → [缓冲区] → 阻塞执行器 ==========

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

    // 缓冲区去重 1: 过期消息 (offset <= 已处理的 lastOffset)
    if (update.offset > 0) {
      const cachedLastOffset = this.lastOffsetCache.get(channel);
      if (cachedLastOffset !== undefined && update.offset <= cachedLastOffset) {
        log.debug(
          `scheduleUpdate: skip expired offset=${update.offset}, lastOffset=${cachedLastOffset}`,
        );
        return;
      }
    }

    // 缓冲区去重 2: 队列中已有相同 offset
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
          // 成功后更新同步缓存（用于后续入队去重）
          if (update.offset > 0) {
            const channel = `topic:u=${this.options.userId}`;
            this.lastOffsetCache.set(channel, update.offset);
          }
        } catch (err) {
          log.error(`processUpdateQueue failed for offset ${update.offset}:`, err);
          this.emit('error', err instanceof Error ? err : new Error(String(err)));

          // 严重错误（如 gap fill 失败）→ 触发 reconnect，和原 publication 错误处理一致
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
            }, RTCAgentClient.RECONNECT_AFTER_SIZE_LIMIT_DELAY_MS);
          }
          // 严重错误，停止处理剩余队列 — reconnect 会清空状态
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
        `[GAP_FILL_DEBUG] scheduleGapFill merged: channel=${channel}, ` +
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

    // 调试日志：记录 gap fill 开始时的连接状态和 subscription 状态
    log.debug(
      `[GAP_FILL_DEBUG] runGapFill started: channel=${channel}, targetOffset=${targetOffset}, ` +
      `connectionState=${this.connectionState}, centrifuge=${!!this.centrifuge}, ` +
      `subState=${sub.state}`
    );

    const BATCH_SIZE = 10; // RPC 每次拉取的数量（避免返回内容过大）
    const ACCUMULATE_THRESHOLD = 10000; // 累积到此数量后去重
    // Only suspend UI updates for large gaps to prevent UI thrashing.
    // Small gaps (< 100) can update UI normally for real-time feedback.
    const SUSPEND_THRESHOLD = 100;

    // Get current offset to determine gap size
    const startPosition = await this.options.getLastOffset?.(channel);
    const currentOffset = startPosition?.offset ?? 0;
    const gapSize = targetOffset - currentOffset;

    console.log(`[BulkUpdate] runGapFill: gapSize=${gapSize}, threshold=${SUSPEND_THRESHOLD}`);

    // Notify UI that gap fill is starting (for large gaps)
    if (gapSize > SUSPEND_THRESHOLD) {
      console.log('[BulkUpdate] runGapFill: calling onGapFillStart');
      this.options.onGapFillStart?.();
      this.options.suspendUIUpdates?.();
    }

    // 缓冲区提升到 try 外面，断网时也能应用已拉取的内容
    let buffer: Update[] = [];
    let gapOffsets: number[] = [];
    let offset = currentOffset;

    try {
      // 外层循环：直到达到 targetOffset
      while (offset < targetOffset - 1) {
        buffer = [];
        gapOffsets = [];

        // 内层循环：分批拉取，累积到 ACCUMULATE_THRESHOLD+
        while (buffer.length < ACCUMULATE_THRESHOLD && offset < targetOffset - 1) {
          const remaining = targetOffset - offset - 1;
          const limit = Math.min(BATCH_SIZE, remaining);
          if (limit <= 0) break;

          const opts: HistoryOptions = {
            since: { offset, epoch },
            limit,
            reverse: false,
          };

          // 调试日志：记录调用 history 前的连接状态
          log.debug(
            `[GAP_FILL_DEBUG] Calling sub.history(): offset=${offset}, limit=${limit}, ` +
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

          // 分离 real updates 和 gap placeholders
          for (const pub of publications) {
            const data = pub.data as Record<string, unknown>;
            const pubOffset = pub.offset ?? 0;
            if (data?.type === 'gap') {
              // Gap placeholder: 记录 offset，稍后批量处理
              gapOffsets.push(pubOffset);
            } else {
              buffer.push(pub.data as Update);
            }
          }

          // 更新 offset 为当前批次的最后一个
          offset = publications[publications.length - 1].offset ?? offset;

          // If we got fewer publications than requested, we've reached the end
          if (publications.length < limit) break;
        }

        // 应用当前批次的缓冲区内容
        await this.flushGapFillBuffer(channel, buffer, gapOffsets, epoch);
      }
    } catch (err) {
      // 网络错误时，先应用缓冲区已拉取的内容
      if (buffer.length > 0 || gapOffsets.length > 0) {
        log.debug(`[GAP_FILL_DEBUG] Network error, flushing buffer before error handling: ${buffer.length} updates, ${gapOffsets.length} gap offsets`);
        try {
          await this.flushGapFillBuffer(channel, buffer, gapOffsets, epoch);
        } catch (flushErr) {
          log.error(`[GAP_FILL_DEBUG] Failed to flush buffer on error:`, flushErr);
        }
      }

      // 调试日志：记录错误发生时的详细上下文
      log.error(
        `[GAP_FILL_DEBUG] runGapFill failed for channel ${channel}:`,
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
      // Resume UI updates and notify UI only if we suspended
      if (gapSize > SUSPEND_THRESHOLD) {
        console.log('[BulkUpdate] runGapFill: calling resumeUIUpdates and onGapFillEnd');
        this.options.resumeUIUpdates?.();
        this.options.onGapFillEnd?.();
      }
    }
  }

  /**
   * Deduplicate updates at item level.
   * Key: `${entity}:${entity_id}`, keep the one with the smallest offset (first occurrence).
   * Server returns the latest entity data in the first Update, so we keep the earliest one.
   */
  private deduplicateUpdates(updates: Update[]): Update[] {
    const map = new Map<string, { item: UpdateItem; data: unknown; offset: number }>();

    for (const update of updates) {
      for (let i = 0; i < update.items.length; i++) {
        const item = update.items[i];
        const data = update.data_list?.[i];

        if (!data) continue;

        const key = `${item.entity}:${item.entity_id}`;
        const existing = map.get(key);
        if (!existing || update.offset < existing.offset) {
          // Keep the first occurrence (smallest offset) - server already returns latest data
          map.set(key, { item, data, offset: update.offset });
        }
      }
    }

    // Reconstruct as Update array (one item per Update), sorted by offset
    const result: Update[] = [];
    const byOffset = Array.from(map.values()).sort((a, b) => a.offset - b.offset);

    for (const { item, data, offset } of byOffset) {
      result.push({
        id: '', // Original Update id is not preserved after deduplication
        items: [item],
        data_list: [data],
        offset,
      });
    }

    return result;
  }

  /**
   * Flush gap fill buffer: process gap placeholders and deduplicated updates.
   * Used both in normal flow and on network error to apply buffered content.
   */
  private async flushGapFillBuffer(
    channel: string,
    buffer: Update[],
    gapOffsets: number[],
    epoch: string
  ): Promise<void> {
    // 处理 gap placeholders：批量更新 offset
    if (gapOffsets.length > 0) {
      const maxGapOffset = Math.max(...gapOffsets);
      await this.options.updateOffset?.(channel, maxGapOffset, epoch);
    }

    // 处理累积的 updates：去重后直接应用（不通过 applyUpdates，避免再次触发 gap fill）
    if (buffer.length > 0) {
      const deduplicated = this.deduplicateUpdates(buffer);

      // 直接调用 onPublication，跳过 applyUpdates 的 gap 检测
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

      // 全部成功后，更新 offset 到最大 offset
      const maxOffset = Math.max(...buffer.map(u => u.offset));
      await this.options.updateOffset?.(channel, maxOffset, epoch);
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

  private setConnectionState(state: ConnectionState, reason?: string): void {
    log.debug(
      '[GAP_FILL_DEBUG] setConnectionState:', state, 'reason:', reason,
      '| previous:', this.connectionState,
      '| timestamp:', new Date().toISOString()
    );
    if (this.connectionState === state) return;
    this.connectionState = state;
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

      // 调度 → [缓冲区] → 阻塞执行器
      // 回调只投递到 pendingUpdates 缓冲区，立刻返回，不阻塞 Centrifuge。
      // 去重、串行化、错误处理全部由 scheduleUpdate / processUpdateQueue 负责。
      topicSub.on('publication', (ctx) => {
        this.scheduleUpdate(ctx.data as Update);
      });

      topicSub.on('subscribed', async (ctx) => {
        // 调试日志：记录 subscribed 事件触发
        log.debug(
          `[GAP_FILL_DEBUG] Subscription 'subscribed' event: channel=${topicChannel}, ` +
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

          // 同步更新 lastOffsetCache，供 scheduleUpdate 入队去重使用
          // （避免入队时 await IndexedDB 重新阻塞回调）
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
