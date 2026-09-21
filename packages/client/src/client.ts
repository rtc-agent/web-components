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
      log.debug('centrifuge disconnected, reason:', ctx?.reason);

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
        // Gap detected — fill history.
        await this.fillOffsetGap(channel, lastOffset, lastEpoch, update.offset);

        // Post-fill verification: did fillOffsetGap advance the offset to update.offset - 1?
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
    log.debug('setConnectionState:', state, 'reason:', reason, 'previous:', this.connectionState);
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

      topicSub.on('publication', async (ctx) => {
        // Construct the Update object (assuming data is of Update type).
        const update = ctx.data as Update;

        // Process through applyUpdates (continuity detection + gap fill + serialisation).
        // applyUpdates may throw (e.g. gap fill failure) — must catch to prevent
        // unhandled promise rejection. An exception means offset continuity is broken
        // and subsequent messages cannot be processed; reconnect or reset offset.
        try {
          await this.applyUpdates([update]);
        } catch (err) {
          log.error(
            `applyUpdates failed for offset ${update.offset} on channel ${topicChannel}:`,
            err,
          );
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      });

      topicSub.on('subscribed', async (ctx) => {
        // On successful subscription, detect offset continuity to prevent losing offline messages.
        if (ctx.streamPosition) {
          const epoch = ctx.streamPosition.epoch;
          const serverOffset = ctx.streamPosition.offset;

          // Update epoch cache first (regardless of offset changes, epoch must be synced).
          this.epochCache.set(topicChannel, epoch);

          // Declare localOffset outside callback so the catch block can access it.
          let localOffset: number | undefined;

          try {
            // Route gap fill through applyUpdates queue to serialise with publication events.
            // This prevents race conditions where concurrent publication processing and
            // subscribed gap fill could cause duplicate message processing or offset rollback.
            await this.applyUpdates([], async () => {
              // Detect offset continuity.
              const position = await this.options.getLastOffset?.(topicChannel);

              // Fix 3: Detect epoch change (e.g. server restart) and reset offset.
              // Without this, subsequent gap fills would use the old epoch and fail permanently,
              // locking the client into a state where all future messages are rejected.
              let epochChanged = false;
              if (position && position.epoch !== epoch) {
                log.warn(
                  `Epoch changed: '${position.epoch}' -> '${epoch}', resetting offset to 0`,
                );
                await this.options.updateOffset?.(topicChannel, 0, epoch);
                localOffset = 0;
                epochChanged = true;
              } else {
                localOffset = position?.offset;
              }

              if (localOffset === undefined) {
                // No local record (first subscription) — use the server offset directly.
                await this.options.updateOffset?.(topicChannel, serverOffset, epoch);
              } else if (serverOffset <= localOffset) {
                // Server offset <= local offset: duplicate subscription or rollback — keep local.
                // Don't overwrite to prevent re-processing messages after a rollback.
              } else {
                // serverOffset > localOffset: gap exists — fill history.
                // Note: when serverOffset === localOffset + 1, the server has one new message
                // (offset=serverOffset) that the client hasn't received yet — also needs filling.
                // When epoch changed, use the new epoch; otherwise use the stored epoch.
                const lastEpoch = epochChanged ? epoch : (position?.epoch ?? epoch);
                // Fill range: (localOffset, serverOffset], i.e. localOffset+1 to serverOffset.
                // fillOffsetGap's toOffset parameter is exclusive, so pass serverOffset + 1.
                await this.fillOffsetGap(topicChannel, localOffset, lastEpoch, serverOffset + 1);

                // Post-fill verification: offset should have advanced to serverOffset.
                const newPosition = await this.options.getLastOffset?.(topicChannel);
                const newOffset = newPosition?.offset;
                const newEpoch = newPosition?.epoch;

                if (newOffset === undefined || newOffset !== serverOffset) {
                  throw new Error(
                    `[RTCAgentClient] Offset gap fill failed on subscribe: expected ${serverOffset}, got ${newOffset}. ` +
                      `Offline updates may be lost.`,
                  );
                }
                if (newEpoch !== undefined && newEpoch !== epoch) {
                  throw new Error(
                    `[RTCAgentClient] Epoch mismatch after gap fill on subscribe: expected '${epoch}', got '${newEpoch}'. ` +
                      `Server may have restarted.`,
                  );
                }

                // Gap fill succeeded — update to the latest offset.
                await this.options.updateOffset?.(topicChannel, serverOffset, epoch);
              }
            });
          } catch (err) {
            log.error(
              `fillOffsetGap failed on subscribe for offset ${serverOffset}:`,
              err,
            );
            this.emit('error', err instanceof Error ? err : new Error(String(err)));

            // Fix 5: Enhanced error recovery — disconnect and notify application.
            // Do NOT reset offset to 0; let the application decide how to recover.
            this.centrifuge?.disconnect();
            this.setConnectionState('disconnected', 'gap fill failed');
            this.emit('syncRequired', {
              reason: 'gap_fill_failed',
              lastKnownOffset: localOffset,
              serverOffset: serverOffset,
            });
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
   * Fill historical messages for an offset gap.
   *
   * @param channel Channel name
   * @param fromOffset Start offset (exclusive)
   * @param epoch Start epoch
   * @param toOffset Target offset (exclusive); undefined means fetch up to latest
   */
  private async fillOffsetGap(
    channel: string,
    fromOffset: number,
    epoch: string,
    toOffset?: number
  ): Promise<void> {
    const sub = this.subscriptions.get(channel);
    if (!sub) {
      log.warn(`fillOffsetGap: subscription not found for channel ${channel}`);
      return;
    }

    let opts: HistoryOptions = {
      since: { offset: fromOffset, epoch },
      limit: undefined,
      reverse: false, // Ascending order: old to new.
    };
    if (toOffset) {
      const limit = toOffset - fromOffset - 1;
      if (limit <= 0) return;
      opts.limit = limit;
    }

    try {
      const historyResult = await sub.history(opts);
      const publications = historyResult.publications;

      // Validate message continuity: history must be complete and start from fromOffset + 1.
      // Note: we do NOT validate count because Centrifuge history has TTL — messages may expire.
      if (toOffset !== undefined && publications.length > 0) {
        const firstOffset = (publications[0].data as Update).offset;
        if (firstOffset !== fromOffset + 1) {
          throw new Error(
            `Gap fill missing messages: expected first offset ${fromOffset + 1}, got ${firstOffset}`,
          );
        }
        for (let i = 1; i < publications.length; i++) {
          const prev = (publications[i - 1].data as Update).offset;
          const curr = (publications[i].data as Update).offset;
          if (curr !== prev + 1) {
            throw new Error(`Gap fill non-continuous: offset jumped from ${prev} to ${curr}`);
          }
        }
      }

      // Process historical messages in order.
      for (const pub of publications) {
        const update = pub.data as Update;
        await this.processUpdate(update);
      }
    } catch (err) {
      // Re-throw so the caller (processUpdate) knows gap fill failed.
      // The caller will reject subsequent updates to maintain strict +1 continuity.
      log.error(`fillOffsetGap failed for channel ${channel}:`, err);
      throw err;
    }
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
