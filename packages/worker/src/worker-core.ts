import {
  createPersistenceLayer,
  getUIUpdateBus,
  getOffsetManager,
  initializeVirtualFS,
  virtualFS,
  getDatabase,
  type PersistenceConfig,
  type AgentMdConfig,
  type UIUpdateEvent,
  type UIUpdateQueueEntry,
  type LocalSession,
  type LocalMessage,
  type LocalRtc,
  type DebugHistoryItem,
  type PagedResult,
  type FileSystemEntryType,
  type FileSystemMetadataOverride,
  type CachedFileInfo,
  type FileCacheEntry,
  type FileSyncStatus,
} from '@rtc-agent/persistence';
import type { HeadObjectResult } from '@rtc-agent/client';
import type { ContentData } from '@rtc-agent/protocol';
import type { ConnectionState, ConnectionStateEvent, TokenExpiredAction } from '@rtc-agent/client';
import { createLogger } from '@rtc-agent/client';
import type { WorkerCallbacks, WorkerPersistenceCore } from './core-interface.js';

const log = createLogger('WorkerCore');

type PersistenceLayer = ReturnType<typeof createPersistenceLayer>;

/**
 * WorkerPersistenceCore implementation.
 *
 * - Wraps PersistenceLayer, passing through all query/operation methods
 * - Subscribes to UIUpdateBus, broadcasting events to all registered Tab callbacks
 * - Token requests: forwarded to any registered requestToken callback
 */
export class WorkerCore implements WorkerPersistenceCore {
  private layer: PersistenceLayer | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private _disposeCoordinator: (() => void) | null = null;

