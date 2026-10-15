import type {
  ConnectionState,
  ConnectionStateEvent,
  HeadObjectResult,
  TokenExpiredAction,
} from '@rtc-agent/client';
import {
  type AgentMdConfig,
  type CachedFileInfo,
  createPersistenceLayer,
  type DebugHistoryItem,
  type FileCacheEntry,
  type FileSyncStatus,
  type FileSystemEntryType,
  type FileSystemMetadataOverride,
  type GrepResult,
  getDatabase,
  getOffsetManager,
  getUIUpdateBus,
  initializeVirtualFS,
  type LocalMessage,
  type LocalRtc,
  type LocalSession,
  type PagedResult,
  type PersistenceConfig,
  type UIUpdateEvent,
  type UIUpdateQueueEntry,
  virtualFS,
} from '@rtc-agent/persistence';
import type { ContentData } from '@rtc-agent/protocol';
import { createLogger } from '@rtc-agent/protocol';
import type {
  WorkerCallbacks,
  WorkerPersistenceCore,
} from './core-interface.js';

const log = createLogger('WorkerCore');

type PersistenceLayer = ReturnType<typeof createPersistenceLayer>;

/**
 * Type guard for Promise-like objects (thenables).
 *
 * Used to detect Promise return values from callbacks, which may be either:
 * - Actual Promise instances (from async functions)
 * - Comlink proxy Promises (which are Promise-like but not instanceof Promise)
 *
 * This avoids using 'as any' casts when checking for .then() method.
 */
function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * WorkerPersistenceCore implementation.
 *
 * - Wraps PersistenceLayer, passing through all query/operation methods
 * - Subscribes to UIUpdateBus, broadcasting events to all registered Tab callbacks
 * - Token requests: forwarded to any registered requestToken callback
 *
 * PERFORMANCE MONITORING (P2-1):
 * This class includes performance.mark() calls at critical paths:
 * - IndexedDB batch operations (batchWriteFiles)
 * - WebSocket message broadcasting (broadcastUIUpdate)
 *
 * For detailed architecture analysis and optimization recommendations,
 * see: /docs/worker-task-offloading.md
 *
 * ARCHITECTURE LIMITATIONS (P2-2):
 * - JSON serialization still runs on main thread (migration benefit is limited due to Comlink overhead)
 * - DOM operations cannot be moved to Worker (Window API restriction)
 * - Large data transfers incur copying overhead (consider Transferable Objects for optimization)
 */
export class WorkerCore implements WorkerPersistenceCore {
  private layer: PersistenceLayer | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private _disposeCoordinator: (() => void) | null = null;

  /** Timer for periodic UI update queue cleanup (prevents unbounded growth). */
  private _cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  /** Promise-based dedup guard for concurrent init() calls (e.g., React StrictMode). */
  private _initPromise: Promise<void> | null = null;

  /** Promise-based dedup guard for concurrent close() calls from multiple tabs. */
  private _closePromise: Promise<void> | null = null;

  /** Callback sets for all connected Tabs */
  private callbacks = new Set<WorkerCallbacks>();

  /**
   * Number of currently registered callbacks (connected tabs).
   * Used by shared-worker.ts to determine if teardown is needed on tab disconnect.
   */
  get callbackCount(): number {
    return this.callbacks.size;
  }

  /**
   * Track consecutive broadcast failures per callback.
   * When a tab crashes or disconnects abnormally (without calling close()),
   * its callback remains in the Set but every broadcast attempt fails.
   * After MAX_CONSECUTIVE_FAILURES consecutive failures, the callback is
   * automatically removed to prevent unbounded accumulation of dead callbacks.
   *
   * Normal disconnection (via close()) removes the callback immediately,
   * so this counter only increments for abnormal disconnections.
   *
   * P3-1 FIX: Document cleanup strategy and lifecycle.
   * CLEANUP STRATEGY:
   * 1. Success resets: When a callback succeeds (sync or async), its failure count
   *    is immediately reset to 0 via _callbackFailureCounts.delete(cb). This ensures
   *    transient failures don't accumulate over time.
   * 2. Threshold removal: After MAX_CONSECUTIVE_FAILURES (3) consecutive failures,
   *    the callback is removed from both callbacks Set and _callbackFailureCounts Map.
   *    This happens in _removeDeadCallback(), which logs the removal for observability.
   * 3. Explicit cleanup: unregisterCallback() and close() remove the callback's
   *    failure count entry immediately, ensuring no stale entries persist.
   * 4. Global cleanup: _doClose() clears the entire Map when the last tab disconnects,
   *    preventing memory leaks in the SharedWorker.
   *
   * LIFECYCLE GUARANTEES:
   * - Entries are never orphaned: every callback in the Set has a corresponding entry
   *   in the Map (or vice versa). This invariant is maintained by always adding/removing
   *   entries in pairs.
   * - Memory usage is bounded: Map size <= callbacks.size <= number of connected tabs.
   *   Even in pathological scenarios (1000s of tab crashes), the Map is bounded by the
   *   number of concurrent connections, not the total number of historical connections.
   * - Self-healing: if a tab crashes and stops responding, the failure count mechanism
   *   automatically cleans it up within 3 broadcast attempts (typically <1 second).
   */
  private _callbackFailureCounts = new Map<WorkerCallbacks, number>();
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  /**
   * Map of operationId -> AbortController for file operations.
   *
   * When WorkerBridge starts an upload/download, it generates a unique operationId.
   * WorkerCore creates an AbortController, stores it here, and passes its signal
   * to PersistenceLayer. When WorkerBridge calls cancelFileOperation(operationId),
   * the controller is aborted, which cancels the underlying HTTP request.
   */
  private _operationControllers = new Map<string, AbortController>();

  /**
   * Initialize shared state.
   *
   * - Creates PersistenceLayer (internally holds RTCAgentClient + IndexedDB + EntityRepository)
   * - Subscribes to UIUpdateBus for broadcasting to all Tabs
   * - Idempotent (subsequent init calls are ignored)
   * - Concurrent-safe: concurrent calls (e.g., React StrictMode) share the same Promise
   */
  async init(config: PersistenceConfig): Promise<void> {
    if (this.layer) {
      log.warn('already initialized, ignoring init()');
      return;
    }

    // Promise-based dedup: concurrent init() calls share the same initialization
    // This prevents duplicate bus.subscribe() calls in React StrictMode
    if (this._initPromise) {
      log.debug('init() already in progress, reusing existing promise');
      return this._initPromise;
    }

    this._initPromise = this._doInit(config);
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /**
   * Internal initialization logic (extracted for Promise-based dedup).
   */
  private async _doInit(config: PersistenceConfig): Promise<void> {
    // Bridge RTCAgentClient's getToken / onTokenExpired to callbacks.
    // Note: callbacks is still empty at this point, but they are only invoked during connect().
    const bridgedConfig: PersistenceConfig = {
      ...config,
      client: {
        ...config.client,
        getToken: () => this.requestToken(),
        onTokenExpired: () => this.requestTokenRefresh(),
        onGapFillStart: () => this.broadcastGapFillState(true),
        onGapFillEnd: () => this.broadcastGapFillState(false),
        onAccountBanned: (reason: string) =>
          this.broadcastAccountBanned(reason),
      },
    };

    this.layer = createPersistenceLayer(bridgedConfig);

    // P2-NEW-3 fix + P2-D update: inject status change listener into FileOpCoordinator
    // Returns a dispose function for teardown.
    const fileOpCoordinator = this.layer.getFileOpCoordinator();
    this._disposeCoordinator = fileOpCoordinator.onStatusChange(
      (md5, ext, status, errorMessage) => {
        this._broadcastFileSyncStatus(md5, ext, status, errorMessage);
      },
    );

    // Initialize UIUpdateBus: set the _initialized flag so publish() persists events.
    const bus = getUIUpdateBus();
    await bus.init();

    // Subscribe to UIUpdateBus to broadcast events to all registered callbacks.
    // publish() passes the per-event seq directly to the subscriber.
    this.unsubscribeBus = bus.subscribe((event: UIUpdateEvent, seq: number) => {
      this.broadcastUIUpdate(event, seq);
    });

    // Start periodic TTL cleanup for the UI update queue (30-minute TTL).
    // Uses setTimeout (not setInterval) so the timer can be stopped when no tabs
    // are connected, allowing the SharedWorker to be garbage-collected by the browser.
    this._scheduleCleanup();
  }

  /**
   * Register a Tab's callbacks.
   */
  registerCallback(cb: WorkerCallbacks): void {
    this.callbacks.add(cb);
    // Restart cleanup timer if it was stopped (e.g., after all tabs disconnected)
    if (this._cleanupTimer === null) {
      this._scheduleCleanup();
    }
  }

  /**
   * Unregister a Tab's callbacks.
   */
  unregisterCallback(cb: WorkerCallbacks): void {
    this.callbacks.delete(cb);
    this._callbackFailureCounts.delete(cb);
  }

  /**
   * Get persistent UI update events for catch-up after page refresh or reconnection.
   *
   * Returns events from the IndexedDB queue where seq > fromSeq, ordered by seq ascending.
   * The main thread uses this to replay missed events that were persisted while the tab
   * was disconnected or refreshing.
   *
   * Also detects gaps: if fromSeq > 0 but the lowest returned seq > fromSeq + 1,
   * some events were deleted (by TTL cleanup) before the tab could catch up.
   * The caller should trigger a full state refresh when hasGap is true.
   *
   * @param fromSeq - Return events with seq > fromSeq
   * @param limit - Maximum number of events to return (default: 1000). Prevents memory
   *                issues when a tab has been offline for a long time.
   * @returns entries, hasGap (events were skipped), hasMore (more events available beyond limit)
   */
  async getCatchUpEvents(
    fromSeq: number,
    limit = 1000,
  ): Promise<{
    entries: UIUpdateQueueEntry[];
    hasGap: boolean;
    hasMore: boolean;
  }> {
    const db = getDatabase();
    // Fetch limit + 1 to detect if there are more events beyond the limit
    const entries = await db.ui_updates
      .where('seq')
      .above(fromSeq)
      .limit(limit + 1)
      .toArray();
    const hasMore = entries.length > limit;
    if (hasMore) entries.pop(); // Remove the extra entry

    // Gap detection: if fromSeq > 0, check if events were lost before the tab could catch up.
    // Only check the start gap: if the lowest returned seq > fromSeq + 1, TTL cleanup deleted
    // the oldest events that this tab needed. Middle gaps are intentionally NOT checked because
    // IndexedDB auto-increment can skip seq numbers when a transaction fails (e.g., constraint
    // violation, quota exceeded), which does not indicate data loss — the event was never persisted.
    let hasGap = false;
    if (fromSeq > 0 && entries.length > 0) {
      // Check start gap: first entry should be fromSeq + 1
      const firstEntry = entries[0];
      if (firstEntry === undefined) {
        // Length check above guarantees at least one entry; guard for type safety
        log.warn('getCatchUpEvents: entries[0] undefined despite length > 0');
      } else if (firstEntry.seq > fromSeq + 1) {
        hasGap = true;
        log.warn(
          `getCatchUpEvents: gap at start! fromSeq=${fromSeq}, lowest returned seq=${firstEntry.seq}`,
        );
      }
    } else if (fromSeq > 0 && entries.length === 0) {
      // fromSeq > 0 but no events found — either all events were processed (normal)
      // or events were deleted by TTL cleanup (gap).
      // Check if DB has ANY events beyond fromSeq to distinguish:
      const latest = await db.ui_updates.orderBy('seq').last();
      if (!latest) {
        // DB is completely empty but fromSeq > 0 — all events were TTL-deleted → gap
        hasGap = true;
        log.warn(
          `getCatchUpEvents: gap detected! fromSeq=${fromSeq}, but DB is empty (all events TTL-deleted)`,
        );
      } else if (latest.seq !== fromSeq) {
        // DB has events beyond fromSeq, but none returned — gap
        hasGap = true;
        log.warn(
          `getCatchUpEvents: gap detected! fromSeq=${fromSeq}, but DB has events up to seq=${latest.seq}`,
        );
      }
    }

    log.debug(
      `getCatchUpEvents: returning ${entries.length} events from seq ${fromSeq} (hasGap=${hasGap}, hasMore=${hasMore})`,
    );
    return { entries, hasGap, hasMore };
  }

  /**
   * Health check: verify the Worker is running.
   *
   * Works without init(); used by the main thread to verify that the
   * SharedWorker started successfully and can respond to messages.
   */
  ping(): string {
    return 'pong';
  }

  // ========== Connection ==========

  async connect(): Promise<void> {
    log.debug('connect() called');
    const layer = this.ensureLayer();
    log.debug('calling layer.connect()');
    await layer.connect();
    log.debug(
      'layer.connect() returned, client state:',
      layer.getClient().getConnectionState(),
    );
    // Subscribe to RTCAgentClient connection state changes and broadcast to all Tabs
    this._subscribeConnectionState(layer);
    log.debug('connection state subscribed, returning from connect()');
  }

  disconnect(): void {
    const layer = this.ensureLayer();
    this._unsubscribeConnectionState();
    layer.disconnect();
  }

  async reconnect(): Promise<void> {
    const layer = this.ensureLayer();
    await layer.reconnect();
  }

  async getConnectionState(): Promise<ConnectionState> {
    const layer = this.ensureLayer();
    return layer.getClient().getConnectionState();
  }

  // ========== Queries ==========

  async listSessions(cursor?: string, limit?: number): Promise<LocalSession[]> {
    const layer = this.ensureLayer();
    return layer.listSessions(cursor, limit);
  }

  async getSession(clientId: string): Promise<LocalSession | undefined> {
    const layer = this.ensureLayer();
    return layer.getSession(clientId);
  }

  async listMessages(
    sessionClientId: string,
    cursor?: string,
    limit?: number,
    direction?: 'backward' | 'forward',
  ): Promise<LocalMessage[]> {
    const layer = this.ensureLayer();
    return layer.listMessages(sessionClientId, cursor, limit, direction);
  }

  async getMessage(clientId: string): Promise<LocalMessage | undefined> {
    const layer = this.ensureLayer();
    return layer.getMessage(clientId);
  }

  async listRtc(
    sessionClientId: string,
    cursor?: number,
    limit?: number,
  ): Promise<LocalRtc[]> {
    const layer = this.ensureLayer();
    return layer.listRtc(sessionClientId, cursor, limit);
  }

  async getNextRtcToProcess(
    sessionClientId?: string,
  ): Promise<LocalRtc | undefined> {
    const layer = this.ensureLayer();
    return layer.getNextRtcToProcess(sessionClientId);
  }

  // ========== Debug History ==========

  async addDebugHistoryItem(item: DebugHistoryItem): Promise<void> {
    const layer = this.ensureLayer();
    return layer.addDebugHistoryItem(item);
  }

  async queryDebugHistory(
    functionName?: string,
    cursor?: string,
    limit?: number,
  ): Promise<PagedResult<DebugHistoryItem>> {
    const layer = this.ensureLayer();
    return layer.queryDebugHistory(functionName, cursor, limit);
  }

  async countDebugHistory(functionName?: string): Promise<number> {
    const layer = this.ensureLayer();
    return layer.countDebugHistory(functionName);
  }

  async clearDebugHistory(): Promise<void> {
    const layer = this.ensureLayer();
    return layer.clearDebugHistory();
  }

  async batchDeleteDebugHistory(ids: string[]): Promise<void> {
    const layer = this.ensureLayer();
    return layer.batchDeleteDebugHistory(ids);
  }

  // ========== Operations ==========

  async sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const layer = this.ensureLayer();
    return layer.sendMessage(params);
  }