  /** Timer for periodic UI update queue cleanup (prevents unbounded growth). */
  private _cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  /** Callback sets for all connected Tabs */
  private callbacks = new Set<WorkerCallbacks>();

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
   */
  async init(config: PersistenceConfig): Promise<void> {
    if (this.layer) {
      log.warn('already initialized, ignoring init()');
      return;
    }

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
      },
    };

    this.layer = createPersistenceLayer(bridgedConfig);

    // P2-NEW-3 fix + P2-D update: inject status change listener into FileOpCoordinator
    // Returns a dispose function for teardown.
    const fileOpCoordinator = this.layer.getFileOpCoordinator();
    this._disposeCoordinator = fileOpCoordinator.onStatusChange((md5, ext, status, errorMessage) => {
      this._broadcastFileSyncStatus(md5, ext, status, errorMessage);
    });

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
  async getCatchUpEvents(fromSeq: number, limit = 1000): Promise<{
    entries: UIUpdateQueueEntry[];
    hasGap: boolean;
    hasMore: boolean;
  }> {
    const db = getDatabase();
    // Fetch limit + 1 to detect if there are more events beyond the limit
    const entries = await db.ui_updates.where('seq').above(fromSeq).limit(limit + 1).toArray();
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
      const minSeq = entries[0].seq;
      if (minSeq > fromSeq + 1) {
        hasGap = true;
        log.warn(`getCatchUpEvents: gap at start! fromSeq=${fromSeq}, lowest returned seq=${minSeq}`);
      }
    } else if (fromSeq > 0 && entries.length === 0) {
      // fromSeq > 0 but no events found — either all events were processed (normal)
      // or events were deleted by TTL cleanup (gap).
      // Check if DB has ANY events beyond fromSeq to distinguish:
      const latest = await db.ui_updates.orderBy('seq').last();
      if (!latest) {
        // DB is completely empty but fromSeq > 0 — all events were TTL-deleted → gap
        hasGap = true;
        log.warn(`getCatchUpEvents: gap detected! fromSeq=${fromSeq}, but DB is empty (all events TTL-deleted)`);
      } else if (latest.seq !== fromSeq) {
        // DB has events beyond fromSeq, but none returned — gap
        hasGap = true;
        log.warn(`getCatchUpEvents: gap detected! fromSeq=${fromSeq}, but DB has events up to seq=${latest.seq}`);
      }
    }

    log.debug(`getCatchUpEvents: returning ${entries.length} events from seq ${fromSeq} (hasGap=${hasGap}, hasMore=${hasMore})`);
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
    log.debug('layer.connect() returned, client state:', layer.getClient().getConnectionState());
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

  async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
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
    limit?: number
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

  async compactSession(sessionClientId: string, customInstruction?: string): Promise<void> {
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

  async updateSessionTitle(sessionClientId: string, title: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.updateSessionTitle(sessionClientId, title);
  }

  // ========== Lifecycle ==========

  async close(): Promise<void> {
    // P3-R6-02: Abort all ongoing file operations before closing
    for (const [id, ac] of this._operationControllers) {
      log.debug(`aborting file operation: ${id}`);
      ac.abort();
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
      const deleted = await db.ui_updates.where('timestamp').below(cutoff).delete();
      if (deleted > 0) {
        log.debug(`UI update queue cleanup: removed ${deleted} entries older than 30 minutes`);
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
   */
  private _scheduleCleanup(): void {
    this._cleanupTimer = setTimeout(() => {
      this._cleanupUIUpdateQueue();

      // Only reschedule if there are still connected tabs
      if (this.callbacks.size > 0) {
        this._scheduleCleanup();
      } else {
        this._cleanupTimer = null;
      }
    }, 60_000);
  }

  async flushAll(): Promise<void> {
    const layer = this.ensureLayer();
    return layer.flushAll();
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
    log.debug('batchWriteFiles called, files count:', files.length, 'deletePaths count:', deletePaths?.length ?? 0);
    const db = getDatabase();

    // Fix 55: Wrap all writes operations in a single transaction to ensure atomicity.
    // If any write fails, the entire batch is rolled back, preventing partial updates.
    await db.transaction('rw', db.fileSystemEntries, async () => {
      for (const file of files) {
        // Check if this is a protected file path (/AGENT.md or /scenarios/*.md)
        const isProtectedPath = this._isProtectedPath(file.path);

        if (isProtectedPath) {
          // Check if the file exists and has been edited by the user
          const existing = await db.fileSystemEntries.get(file.path);
          if (existing?.metadata?.editedByUser) {
            log.debug('batchWriteFiles: skipping protected file edited by user:', file.path);
            continue;
          }
        }

        // For protected paths, use overwrite mode (since we've already checked editedByUser above)
        // For other paths, always use overwrite mode
        const mode: 'overwrite' | 'append' | 'create-new' = 'overwrite';

        // Ensure editedByUser is set to false for system-generated files
        const metadata = {
          ...file.metadata,
          editedByUser: false,
        };

        await virtualFS.write(file.path, file.content, mode, metadata);
      }

      // Delete stale/orphan paths (doc reconciliation)
      if (deletePaths && deletePaths.length > 0) {
        for (const path of deletePaths) {
          try {
            await virtualFS.remove(path);
            log.debug('batchWriteFiles: deleted orphan path:', path);
          } catch (err) {
            log.warn('batchWriteFiles: failed to delete orphan path:', path, err);
          }
        }
      }
    });

    log.debug('batchWriteFiles completed');
    // Single broadcast for batch write to avoid per-file notifications
    // Fix 55: Broadcast only after transaction succeeds
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'updated',
      entityId: '',
      field: 'batch',
      oldValue: undefined,
      newValue: undefined,
    });
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

  async virtualFSRead(path: string, offset?: number, limit?: number): Promise<string> {
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
  ): Promise<Array<{ file: string; line: string; lineNumber: number }>> {
    return virtualFS.grep(pattern, path, caseSensitive, maxResults);
  }

  async virtualFSQueryByType(type: string): Promise<Array<{
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
  }>> {
    // Validate the incoming string against the known FileSystemEntryType union
    // to avoid passing an arbitrary string into virtualFS.queryByType.
    const validTypes: ReadonlyArray<FileSystemEntryType> = ['function', 'scenario', 'script', 'index'];
    if (!validTypes.includes(type as FileSystemEntryType)) {
      log.warn(`virtualFSQueryByType: unknown type "${type}", falling back to empty result`);
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
   */
  private broadcastUIUpdate(event: UIUpdateEvent, seq = 0): void {
    const payload = { event, seq };
    for (const cb of this.callbacks) {
      try {
        cb.onUIUpdate(payload);
      } catch (err) {
        log.error('onUIUpdate callback error:', err);
      }
    }
  }

  /**
   * Broadcast a file sync status change to all registered Tab callbacks.
   *
   * P0-2 fix: emits a UIUpdateEvent so the UI can react to sync status changes
   * (e.g., show spinner for 'syncing', checkmark for 'synced', error icon for 'failed').
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
   */
  private broadcastGapFillState(isSyncing: boolean): void {
    console.log('[BulkUpdate] WorkerCore.broadcastGapFillState called, isSyncing:', isSyncing, 'callbacks:', this.callbacks.size);
    for (const cb of this.callbacks) {
      try {
        cb.onGapFillState(isSyncing);
      } catch (err) {
        log.error('onGapFillState callback error:', err);
      }
    }
  }

  /**
   * Request a token (used as RTCAgentClient callback).
   *
   * - Picks any registered requestToken callback
   * - On failure, tries the next one
   */
  private async requestToken(): Promise<string> {
    for (const cb of this.callbacks) {
      try {
        return await cb.requestToken();
      } catch (err) {
        log.warn('requestToken failed, trying next:', err);
      }
    }
    throw new Error('[WorkerCore] no callback available to provide token');
  }

  /**
   * Request a token refresh (used as RTCAgentClient's onTokenExpired callback).
   *
   * - Picks any registered requestTokenRefresh callback
   * - On failure, tries the next one
   * - When all callbacks fail, returns 'relogin' (requires user to log in again)
   */
  private async requestTokenRefresh(): Promise<TokenExpiredAction> {
    for (const cb of this.callbacks) {
      try {
        return await cb.requestTokenRefresh();
      } catch (err) {
        log.warn('requestTokenRefresh failed, trying next:', err);
      }
    }
    return 'relogin';
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
    this.unsubscribeConnection = client.on('connection', (event: ConnectionStateEvent) => {
      log.debug('connection state changed:', event.state, 'reason:', event.reason);
      this.broadcastConnectionState(event);
    });
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
   */
  private broadcastConnectionState(event: ConnectionStateEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb.onConnectionStateChange(event);
      } catch (err) {
        log.error('onConnectionStateChange callback error:', err);
      }
    }
  }

  // ========== File Cache & S3 Operations ==========

  async cacheFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    ttlMs?: number
  ): Promise<void> {
    const layer = this.ensureLayer();
    return layer.cacheFile(md5, ext, blob, contentType, ttlMs);
  }

  async getCachedFile(
    md5: string,
    ext: string
  ): Promise<CachedFileInfo | null> {
    const layer = this.ensureLayer();
    return layer.getCachedFile(md5, ext);
  }

  async evictExpiredCache(): Promise<number> {
    const layer = this.ensureLayer();
    return layer.evictExpiredCache();
  }

  async evictCache(targetBytes?: number): Promise<{ evictedCount: number; evictedBytes: number }> {
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
    cacheTtlMs?: number
  ): Promise<{ syncStatus: 'pending' | 'syncing' | 'synced' | 'failed'; syncedAt?: number; errorMessage?: string }> {
    const layer = this.ensureLayer();
    // Create AbortController for this operation (allows cancellation via cancelFileOperation)
    const ac = new AbortController();
    if (operationId) {
      this._operationControllers.set(operationId, ac);
    }
    try {
      const result = await layer.uploadFile(md5, ext, blob, contentType, filename, ac.signal, onProgress, cacheTtlMs);
      // P0-2: broadcast sync status change to all tabs
      this._broadcastFileSyncStatus(md5, ext, result.syncStatus, result.errorMessage);
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
    forceRefresh?: boolean  // P2-NEW-4 fix: added forceRefresh parameter
  ): Promise<Blob> {
    const layer = this.ensureLayer();
    // Create AbortController for this operation (allows cancellation via cancelFileOperation)
    const ac = new AbortController();
    if (operationId) {
      this._operationControllers.set(operationId, ac);
    }
    try {
      // P2-NEW-4 fix: pass forceRefresh to PersistenceLayer
      const blob = await layer.downloadFile(md5, ext, onProgress, ac.signal, forceRefresh);
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

  async getPresignedUrl(operation: 'get' | 'put', key: string, expiresIn?: number): Promise<string> {
    const layer = this.ensureLayer();
    return layer.getPresignedUrl(operation, key, expiresIn);
  }

  async listFiles(syncStatus?: FileSyncStatus, limit: number = 100, offset: number = 0): Promise<FileCacheEntry[]> {
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
      this._broadcastFileSyncStatus(file.md5, file.ext, 'failed', file.errorMessage);
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
      this._broadcastFileSyncStatus(file.md5, file.ext, 'failed', file.errorMessage);
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
    updates: { filename?: string; contentType?: string }
  ): Promise<void> {
    const layer = this.ensureLayer();
    return layer.updateFileMetadata(md5, ext, updates);
  }
}