  async insertLocalMessage(params: {
    sessionClientId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    creatorKind?: string;
    creatorRefId?: string;
  }): Promise<LocalMessage> {
    const layer = this.ensureLayer();
    return layer.insertLocalMessage(params);
  }

  async stopTurn(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.stopTurn(sessionClientId);
  }

  async closeSession(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.closeSession(sessionClientId);
  }

  async openSession(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.openSession(sessionClientId);
  }

  async compactSession(
    sessionClientId: string,
    customInstruction?: string,
  ): Promise<void> {
    const layer = this.ensureLayer();
    return layer.compactSession(sessionClientId, customInstruction);
  }

  async submitRtcResult(params: {
    rtcClientId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): Promise<void> {
    const layer = this.ensureLayer();
    return layer.submitRtcResult(params);
  }

  async forkSession(params: {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    newMessageClientId: string;
    content: ContentData;
    limit?: number;
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const layer = this.ensureLayer();
    return layer.forkSession(params);
  }

  async deleteSession(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.deleteSession(sessionClientId);
  }

  async updateSessionTitle(
    sessionClientId: string,
    title: string,
  ): Promise<void> {
    const layer = this.ensureLayer();
    return layer.updateSessionTitle(sessionClientId, title);
  }

  // ========== Lifecycle ==========

  /**
   * Close this Tab's connection to the SharedWorker.
   *
   * Reference counting: only destroys shared resources if this is the last tab.
   * SharedWorker architecture: all tabs share the same core/layer/database.
   * If other tabs are still connected, skip teardown to avoid breaking their operations.
   *
   * Concurrent-safe: concurrent close() calls (e.g., multiple tabs closing simultaneously)
   * share the same teardown Promise. Only the first call performs teardown; subsequent
   * calls wait for it to complete and return.
   *
   * @param callerCallback - Optional callback to remove before checking reference count.
   *                         If provided, ensures the callback is removed even if unregisterCallback
   *                         failed earlier, preventing the SharedWorker from being kept alive
   *                         indefinitely by a stale callback reference.
   */
  async close(callerCallback?: WorkerCallbacks): Promise<void> {
    // If provided, remove the callback first (handles unregisterCallback failure cases)
    if (callerCallback) {
      this.callbacks.delete(callerCallback);
      this._callbackFailureCounts.delete(callerCallback);
    }

    // Reference counting: only destroy shared resources if this is the last tab
    // SharedWorker architecture: all tabs share the same core/layer/database
    // If other tabs are still connected, skip teardown to avoid breaking their operations
    if (this.callbacks.size > 0) {
      log.debug(
        `close() called but ${this.callbacks.size} tabs still connected, skipping teardown`,
      );
      return;
    }

    // Promise-based dedup: concurrent close() calls share the same teardown
    if (this._closePromise) {
      log.debug('close() already in progress, reusing existing promise');
      return this._closePromise;
    }

    this._closePromise = this._doClose();
    try {
      await this._closePromise;
    } finally {
      this._closePromise = null;
    }
  }

  /**
   * Internal teardown logic (extracted for Promise-based dedup).
   */
  private async _doClose(): Promise<void> {
    log.info('Last tab disconnected, tearing down shared WorkerCore resources');

    // Reset UIUpdateBus state to prevent publish() from accessing closed database
    // bus.clear() resets _initialized flag, so subsequent publish() calls skip persistence
    const bus = getUIUpdateBus();
    bus.clear();

    // P3-R6-02: Abort all ongoing file operations before closing
    for (const [id, ac] of this._operationControllers) {
      log.debug(`aborting file operation: ${id}`);
      ac.abort();
    }
    // Yield to the event loop so abort signal handlers can execute and operations'
    // Promise chains can progress to their finally blocks (where they self-remove
    // from _operationControllers). Note: network operations won't complete in one tick —
    // this only gives the abort propagation a chance to start. The .clear() below
    // is the definitive cleanup; any still-pending operations will fail with AbortError
    // when they next check their signal.
    if (this._operationControllers.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this._operationControllers.clear();

    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    if (this._disposeCoordinator) {
      this._disposeCoordinator();
      this._disposeCoordinator = null;
    }
    this._unsubscribeConnectionState();

    // Stop periodic cleanup timer
    if (this._cleanupTimer !== null) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    // TTL cleanup: remove UI update queue entries older than 30 minutes
    await this._cleanupUIUpdateQueue();

    if (this.layer) {
      await this.layer.close();
      this.layer = null;
    }
    this.callbacks.clear();
    this._callbackFailureCounts.clear();
  }

  /**
   * TTL cleanup for the UI update queue.
   * Removes entries older than 30 minutes to prevent unbounded growth.
   *
   * 30-minute window balances memory usage with offline resilience:
   * - Tabs offline for < 30 min catch up all missed events
   * - Tabs offline > 30 min get a full state refresh on next session load
   */
  private async _cleanupUIUpdateQueue(): Promise<void> {
    try {
      const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
      const db = getDatabase();
      const deleted = await db.ui_updates
        .where('timestamp')
        .below(cutoff)
        .delete();
      if (deleted > 0) {
        log.debug(
          `UI update queue cleanup: removed ${deleted} entries older than 30 minutes`,
        );
      }
    } catch (err) {
      log.debug('UI update queue cleanup failed (non-fatal):', err);
    }
  }

  /**
   * Schedule the next TTL cleanup using setTimeout (not setInterval).
   *
   * After cleanup runs, checks if any tabs are still connected:
   * - If yes: schedule the next cleanup in 60 seconds
   * - If no: stop the timer, allowing the SharedWorker to be garbage-collected
   *
   * This is critical for browser environments where setInterval would prevent
   * the SharedWorker from being terminated when no tabs are connected.
   *
   * EXCEPTION SAFETY: _cleanupUIUpdateQueue() is async and called without await
   * (to avoid blocking the event loop). We add .catch() to prevent unhandled
   * rejections from crashing the Worker.
   */
  private _scheduleCleanup(): void {
    this._cleanupTimer = setTimeout(() => {
      // Fire-and-forget async cleanup with error handling
      this._cleanupUIUpdateQueue().catch((err) => {
        log.debug('Scheduled UI update queue cleanup failed (non-fatal):', err);
      });

      // Only reschedule if there are still connected tabs
      if (this.callbacks.size > 0) {
        this._scheduleCleanup();
      } else {
        this._cleanupTimer = null;
      }
    }, 60_000);
  }

  async flushAll(confirm: boolean = false): Promise<void> {
    const layer = this.ensureLayer();
    return layer.flushAll(confirm);
  }

  async initializeVirtualFS(config: AgentMdConfig = {}): Promise<void> {
    // virtualFS internally accesses the same IndexedDB via getDatabase() (shared within Worker)
    await initializeVirtualFS(config);
  }

  async batchWriteFiles(
    files: Array<{
      path: string;
      content: string;
      metadata?: FileSystemMetadataOverride;
    }>,
    deletePaths?: string[],
  ): Promise<void> {
    log.debug(
      'batchWriteFiles called, files count:',
      files.length,
      'deletePaths count:',
      deletePaths?.length ?? 0,
    );
    const db = getDatabase();

    // P2-1: Performance monitoring for IndexedDB batch operations
    performance.mark('indexeddb-batch-start');

    // Fix 55: Wrap all writes operations in a single transaction to ensure atomicity.
    // If any write fails, the entire batch is rolled back, preventing partial updates.
    // Include ui_updates table to allow UIUpdateBus.publish() to persist events within this transaction.
    await db.transaction(
      'rw',
      db.fileSystemEntries,
      db.ui_updates,
      async () => {
        // P0-FIX: Use writeBatch for performance. Instead of calling virtualFS.write()
        // for each file (which acquires per-file locks and opens nested transactions),
        // writeBatch performs all writes in a single transaction without per-file locking.
        // This eliminates O(n) transaction overhead and file lock contention for n files.
        const batchOps: Array<{
          path: string;
          content: string;
          mode: 'overwrite' | 'append' | 'create-new';
          metadataOverride: FileSystemMetadataOverride;
        }> = [];

        for (const file of files) {
          // Check if this is a protected file path (/AGENT.md or /scenarios/*.md)
          const isProtectedPath = this._isProtectedPath(file.path);

          if (isProtectedPath) {
            // Check if the file exists and has been edited by the user
            const existing = await db.fileSystemEntries.get(file.path);
            if (existing?.metadata?.editedByUser) {
              log.debug(
                'batchWriteFiles: skipping protected file edited by user:',
                file.path,
              );
              continue;
            }
          }

          // For protected paths, use overwrite mode (since we've already checked editedByUser above)
          // For other paths, always use overwrite mode
          const mode: 'overwrite' | 'append' | 'create-new' = 'overwrite';

          // Ensure editedByUser is set to false for system-generated files
          const metadata: FileSystemMetadataOverride = {
            ...file.metadata,
            editedByUser: false,
          };

          batchOps.push({
            path: file.path,
            content: file.content,
            mode,
            metadataOverride: metadata,
          });
        }

        // Single batch write replaces N individual write() calls
        await virtualFS.writeBatch(batchOps);

        // Delete stale/orphan paths (doc reconciliation)
        if (deletePaths && deletePaths.length > 0) {
          for (const path of deletePaths) {
            try {
              await virtualFS.remove(path);
              log.debug('batchWriteFiles: deleted orphan path:', path);
            } catch (err) {
              log.warn(
                'batchWriteFiles: failed to delete orphan path:',
                path,
                err,
              );
            }
          }
        }
      },
    );

    log.debug('batchWriteFiles completed');
    // Single broadcast for batch write to avoid per-file notifications
    // Fix 55: Broadcast only after transaction succeeds
    // Include affected file paths in newValue so subscribers know which files changed
    // (without requiring individual events per file).
    const affectedPaths = files.map((f) => f.path);
    if (deletePaths && deletePaths.length > 0) {
      affectedPaths.push(...deletePaths);
    }
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'updated',
      entityId: '',
      field: 'batch',
      oldValue: undefined,
      newValue: { paths: affectedPaths },
    });

    // P2-1: Performance monitoring - measure IndexedDB batch operation duration
    performance.mark('indexeddb-batch-end');
    const batchMeasure = performance.measure(
      'indexeddb-batch',
      'indexeddb-batch-start',
      'indexeddb-batch-end',
    );
    log.debug(
      `batchWriteFiles performance: ${batchMeasure.duration.toFixed(2)}ms for ${files.length} files`,
    );
    // Clean up performance marks to prevent memory accumulation
    performance.clearMarks('indexeddb-batch-start');
    performance.clearMarks('indexeddb-batch-end');
    performance.clearMeasures('indexeddb-batch');
  }

  /**
   * Check if a file path is protected from system overwrites.
   *
   * Protected files: /AGENT.md, /scenarios/*.md (excluding /scenarios/INDEX.md)
   * These files can be edited by users, and system updates should not overwrite user edits.
   */
  private _isProtectedPath(path: string): boolean {
    // /AGENT.md
    if (path === '/AGENT.md') {
      return true;
    }
    // /scenarios/*.md (excluding /scenarios/INDEX.md)
    if (path.startsWith('/scenarios/') && path !== '/scenarios/INDEX.md') {
      return true;
    }
    return false;
  }

  async resetOffset(): Promise<void> {
    await getOffsetManager().reset();
  }

  // ========== virtualFS proxy (main thread -> Worker) ==========

  async virtualFSRead(
    path: string,
    offset?: number,
    limit?: number,
  ): Promise<string> {
    return virtualFS.read(path, offset, limit);
  }

  async virtualFSWrite(
    path: string,
    content: string,
    mode: 'overwrite' | 'append' = 'overwrite',
    metadataOverride?: FileSystemMetadataOverride,
  ): Promise<number> {
    const result = await virtualFS.write(path, content, mode, metadataOverride);
    // Broadcast file change event to all Tabs
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'updated',
      entityId: path,
      field: 'write',
      oldValue: undefined,
      newValue: undefined,
    });
    return result;
  }

  async virtualFSLs(path?: string): Promise<string[]> {
    return virtualFS.ls(path);
  }

  async virtualFSFind(pattern: string, path?: string): Promise<string[]> {
    return virtualFS.find(pattern, path);
  }

  async virtualFSGrep(
    pattern: string,
    path?: string,
    caseSensitive?: boolean,
    maxResults?: number,
  ): Promise<GrepResult> {
    return virtualFS.grep(pattern, path, caseSensitive, maxResults);
  }

  async virtualFSQueryByType(type: string): Promise<
    Array<{
      path: string;
      type: string;
      content: string;
      metadata: {
        name: string;
        description: string;
        tags?: string[];
        group?: string;
        createdAt: Date;
        updatedAt: Date;
      };
    }>
  > {
    // Validate the incoming string against the known FileSystemEntryType union
    // to avoid passing an arbitrary string into virtualFS.queryByType.
    const validTypes: ReadonlyArray<FileSystemEntryType> = [
      'function',
      'scenario',
      'script',
      'index',
    ];
    if (!validTypes.includes(type as FileSystemEntryType)) {
      log.warn(
        `virtualFSQueryByType: unknown type "${type}", falling back to empty result`,
      );
      return [];
    }
    return virtualFS.queryByType(type as FileSystemEntryType);
  }

  async virtualFSExists(path: string): Promise<boolean> {
    return virtualFS.exists(path);
  }

  async virtualFSRemove(path: string): Promise<void> {
    await virtualFS.remove(path);
    // Broadcast file delete event to all Tabs
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'deleted',
      entityId: path,
      field: 'delete',
      oldValue: undefined,
      newValue: undefined,
    });
  }

  // ========== Internal ==========

  /**
   * Broadcast a UIUpdateEvent to all registered Tab callbacks.
   *
   * PERFORMANCE OPTIMIZATION: Uses Promise.allSettled() to process callbacks in parallel
   * instead of sequentially. This prevents slow callbacks from blocking other callbacks,
   * reducing overall broadcast latency when multiple tabs are connected.
   *
   * Async-safe: both sync and async errors are tracked via failure counting.
   * After MAX_CONSECUTIVE_FAILURES consecutive failures (sync or async), the
   * callback is removed to prevent unbounded accumulation of dead tab callbacks.
   *
   * CRITICAL: This method tracks async failures explicitly. Comlink-proxied callbacks
   * ALWAYS return Promises, so sync errors are essentially impossible. Without async
   * failure tracking, dead tab callbacks would never be cleaned up.
   *
   * Failure count lifecycle:
   * - Sync throw: increment immediately
   * - Async rejection: increment in .catch()
   * - Sync success + async resolve: reset to 0
   * - Sync success + async reject: increment (the async result is the true indicator)
   *
   * ZOMBIE STATE DETECTION:
   * Uses Promise.allSettled() return values to count failures. Each callback's Promise
   * is wrapped to reject on failure (instead of always resolving), allowing allSettled
   * to accurately track rejected promises. When all promises reject, the system enters
   * zombie state and clears all callbacks for recovery.
   */
  private broadcastUIUpdate(event: UIUpdateEvent, seq = 0): void {
    // P2-1: Performance monitoring for WebSocket message processing delay
    performance.mark('broadcast-start');

    const payload = { event, seq };
    const callbacks = Array.from(this.callbacks);

    // PERFORMANCE: Process all callbacks in parallel using Promise.allSettled
    // This prevents slow callbacks from blocking others, reducing broadcast latency
    const promises = callbacks.map((cb) => {
      return new Promise<void>((resolve, reject) => {
        try {
          const result = cb.onUIUpdate(payload);
          // Check for Promise-like return value (Comlink proxies always return Promises)
          if (isPromiseLike<void>(result)) {
            // Async path: resolve/reject based on Promise outcome
            result.then(
              () => {
                // Async success: reset failure count
                this._callbackFailureCounts.delete(cb);
                resolve();
              },
              (err) => {
                // Async failure: track via failure counting mechanism
                this._recordAsyncFailure(cb, err);
                reject(err); // Reject to allow allSettled to count failures
              },
            );
          } else {
            // Sync success (non-Promise return): reset failure count immediately
            this._callbackFailureCounts.delete(cb);
            resolve();
          }
        } catch (err) {
          // Sync failure: track via standard mechanism
          this._recordSyncFailure(cb, err);
          reject(err); // Reject to allow allSettled to count failures
        }
      });
    });

    // Fire-and-forget: detect zombie state when all callbacks fail
    Promise.allSettled(promises).then((results) => {
      // P3-1 FIX: Wrap performance measurement in try-finally to ensure cleanup
      // always executes, preventing memory leaks from accumulated performance marks
      try {
        // P2-1: Performance monitoring - measure broadcast duration
        performance.mark('broadcast-end');
        const broadcastMeasure = performance.measure(
          'broadcast-ui-update',
          'broadcast-start',
          'broadcast-end',
        );

        // ZOMBIE STATE DETECTION:
        // Count rejected promises from allSettled results. When ALL callbacks fail,
        // the system is in a zombie state: events are broadcast but no tabs receive them.
        // This typically indicates all connected tabs crashed or disconnected abnormally.
        const failedCount = results.filter(
          (r) => r.status === 'rejected',
        ).length;

        // Recovery strategy: Clear all callbacks and failure counts to allow fresh
        // registration. The next tab that connects will re-register callbacks,
        // restoring normal operation. This is the safest recovery path because
        // attempting to resurrect stale callbacks could cause data corruption.
        if (callbacks.length > 0 && failedCount === callbacks.length) {
          // CRITICAL: Use log.error (not log.warn) to surface this as a critical issue.
          // log.warn would be filtered out in production logs, making this invisible.
          log.error(
            `CRITICAL: broadcastUIUpdate: all ${callbacks.length} callbacks rejected, ` +
              `system entering zombie state. Triggering full cleanup and recovery. ` +
              `This indicates all connected tabs crashed or disconnected abnormally. ` +
              `Recovery: callbacks cleared, next registerCallback() will restore normal operation. ` +
              `Pending operations: ${this._operationControllers.size} file operations will continue ` +
              `(not aborted — they may still succeed independently). ` +
              `Diagnostic: Check browser console for tab crashes, OOM kills, or network disconnections.`,
          );
          // Clear all callbacks and failure counts to prevent cascading failures.
          // Note: We intentionally do NOT abort pending file operations here.
          // Unlike the previous (broken) implementation, file operations are independent
          // of the callback broadcast path — they have their own AbortControllers and
          // will complete or fail based on network conditions, not tab liveness.
          // Aborting them would waste partially-completed uploads/downloads.
          this.callbacks.clear();
          this._callbackFailureCounts.clear();
        }

        // Log slow broadcasts (>16ms frame budget) for performance debugging
        if (broadcastMeasure.duration > 16) {
          log.debug(
            `broadcastUIUpdate slow: ${broadcastMeasure.duration.toFixed(2)}ms for ${callbacks.length} callbacks`,
          );
        }
      } finally {
        // P3-1 FIX: Ensure performance cleanup always executes, even if above code throws
        // Clean up performance marks to prevent memory accumulation
        performance.clearMarks('broadcast-start');
        performance.clearMarks('broadcast-end');
        performance.clearMeasures('broadcast-ui-update');
      }
    });
  }

  /**
   * Record a sync failure for a callback and remove it if threshold is exceeded.
   */
  private _recordSyncFailure(cb: WorkerCallbacks, err: unknown): void {
    const count = (this._callbackFailureCounts.get(cb) ?? 0) + 1;
    this._callbackFailureCounts.set(cb, count);
    log.error(
      `callback sync broadcast failed (${count}/${WorkerCore.MAX_CONSECUTIVE_FAILURES}):`,
      err,
    );
    if (count >= WorkerCore.MAX_CONSECUTIVE_FAILURES) {
      this._removeDeadCallback(cb, count, 'sync');
    }
  }

  /**
   * Record an async failure for a callback and remove it if threshold is exceeded.
   */
  private _recordAsyncFailure(cb: WorkerCallbacks, err: unknown): void {
    const count = (this._callbackFailureCounts.get(cb) ?? 0) + 1;
    this._callbackFailureCounts.set(cb, count);
    log.error(
      `callback async broadcast failed (${count}/${WorkerCore.MAX_CONSECUTIVE_FAILURES}):`,
      err,
    );
    if (count >= WorkerCore.MAX_CONSECUTIVE_FAILURES) {
      this._removeDeadCallback(cb, count, 'async');
    }
  }

  /**
   * Remove a callback after exceeding the consecutive failure threshold.
   */
  private _removeDeadCallback(
    cb: WorkerCallbacks,
    count: number,
    mode: 'sync' | 'async',
  ): void {
    log.warn(
      `removing dead callback after ${count} consecutive ${mode} failures (tab likely crashed)`,
    );
    this.callbacks.delete(cb);
    this._callbackFailureCounts.delete(cb);
  }

  /**
   * Check if all callbacks in a broadcast round failed (zombie state).
   *
   * Called after each broadcast method (broadcastUIUpdate, broadcastGapFillState, etc.)
   * to detect the scenario where all connected tabs have crashed or disconnected abnormally.
   *
   * Why this is needed:
   * - Individual failure tracking (_recordAsyncFailure/_recordSyncFailure) handles per-callback
   *   cleanup after MAX_CONSECUTIVE_FAILURES, but this requires multiple broadcast rounds.
   * - Zombie state detection provides immediate recovery when ALL callbacks fail in a single round.
   * - Without this, the Worker would continue broadcasting to dead callbacks indefinitely,
   *   wasting CPU and preventing recovery until the next tab connects.
   *
   * IMPORTANT: This method only checks synchronous failure counts. For async callbacks
   * (which Comlink proxies always are), the failCount reflects the number of callbacks
   * that threw synchronously OR whose async failure was detected before this check.
   * Since broadcast methods iterate callbacks and handle async failures inline,
   * the failCount is accurate for sync failures but may undercount async failures
   * that haven't resolved yet. This is acceptable because:
   * 1. If all tabs crashed, sync failures (port closed) will be immediate
   * 2. The individual _recordAsyncFailure mechanism handles slow async failures
   */
  private _checkZombieState(
    totalCallbacks: number,
    failCount: number,
    context: string,
  ): void {
    if (totalCallbacks > 0 && failCount === totalCallbacks) {
      log.error(
        `CRITICAL: ${context}: all ${totalCallbacks} callbacks failed, ` +
          `system entering zombie state. Clearing callbacks for recovery. ` +
          `Next registerCallback() will restore normal operation.`,
      );
      this.callbacks.clear();
      this._callbackFailureCounts.clear();
    }
  }

  /**
   * Broadcast a file sync status change to all registered Tab callbacks.
   *
   * P0-2 fix: emits a UIUpdateEvent so the UI can react to sync status changes
   * (e.g., show spinner for 'syncing', checkmark for 'synced', error icon for 'failed').
   *
   * Uses broadcastUIUpdate internally, which handles async failure tracking correctly.
   */
  private _broadcastFileSyncStatus(
    md5: string,
    ext: string,
    syncStatus: string,
    errorMessage?: string,
  ): void {
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'updated',
      entityId: `${md5}.${ext}`,
      field: 'syncStatus',
      oldValue: undefined,
      newValue: { syncStatus, md5, ext, errorMessage },
    });
  }

  /**
   * Broadcast gap fill state change to all registered Tab callbacks.
   *
   * PERFORMANCE OPTIMIZATION: Uses Promise.allSettled() to process callbacks in parallel
   * instead of sequentially. This prevents slow callbacks from blocking other callbacks.
   *
   * CRITICAL: Comlink proxies all callbacks to return Promises, even void-returning ones.
   * We explicitly handle Promise rejections to track failures and clean up dead callbacks.
   *
   * ZOMBIE STATE DETECTION:
   * Uses Promise.allSettled() return values to count failures. When all promises reject,
   * the system enters zombie state and clears all callbacks for recovery.
   */
  private broadcastGapFillState(isSyncing: boolean): void {
    log.debug(
      '[BulkUpdate] WorkerCore.broadcastGapFillState called, isSyncing:',
      isSyncing,
      'callbacks:',
      this.callbacks.size,
    );
    const callbacks = Array.from(this.callbacks);

    const promises = callbacks.map((cb) => {
      return new Promise<void>((resolve, reject) => {
        try {
          const result = cb.onGapFillState(isSyncing);
          if (isPromiseLike<void>(result)) {
            result.then(
              () => {
                this._callbackFailureCounts.delete(cb);
                resolve();
              },
              (err) => {
                this._recordAsyncFailure(cb, err);
                reject(err); // Reject to allow allSettled to count failures
              },
            );
          } else {
            this._callbackFailureCounts.delete(cb);
            resolve();
          }
        } catch (err) {
          this._recordSyncFailure(cb, err);
          reject(err); // Reject to allow allSettled to count failures
        }
      });
    });

    // Fire-and-forget: detect zombie state when all callbacks fail
    Promise.allSettled(promises).then((results) => {
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      this._checkZombieState(
        callbacks.length,
        failedCount,
        'broadcastGapFillState',
      );
    });
  }

  /**
   * Broadcast account banned notification to all registered Tab callbacks.
   *
   * PERFORMANCE OPTIMIZATION: Uses Promise.allSettled() to process callbacks in parallel
   * instead of sequentially. This prevents slow callbacks from blocking other callbacks.
   *
   * CRITICAL: Comlink proxies all callbacks to return Promises, even void-returning ones.
   * We explicitly handle Promise rejections to track failures and clean up dead callbacks.
   *
   * ZOMBIE STATE DETECTION:
   * Uses Promise.allSettled() return values to count failures. When all promises reject,
   * the system enters zombie state and clears all callbacks for recovery.
   */
  private broadcastAccountBanned(reason: string): void {
    log.warn(
      'broadcastAccountBanned called, reason:',
      reason,
      'callbacks:',
      this.callbacks.size,
    );
    const callbacks = Array.from(this.callbacks);

    const promises = callbacks.map((cb) => {
      return new Promise<void>((resolve, reject) => {
        try {
          const result = cb.onAccountBanned(reason);
          if (isPromiseLike<void>(result)) {
            result.then(
              () => {
                this._callbackFailureCounts.delete(cb);
                resolve();
              },
              (err) => {
                this._recordAsyncFailure(cb, err);
                reject(err); // Reject to allow allSettled to count failures
              },
            );
          } else {
            this._callbackFailureCounts.delete(cb);
            resolve();
          }
        } catch (err) {
          this._recordSyncFailure(cb, err);
          reject(err); // Reject to allow allSettled to count failures
        }
      });
    });

    // Fire-and-forget: detect zombie state when all callbacks fail
    Promise.allSettled(promises).then((results) => {
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      this._checkZombieState(
        callbacks.length,
        failedCount,
        'broadcastAccountBanned',
      );
    });
  }

  /**
   * Request a token (used as RTCAgentClient callback).
   *
   * Parallel: tries all registered requestToken callbacks concurrently via Promise.any,
   * returning the first successful result. This avoids serial latency when multiple tabs
   * are registered and one is slow to respond.
   *
   * ZOMBIE STATE DETECTION:
   * When all callbacks fail (Promise.any rejects with AggregateError), each failed callback
   * is tracked via _recordAsyncFailure(). This ensures dead callbacks are cleaned up
   * incrementally (after MAX_CONSECUTIVE_FAILURES) or immediately if all fail in one round.
   *
   * Error: if no tabs are registered, the Worker cannot obtain a token. This typically
   * indicates a lifecycle issue (e.g., connect() called before any tab registered callbacks).
   */
  private async requestToken(): Promise<string> {
    if (this.callbacks.size === 0) {
      throw new Error(
        '[WorkerCore] cannot request token: no tabs registered. ' +
          'Ensure WorkerBridge.init() has completed before connect() is called.',
      );
    }
    const callbacks = Array.from(this.callbacks);
    let allFailedCount = 0;

    // Wrap each callback to track failures for zombie state detection
    const promises = callbacks.map((cb) => {
      return new Promise<string>((resolve, reject) => {
        try {
          const result = cb.requestToken();
          if (isPromiseLike<string>(result)) {
            result.then(
              (token) => {
                this._callbackFailureCounts.delete(cb);
                resolve(token);
              },
              (err) => {
                this._recordAsyncFailure(cb, err);
                allFailedCount++;
                reject(err);
              },
            );
          } else {
            // Sync success
            this._callbackFailureCounts.delete(cb);
            resolve(result);
          }
        } catch (err) {
          this._recordSyncFailure(cb, err);
          allFailedCount++;
          reject(err);
        }
      });
    });

    try {
      const token = await Promise.any(promises);
      log.debug('token obtained successfully');
      return token;
    } catch (err) {
      // Promise.any rejects with AggregateError when all promises reject
      log.error('all requestToken callbacks failed:', err);

      // ZOMBIE STATE DETECTION: If all callbacks failed, check for zombie state
      this._checkZombieState(callbacks.length, allFailedCount, 'requestToken');

      throw new Error(
        `[WorkerCore] all ${this.callbacks.size} token request(s) failed. ` +
          'Check AuthController state and network connectivity.',
      );
    }
  }

  /**
   * Request a token refresh (used as RTCAgentClient's onTokenExpired callback).
   *
   * Parallel: tries all registered requestTokenRefresh callbacks concurrently via Promise.any,
   * returning the first successful result. When all callbacks fail, returns 'relogin'
   * (requires user to log in again).
   *
   * ZOMBIE STATE DETECTION:
   * When all callbacks fail, each failed callback is tracked via _recordAsyncFailure().
   * This ensures dead callbacks are cleaned up incrementally or immediately if all fail.
   */
  private async requestTokenRefresh(): Promise<TokenExpiredAction> {
    if (this.callbacks.size === 0) {
      log.error('requestTokenRefresh: no tabs registered, forcing relogin');
      return 'relogin';
    }
    const callbacks = Array.from(this.callbacks);
    let allFailedCount = 0;

    // Wrap each callback to track failures for zombie state detection
    const promises = callbacks.map((cb) => {
      return new Promise<TokenExpiredAction>((resolve, reject) => {
        try {
          const result = cb.requestTokenRefresh();
          if (isPromiseLike<TokenExpiredAction>(result)) {
            result.then(
              (action) => {
                this._callbackFailureCounts.delete(cb);
                resolve(action);
              },
              (err) => {
                this._recordAsyncFailure(cb, err);
                allFailedCount++;
                reject(err);
              },
            );
          } else {
            // Sync success
            this._callbackFailureCounts.delete(cb);
            resolve(result);
          }
        } catch (err) {
          this._recordSyncFailure(cb, err);
          allFailedCount++;
          reject(err);
        }
      });
    });

    try {
      return await Promise.any(promises);
    } catch (err) {
      // Promise.any rejects with AggregateError when all promises reject
      log.error('all requestTokenRefresh callbacks failed:', err);

      // ZOMBIE STATE DETECTION: If all callbacks failed, check for zombie state
      this._checkZombieState(
        callbacks.length,
        allFailedCount,
        'requestTokenRefresh',
      );

      return 'relogin';
    }
  }

  private ensureLayer(): PersistenceLayer {
    if (!this.layer) {
      throw new Error('[WorkerCore] not initialized, call init() first');
    }
    return this.layer;
  }

  /**
   * Subscribe to RTCAgentClient connection state changes.
   *
   * Called after connect(); broadcasts connection state changes to all registered Tab callbacks.
   * Solves the problem that the main thread cannot directly access getClient().
   */
  private _subscribeConnectionState(layer: PersistenceLayer): void {
    this._unsubscribeConnectionState();
    const client = layer.getClient();
    log.debug('subscribing to connection state changes');
    this.unsubscribeConnection = client.on(
      'connection',
      (event: ConnectionStateEvent) => {
        log.debug(
          'connection state changed:',
          event.state,
          'reason:',
          event.reason,
        );
        this.broadcastConnectionState(event);
      },
    );
  }

  /**
   * Unsubscribe from connection state changes.
   */
  private _unsubscribeConnectionState(): void {
    if (this.unsubscribeConnection) {
      this.unsubscribeConnection();
      this.unsubscribeConnection = null;
    }
  }

  /**
   * Broadcast a connection state change to all registered Tab callbacks.
   *
   * PERFORMANCE OPTIMIZATION: Uses Promise.allSettled() to process callbacks in parallel
   * instead of sequentially. This prevents slow callbacks from blocking other callbacks.
   *
   * CRITICAL: Comlink proxies all callbacks to return Promises, even void-returning ones.
   * We explicitly handle Promise rejections to track failures and clean up dead callbacks.
   *
   * ZOMBIE STATE DETECTION:
   * Uses Promise.allSettled() return values to count failures. When all promises reject,
   * the system enters zombie state and clears all callbacks for recovery.
   */
  private broadcastConnectionState(event: ConnectionStateEvent): void {
    log.debug(
      'broadcastConnectionState called, state:',
      event.state,
      'reason:',
      event.reason,
      'callbacks:',
      this.callbacks.size,
    );
    const callbacks = Array.from(this.callbacks);

    const promises = callbacks.map((cb) => {
      return new Promise<void>((resolve, reject) => {
        try {
          const result = cb.onConnectionStateChange(event);
          if (isPromiseLike<void>(result)) {
            result.then(
              () => {
                this._callbackFailureCounts.delete(cb);
                resolve();
              },
              (err) => {
                this._recordAsyncFailure(cb, err);
                reject(err); // Reject to allow allSettled to count failures
              },
            );
          } else {
            this._callbackFailureCounts.delete(cb);
            resolve();
          }
        } catch (err) {
          this._recordSyncFailure(cb, err);
          reject(err); // Reject to allow allSettled to count failures
        }
      });
    });

    // Fire-and-forget: detect zombie state when all callbacks fail
    Promise.allSettled(promises).then((results) => {
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      this._checkZombieState(
        callbacks.length,
        failedCount,
        'broadcastConnectionState',
      );
    });
  }

  // ========== File Cache & S3 Operations ==========

  async cacheFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    ttlMs?: number,
  ): Promise<void> {
    const layer = this.ensureLayer();
    return layer.cacheFile(md5, ext, blob, contentType, ttlMs);
  }

  async cacheFilePending(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    filename?: string,
  ): Promise<void> {
    const layer = this.ensureLayer();
    return layer.cacheFilePending(md5, ext, blob, contentType, filename);
  }

  async getCachedFile(
    md5: string,
    ext: string,
  ): Promise<CachedFileInfo | null> {
    const layer = this.ensureLayer();
    return layer.getCachedFile(md5, ext);
  }

  async evictExpiredCache(): Promise<number> {
    const layer = this.ensureLayer();
    return layer.evictExpiredCache();
  }

  async evictCache(
    targetBytes?: number,
  ): Promise<{ evictedCount: number; evictedBytes: number }> {
    const layer = this.ensureLayer();
    return layer.evictCache(targetBytes);
  }

  async uploadFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType?: string,
    filename?: string,
    operationId?: string,
    onProgress?: (loaded: number, total: number) => void,
    cacheTtlMs?: number,
  ): Promise<{
    syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
    syncedAt?: number;
    errorMessage?: string;
  }> {
    const layer = this.ensureLayer();
    // Create AbortController for this operation (allows cancellation via cancelFileOperation)
    const ac = new AbortController();
    if (operationId) {
      this._operationControllers.set(operationId, ac);
    }
    try {
      const result = await layer.uploadFile(
        md5,
        ext,
        blob,
        contentType,
        filename,
        ac.signal,
        onProgress,
        cacheTtlMs,
      );
      // P0-2: broadcast sync status change to all tabs
      this._broadcastFileSyncStatus(
        md5,
        ext,
        result.syncStatus,
        result.errorMessage,
      );
      return result;
    } finally {
      if (operationId) {
        this._operationControllers.delete(operationId);
      }
    }
  }

  async downloadFile(
    md5: string,
    ext: string,
    onProgress?: (loaded: number, total: number) => void,
    operationId?: string,
    forceRefresh?: boolean, // P2-NEW-4 fix: added forceRefresh parameter
  ): Promise<Blob> {
    const layer = this.ensureLayer();
    // Create AbortController for this operation (allows cancellation via cancelFileOperation)
    const ac = new AbortController();
    if (operationId) {
      this._operationControllers.set(operationId, ac);
    }
    try {
      // P2-NEW-4 fix: pass forceRefresh to PersistenceLayer
      const blob = await layer.downloadFile(
        md5,
        ext,
        onProgress,
        ac.signal,
        forceRefresh,
      );
      // P0-2: broadcast sync status 'synced' after successful download+cache
      this._broadcastFileSyncStatus(md5, ext, 'synced');
      return blob;
    } finally {
      if (operationId) {
        this._operationControllers.delete(operationId);
      }
    }
  }

  /**
   * Cancel an ongoing file operation by its operationId.
   *
   * No-op if operationId is not found (operation already completed or invalid).
   *
   * Note: The delete() call here is idempotent with the delete() in the finally blocks
   * of uploadFile()/downloadFile(). Both paths may execute concurrently in race scenarios,
   * but Map.delete() is safe to call multiple times with the same key.
   */
  cancelFileOperation(operationId: string): void {
    const ac = this._operationControllers.get(operationId);
    if (ac) {
      log.debug(`cancelling file operation: ${operationId}`);
      ac.abort();
      this._operationControllers.delete(operationId);
    }
  }

  async deleteFile(md5: string, ext: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.deleteFile(md5, ext);
  }

  async calculateFileMD5(blob: Blob): Promise<string> {
    const layer = this.ensureLayer();
    return layer.calculateFileMD5(blob);
  }

  async headFile(md5: string, ext: string): Promise<HeadObjectResult> {
    const layer = this.ensureLayer();
    return layer.headFile(md5, ext);
  }

  async getPresignedUrl(
    operation: 'get' | 'put',
    key: string,
    expiresIn?: number,
  ): Promise<string> {
    const layer = this.ensureLayer();
    return layer.getPresignedUrl(operation, key, expiresIn);
  }

  async listFiles(
    syncStatus?: FileSyncStatus,
    limit: number = 100,
    offset: number = 0,
  ): Promise<FileCacheEntry[]> {
    const layer = this.ensureLayer();
    return layer.listFiles(syncStatus, limit, offset);
  }

  async countFiles(syncStatus?: FileSyncStatus): Promise<number> {
    const layer = this.ensureLayer();
    return layer.countFiles(syncStatus);
  }

  async syncPendingFiles(): Promise<{
    synced: number;
    failed: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }> {
    const layer = this.ensureLayer();
    const result = await layer.syncPendingFiles();

    // Gap 1 fix: broadcast per-file sync status changes so UI can show real-time progress
    for (const file of result.syncedFiles) {
      this._broadcastFileSyncStatus(file.md5, file.ext, 'synced');
    }
    for (const file of result.failedFiles) {
      this._broadcastFileSyncStatus(
        file.md5,
        file.ext,
        'failed',
        file.errorMessage,
      );
    }

    return result;
  }

  async resumeInterruptedUploads(): Promise<{
    resumed: number;
    failed: number;
    expired: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }> {
    const layer = this.ensureLayer();
    const result = await layer.resumeInterruptedUploads();

    // P2-NEW-6 fix: broadcast per-file sync status changes so UI can show real-time progress
    for (const file of result.syncedFiles) {
      this._broadcastFileSyncStatus(file.md5, file.ext, 'synced');
    }
    for (const file of result.failedFiles) {
      this._broadcastFileSyncStatus(
        file.md5,
        file.ext,
        'failed',
        file.errorMessage,
      );
    }

    return result;
  }

  async getCacheStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    byStatus: {
      pending: { count: number; size: number };
      syncing: { count: number; size: number };
      synced: { count: number; size: number };
      failed: { count: number; size: number };
    };
  }> {
    const layer = this.ensureLayer();
    return layer.getCacheStats();
  }

  async updateFileMetadata(
    md5: string,
    ext: string,
    updates: { filename?: string; contentType?: string },
  ): Promise<void> {
    const layer = this.ensureLayer();
    return layer.updateFileMetadata(md5, ext, updates);
  }
}
