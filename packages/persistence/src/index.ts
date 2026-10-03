/**
 * Persistence Layer
 *
 * Integrates RTCAgentClient (Centrifuge WebSocket) with IndexedDB storage (via Dexie).
 * Provides a unified API for: session/message/RTC CRUD, file cache management,
 * multipart S3 uploads with progress tracking, background sync of pending files,
 * debug history, and lifecycle management.
 *
 * This file is intentionally large (2000+ lines) because it serves as the main
 * facade for the entire persistence subsystem. All file operations (upload, download,
 * cache, sync), RTC message handling, and lifecycle coordination flow through this
 * class. Splitting would scatter the integration logic across files, making it
 * harder to understand the data flow between IndexedDB, S3, and the WebSocket client.
 */
import { RTCAgentClient, type RTCAgentClientOptions, type PublicationEvent, S3Client, type HeadObjectResult } from '@rtc-agent/client';
import type { Update, ContentData, SendMessageRequest, ForkSessionRequest, CompactSessionRequest } from '@rtc-agent/protocol';
import { getDatabase, closeDatabase, flushAll, type LocalSession, type LocalMessage, type LocalRtc, type DebugHistoryItem, type FileCacheEntry, type UploadPartRecord } from './database.js';
import { getOffsetManager } from './offset-manager.js';
import { initEntityRepository, getEntityRepository } from './entity-repository.js';
import { initDebugHistoryRepository, getDebugHistoryRepository, type PagedResult } from './debug-history-repository.js';
import { initFileCacheRepository, getFileCacheRepository, SYNC_LOCK_TIMEOUT_MS, type FileCacheRepository, type CachedFileInfo } from './file-cache-repository.js';
import { initUploadProgressRepository, getUploadProgressRepository, type UploadProgressRepository } from './upload-progress-repository.js';
import { FileOpCoordinator } from './file-op-coordinator.js';
import { nowRFC3339 } from './time-utils.js';
import { virtualFS } from './virtual-fs.js';
import { getUIUpdateBus } from './ui-update-bus.js';
import { createLogger } from '@rtc-agent/client';
import { SyncTaskTracker } from './sync-task-tracker.js';
import { LifecycleGuard, LifecycleClosedError } from './lifecycle-guard.js';
import { FileSyncTransaction } from './file-sync-transaction.js';
import { TrackedBackgroundTask } from './tracked-background-task.js';

const log = createLogger('PersistenceLayer');

/** Multipart upload threshold: 5MB (S3 minimum part size) */
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

/** Default part size for multipart upload: 5MB */
const DEFAULT_PART_SIZE = 5 * 1024 * 1024;

/** Maximum retry count for background sync of failed files */
const MAX_RETRY_COUNT = 3;

/** Concurrency level for resumeInterruptedUploads (sliding window) */
const RESUME_CONCURRENCY = 2;

export * from './database.js';
export * from './offset-manager.js';
export * from './entity-repository.js';
export * from './debug-history-repository.js';
export * from './file-cache-repository.js';
export * from './upload-progress-repository.js';
export * from './file-op-coordinator.js';
export * from './ui-update-bus.js';
export * from './time-utils.js';
export * from './permission.js';
export * from './tools/index.js';
export * from './virtual-fs.js';
export * from './virtual-fs-init.js';
export * from './script-engine.js';
export * from './sync-task-tracker.js';
export { LifecycleGuard, LifecycleClosedError } from './lifecycle-guard.js';
export { ResourceScope } from './resource-scope.js';
export { FileSyncTransaction } from './file-sync-transaction.js';
export { TrackedBackgroundTask } from './tracked-background-task.js';
export { createBuiltinTools } from './tools/builtin.js';
export { RtcProcessor, type ConfirmDialogFn, type AskUserDialogFn } from './rtc-processor.js';

/**
 * Persistence layer configuration.
 */
export interface PersistenceConfig {
  /** RTCAgentClient configuration */
  client: RTCAgentClientOptions;
  /** Database name (default: 'rtc-agent') */
  databaseName?: string;
  /** Device ID for filtering non-local-device RTCs at execution time */
  deviceId: string;
  /** User ID for S3 file operations */
  userId: string;
  /** Server URL for S3 operations (e.g., 'http://localhost:8888') */
  serverUrl: string;
}

/**
 * PersistenceLayer: integrates RTCAgentClient + IndexedDB.
 */
export class PersistenceLayer {
  private client: RTCAgentClient;
  private s3Client: S3Client | null = null;
  private fileCacheRepository: FileCacheRepository;
  private uploadProgressRepository: UploadProgressRepository;
  private fileOpCoordinator: FileOpCoordinator;
  private offsetManager = getOffsetManager();
  private entityRepository;
  private debugHistoryRepository;
  /** Unified async task tracker (tracks background sync and other fire-and-forget tasks) */
  private _syncTaskTracker = new SyncTaskTracker();
  /** Lifecycle guard: prevents DB operations after close */
  private _lifecycleGuard = new LifecycleGuard('PersistenceLayer');
  /** P1-R5-03: Close controller — aborts when lifecycle closes, propagated to all background tasks */
  private _closeController = new AbortController();
  /** Flag to prevent new sync tasks during shutdown */
  private _closing = false;
  /** Delayed cleanup timer for expired cache */
  private _cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private _userId: string;
  /** Online event listener (for auto-sync on network recovery) */
  private _onlineListener: (() => void) | null = null;
  /** Mutex for syncPendingFiles: prevents concurrent syncs from multiple tabs or manual calls */
  private _syncPromise: Promise<{
    synced: number;
    failed: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }> | null = null;

  constructor(config: PersistenceConfig) {
    // CRITICAL FIX: Validate required configuration fields to prevent runtime errors
    if (!config.deviceId) {
      throw new Error('[PersistenceLayer] deviceId is required in PersistenceConfig');
    }
    if (!config.userId) {
      throw new Error('[PersistenceLayer] userId is required in PersistenceConfig');
    }
    if (!config.serverUrl) {
      throw new Error('[PersistenceLayer] serverUrl is required in PersistenceConfig');
    }
    if (!config.client) {
      throw new Error('[PersistenceLayer] client is required in PersistenceConfig');
    }

    this._userId = config.userId;

    // Initialize EntityRepository singleton (device ID filtering on write)
    initEntityRepository(config.deviceId);
    this.entityRepository = getEntityRepository();

    // Initialize DebugHistoryRepository singleton
    initDebugHistoryRepository();
    this.debugHistoryRepository = getDebugHistoryRepository();

    // Initialize FileCacheRepository singleton
    initFileCacheRepository();
    this.fileCacheRepository = getFileCacheRepository();

    // Initialize UploadProgressRepository singleton
    initUploadProgressRepository();
    this.uploadProgressRepository = getUploadProgressRepository();

    // P2-C fix: instance-level FileOpCoordinator (no global singleton)
    this.fileOpCoordinator = new FileOpCoordinator();

    // Create RTCAgentClient, injecting offset and publication callbacks
    const clientOptions: RTCAgentClientOptions = {
      ...config.client,
      getLastOffset: (channel: string) => {
        // OffsetManager uses write-through caching: first call may hit IndexedDB,
        // but subsequent calls return from in-memory cache (effectively synchronous).
        // This design prevents race conditions in scheduleUpdate's deduplication logic.
        return this.offsetManager.getPosition(channel);
      },
      updateOffset: async (channel: string, offset: number, epoch: string) => {
        await this.offsetManager.updatePosition(channel, offset, epoch);
      },
      onPublication: async (event: PublicationEvent) => {
        await this.handlePublication(event);
      },
      onPublications: async (events: PublicationEvent[]) => {
        await this.handlePublications(events);
      },
      suspendUIUpdates: config.client.suspendUIUpdates ?? (() => {
        getUIUpdateBus().suspend();
      }),
      resumeUIUpdates: config.client.resumeUIUpdates ?? (() => {
        getUIUpdateBus().resume();
      }),
      onGapFillStart: config.client.onGapFillStart ?? (() => {
        getUIUpdateBus().emitGapFillStart();
      }),
      onGapFillEnd: config.client.onGapFillEnd ?? (() => {
        getUIUpdateBus().emitGapFillEnd();
      }),
    };

    this.client = new RTCAgentClient(clientOptions);

    // Initialize S3Client for file operations
    this.s3Client = new S3Client({
      serverUrl: config.serverUrl,
      getToken: config.client.getToken,
    });

    // Schedule delayed cache cleanup (5 seconds after initialization)
    this._cleanupTimer = setTimeout(() => {
      this.fileCacheRepository.evictExpired().catch(err => {
        log.warn('delayed cache cleanup failed:', err);
      });
      this._cleanupTimer = null;
    }, 5000);

    // Disabled: auto-sync on network online event (manual retry only)
    // this.setupNetworkListener();

    // P0-1 fix: recover stale 'syncing' entries from previous crashes/aborts.
    // P2-R5-05: tracked in SyncTaskTracker so close() waits for it.
    const recoverTask = this.fileCacheRepository.recoverStaleSyncing()
      .then(() => undefined)  // Map to void for SyncTaskTracker
      .catch(err => {
        log.warn('recoverStaleSyncing failed (non-fatal):', err);
      });
    this._syncTaskTracker.track(recoverTask, 'recover-stale-syncing');
  }

  /**
   * Get the RTCAgentClient instance.
   */
  getClient(): RTCAgentClient {
    return this.client;
  }

  /**
   * Get the OffsetManager instance.
   */
  getOffsetManager() {
    return this.offsetManager;
  }

  /**
   * Get the EntityRepository instance.
   */
  getEntityRepository() {
    return this.entityRepository;
  }

  /**
   * Get the DebugHistoryRepository instance.
   */
  getDebugHistoryRepository() {
    return this.debugHistoryRepository;
  }

  /**
   * Get the S3Client instance.
   */
  getS3Client(): S3Client | null {
    return this.s3Client;
  }

  /**
   * Get the FileCacheRepository instance.
   */
  getFileCacheRepository(): FileCacheRepository {
    return this.fileCacheRepository;
  }

  /**
   * Get the FileOpCoordinator instance (P2-NEW-3 fix).
   *
   * Used by WorkerCore to inject status change callbacks for per-file event broadcasting.
   */
  getFileOpCoordinator(): FileOpCoordinator {
    return this.fileOpCoordinator;
  }

  /**
   * P1-R5-03: Close signal — aborts when lifecycle closes.
   *
   * Passed to TrackedBackgroundTask and FileSyncTransaction so they can
   * cancel pending operations when close() is called.
   */
  get _closeSignal(): AbortSignal {
    return this._closeController.signal;
  }

  /**
   * Connect the client.
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnect the client.
   */
  disconnect(): void {
    this.client.disconnect();
  }

  /**
   * Reconnect the client.
   */
  async reconnect(): Promise<void> {
    await this.client.reconnect();
  }

  /**
   * Handle a Publication event.
   */
  private async handlePublication(event: PublicationEvent): Promise<void> {
    // Treat data as Update type
    const update = event.data as Update;

    // Apply update (persist entity)
    await this.entityRepository.applyUpdate(update);

    // Note: offset and epoch persistence is handled by the Client's updateOffset callback.
    // The Client calls updateOffset automatically after onPublication.
  }

  /**
   * Handle batch Publication events (optimized for gap fill).
   *
   * Uses applyUpdates for batch IndexedDB operations instead of per-item processing.
   */
  private async handlePublications(events: PublicationEvent[]): Promise<void> {
    const updates = events.map(e => e.data as Update);
    await this.entityRepository.applyUpdates(updates);
  }

  // ========== Convenience methods ==========

  /**
   * List all sessions.
   */
  async listSessions(cursor?: string, limit?: number): Promise<LocalSession[]> {
    return this.entityRepository.listSessions(cursor, limit);
  }

  /**
   * Get a session by client_id.
   */
  async getSession(clientId: string): Promise<LocalSession | undefined> {
    return this.entityRepository.getClientSession(clientId);
  }

  /**
   * List messages for a session.
   * @param direction 'backward' (default) = newest to oldest; 'forward' = oldest to newest
   * @param cursor Pagination cursor in "${timestamp}|${clientId}" format for (created_at, client_id) compound sort
   */
  async listMessages(sessionClientId: string, cursor?: string, limit?: number, direction?: 'backward' | 'forward'): Promise<LocalMessage[]> {
    return this.entityRepository.listMessagesBySession(sessionClientId, cursor, limit, direction);
  }

  /**
   * Get a message by client_id.
   */
  async getMessage(clientId: string): Promise<LocalMessage | undefined> {
    return this.entityRepository.getClientMessage(clientId);
  }

  /**
   * List RTCs for a session (ascending by offset; cursor is the starting offset).
   */
  async listRtc(sessionClientId: string, cursor?: number, limit?: number): Promise<LocalRtc[]> {
    return this.entityRepository.listRtcBySession(sessionClientId, cursor, limit);
  }

  /**
   * Get the next RTC to process.
   *
   * Device ID filtering is done at execution time (EntityRepository.getNextRtcToProcess);
   * only RTCs whose session_device_id matches the current device are returned.
   *
   * @param sessionClientId Optional session filter
   */
  async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
    return this.entityRepository.getNextRtcToProcess(sessionClientId);
  }

  // ========== Debug History ==========

  /**
   * Add a debug history item.
   */
  async addDebugHistoryItem(item: DebugHistoryItem): Promise<void> {
    return this.debugHistoryRepository.add(item);
  }

  /**
   * Query debug history with pagination.
   *
   * @param functionName Filter by function name (optional)
   * @param cursor Pagination cursor in "${timestamp}|${id}" format
   * @param limit Page size (default 20)
   */
  async queryDebugHistory(
    functionName?: string,
    cursor?: string,
    limit?: number
  ): Promise<PagedResult<DebugHistoryItem>> {
    return this.debugHistoryRepository.query(functionName, cursor, limit);
  }

  /**
   * Count debug history items.
   */
  async countDebugHistory(functionName?: string): Promise<number> {
    return this.debugHistoryRepository.count(functionName);
  }

  /**
   * Clear all debug history.
   */
  async clearDebugHistory(): Promise<void> {
    return this.debugHistoryRepository.clear();
  }

  /**
   * Batch delete debug history items by IDs.
   */
  async batchDeleteDebugHistory(ids: string[]): Promise<void> {
    return this.debugHistoryRepository.batchDelete(ids);
  }

  // ========== File Cache & S3 Operations ==========

  /**
   * Cache a downloaded file.
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param blob File content as Blob
   * @param contentType MIME type
   * @param ttlMs Time-to-live in milliseconds (default: 7 days)
   */
  async cacheFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    ttlMs?: number
  ): Promise<void> {
    return this.fileCacheRepository.put(md5, ext, blob, contentType, ttlMs);
  }

  /**
   * Cache a file with syncStatus='pending' (local cache only, no S3 upload).
   *
   * Used for the upload flow: file is written locally first so that
   * `getThumbnailUrl()` can load from cache immediately, while the actual
   * S3 sync happens asynchronously via `uploadFile()` or `syncPendingFiles()`.
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param blob File content as Blob
   * @param contentType MIME type
   * @param filename Original filename (optional, for UI display)
   */
  async cacheFilePending(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    filename?: string
  ): Promise<void> {
    return this.fileCacheRepository.putWithSyncStatus(md5, ext, blob, contentType, 'pending', filename);
  }

  /**
   * Get a cached file.
   *
   * Returns null if not found or expired.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  async getCachedFile(
    md5: string,
    ext: string
  ): Promise<CachedFileInfo | null> {
    return this.fileCacheRepository.get(md5, ext);
  }

  /**
   * Evict all expired cache entries.
   *
   * @returns Number of entries evicted
   */
  async evictExpiredCache(): Promise<number> {
    return this.fileCacheRepository.evictExpired();
  }

  /**
   * Evict synced cache entries using LRU strategy.
   *
   * Only evicts files with syncStatus='synced'. Pending/failed/syncing files
   * are preserved to prevent data loss.
   *
   * @param targetBytes Number of bytes to free (default: 100MB)
   * @returns Actual evicted count and bytes freed
   */
  async evictCache(targetBytes?: number): Promise<{ evictedCount: number; evictedBytes: number }> {
    const effectiveTarget = targetBytes && targetBytes > 0 ? targetBytes : 100 * 1024 * 1024;
    try {
      return await this.fileCacheRepository.evictLRU(effectiveTarget);
    } catch (err) {
      log.warn('evictCache failed (non-fatal):', err);
      return { evictedCount: 0, evictedBytes: 0 };
    }
  }

  /**
   * Upload a file to S3 with offline-first support.
   *
   * Flow:
   * 1. Write file to local cache with syncStatus='pending'
   * 2. If online, immediately sync to S3 with deduplication
   * 3. If offline or sync fails, file remains in local cache for later sync
   *
   * This ensures files are never lost even when offline.
   *
   * Progress semantics:
   * - Online upload: onProgress reflects S3 upload progress (0% -> 100%)
   * - Offline upload: onProgress jumps to 100% after writing to local cache
   *   (background sync progress is not reported via onProgress; tracked via syncStatus)
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param blob File content as Blob
   * @param contentType MIME type (optional)
   * @param filename Original filename (optional, for UI display)
   * @param signal AbortSignal for cancellation (optional)
   * @param onProgress Progress callback (optional)
   */
  async uploadFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType?: string,
    filename?: string,
    signal?: AbortSignal,
    onProgress?: (loaded: number, total: number) => void,
    cacheTtlMs?: number
  ): Promise<{ syncStatus: 'pending' | 'syncing' | 'synced' | 'failed'; syncedAt?: number; errorMessage?: string }> {
    // Check abort signal before starting
    if (signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }

    // P2-R7-03: Check lifecycle before any DB operations to prevent
    // unhandled LifecycleClosedError during shutdown.
    this._lifecycleGuard.assertActive();

    // 1. Write to local cache first (offline-safe)
    await this.fileCacheRepository.putWithSyncStatus(
      md5,
      ext,
      blob,
      contentType || 'application/octet-stream',
      'pending',
      filename,
      cacheTtlMs
    );

    // If offline, report 100% progress after local write
    if (onProgress && (!navigator.onLine || !this.s3Client)) {
      onProgress(blob.size, blob.size);
    }

    // 2. If online, attempt immediate sync to S3
    if (this.s3Client && typeof navigator !== 'undefined' && navigator.onLine) {
      // P3-R7-02: Track whether S3 upload completed. If abort fires between
      // upload success and state transition, we must NOT roll back to 'pending'
      // because S3 already has the data. recoverStaleSyncing will recover.
      let s3UploadCompleted = false;
      try {
        await this.fileCacheRepository.withSyncLock(md5, ext, async () => {
          await this.fileCacheRepository.syncWithDedup(md5, ext, async () => {
            // P0-2: use atomic transition with precondition check
            await this.fileCacheRepository.transitionSyncStatus(md5, ext, 'pending', 'syncing');

            if (blob.size > MULTIPART_THRESHOLD) {
              // Large file: use multipart upload with resume support
              await this._uploadMultipart(md5, ext, blob, contentType, signal, onProgress);
            } else {
              // Small file: direct upload (existing logic)
              await this.s3Client!.upload(this._userId, md5, ext, blob, { contentType, signal, onProgress });
            }

            s3UploadCompleted = true;
            await this.fileCacheRepository.transitionSyncStatus(md5, ext, 'syncing', 'synced');
          });
        });
      } catch (err) {
        // Handle abort separately: P0-1 fix — reset status to 'pending' so it can be retried
        if (err instanceof Error && err.name === 'AbortError') {
          log.info(`Upload aborted: ${md5}.${ext}`);
          // P3-R7-02: If S3 upload already completed, don't roll back.
          // State stays 'syncing' — recoverStaleSyncing will fix on next startup.
          if (s3UploadCompleted) {
            log.info(`Upload aborted after S3 completed for ${md5}.${ext}, keeping syncing state`);
            const cached = await this.fileCacheRepository.get(md5, ext);
            return {
              syncStatus: cached?.syncStatus ?? 'syncing',
              syncedAt: cached?.syncedAt,
              errorMessage: cached?.errorMessage,
            };
          }
          // P2-R6-02: Re-acquire lock before state transition to prevent TOCTOU race.
          // Without the lock, another operation could have started a new upload
          // and we'd overwrite its 'syncing' state with 'pending'.
          await this.fileCacheRepository.withSyncLock(md5, ext, async () => {
            const cached = await this.fileCacheRepository.get(md5, ext);
            // Only roll back if state is still 'syncing' (our operation's state).
            // If another operation already changed it, leave it alone.
            if (cached?.syncStatus === 'syncing') {
              await this.fileCacheRepository.transitionSyncStatus(
                md5, ext, 'syncing', 'pending'
              );
            }
          });
          const cached = await this.fileCacheRepository.get(md5, ext);
          return {
            syncStatus: cached?.syncStatus ?? 'pending',
            syncedAt: cached?.syncedAt,
            errorMessage: cached?.errorMessage,
          };
        }
        // Sync failed: mark as failed, but file is safely stored locally
        await this.fileCacheRepository.transitionSyncStatus(
          md5, ext, ['pending', 'syncing'], 'failed',
          { errorMessage: err instanceof Error ? err.message : String(err) }
        );
        log.warn(`Failed to sync file ${md5}.${ext} to S3 (stored locally, userId=${this._userId}, fileSize=${blob.size}, contentType=${contentType ?? 'n/a'}):`, err);
      }
    }

    // Return the final sync status from cache
    const cached = await this.fileCacheRepository.get(md5, ext);
    return {
      syncStatus: cached?.syncStatus ?? 'synced',
      syncedAt: cached?.syncedAt,
      errorMessage: cached?.errorMessage,
    };
  }

  /**
   * Multipart upload with resume support.
   *
   * Flow:
   * 1. Check for existing upload progress (resume candidate)
   * 2. If found, verify uploadId is still valid (listParts)
   * 3. If valid, skip already-uploaded parts
   * 4. Upload remaining parts, updating progress after each
   * 5. Complete multipart upload
   * 6. Clean up progress record
   *
   * If resume fails (expired uploadId), falls back to fresh upload.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param blob File content as Blob
   * @param contentType MIME type (optional)
   * @param signal AbortSignal for cancellation (optional)
   * @param onProgress Progress callback (optional)
   */
  private async _uploadMultipart(
    md5: string,
    ext: string,
    blob: Blob,
    contentType?: string,
    signal?: AbortSignal,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const progressRepo = this.uploadProgressRepository;
    const existing = await progressRepo.get(md5, ext);

    let uploadId: string = '';
    let completedParts: UploadPartRecord[] = [];
    let bytesUploaded = 0;
    const partSize = DEFAULT_PART_SIZE;
    let totalParts = 0;
    let resumeMode = false;

    // Try to resume from existing progress
    if (existing && existing.fileSize === blob.size) {
      try {
        // Verify uploadId is still valid by listing parts
        // P2-R7-02: Pass signal to listParts for cancellation support
        const serverParts = await this.s3Client!.listParts(
          this._userId, md5, ext, existing.uploadId, signal
        );

        uploadId = existing.uploadId;
        totalParts = existing.totalParts;

        // Build completed parts map from server-confirmed data
        const serverPartMap = new Map(serverParts.map(p => [p.partNumber, p]));
        for (const localPart of existing.completedParts) {
          const serverPart = serverPartMap.get(localPart.partNumber);
          if (serverPart) {
            completedParts.push({
              partNumber: localPart.partNumber,
              etag: serverPart.etag,
              size: localPart.size,
            });
          }
        }

        bytesUploaded = completedParts.reduce((sum, p) => sum + p.size, 0);
        resumeMode = true;

        log.info(`Resuming upload: ${md5}.${ext}, uploadId=${uploadId}, ` +
          `completed=${completedParts.length}/${totalParts}`);

      } catch (err) {
        // uploadId expired or invalid - start fresh
        log.warn(`Cannot resume upload ${md5}.${ext}: ${err}. Starting fresh.`);
        await progressRepo.delete(md5, ext);
        // Fall through to create new multipart upload
      }
    }

    // Create new multipart upload if not resuming
    if (!resumeMode) {
      totalParts = Math.ceil(blob.size / partSize);

      // P2-R7-02: Pass signal to createMultipartUpload for cancellation support
      uploadId = await this.s3Client!.createMultipartUpload(
        this._userId, md5, ext, contentType, signal
      );

      await progressRepo.create(
        md5, ext, uploadId,
        `user-${this._userId}/${md5}.${ext}`,
        blob.size,
        contentType || 'application/octet-stream',
        undefined,
        partSize
      );
    }

    // Upload remaining parts
    try {
      for (let partNum = 1; partNum <= totalParts; partNum++) {
        // Skip already-completed parts
        if (completedParts.some(p => p.partNumber === partNum)) {
          continue;
        }

        if (signal?.aborted) {
          throw new DOMException('Upload aborted', 'AbortError');
        }

        // Extract part data from blob
        const start = (partNum - 1) * partSize;
        const end = Math.min(start + partSize, blob.size);

        // Use block scope to ensure partData can be garbage collected after each iteration
        {
          const partBlob = blob.slice(start, end);
          const partData = new Uint8Array(await partBlob.arrayBuffer());

          // Track bytes before this part for progress calculation
          // P2-R5-09: partBytesUploaded is captured by the closure below,
          // so each part's progress is accumulated onto the global total.
          const partBytesUploaded = bytesUploaded;

          // Upload part with progress callback
          // P2-R7-02: Pass signal to uploadPart for cancellation support
          const result = await this.s3Client!.uploadPart(
            this._userId, md5, ext, uploadId, partNum, partData,
            (partLoaded, _partTotal) => {
              // Accumulate part progress to global progress
              onProgress?.(partBytesUploaded + partLoaded, blob.size);
            },
            signal
          );

          // Record progress
          const partRecord: UploadPartRecord = {
            partNumber: partNum,
            etag: result.etag,
            size: end - start,
          };

          await progressRepo.markPartCompleted(md5, ext, partRecord);
          completedParts.push(partRecord);

          // Report progress
          bytesUploaded += partRecord.size;
          onProgress?.(bytesUploaded, blob.size);
        } // partData scope ends here, can be garbage collected
      }

      // Complete multipart upload
      // P2-R7-02: Pass signal to completeMultipartUpload for cancellation support
      await this.s3Client!.completeMultipartUpload(
        this._userId, md5, ext, uploadId,
        completedParts.map(p => ({ partNumber: p.partNumber, etag: p.etag })),
        signal
      );

      // Clean up progress record
      await progressRepo.delete(md5, ext);

      log.info(`Multipart upload completed: ${md5}.${ext}, parts=${totalParts}`);

    } catch (err) {
      // Upload interrupted - progress is saved for resume
      log.warn(`Multipart upload interrupted: ${md5}.${ext}, ` +
        `progress saved (${completedParts.length}/${totalParts} parts)`);
      throw err;
    }
  }

  /**
   * Delete a file (local cache + S3).
   *
   * @param md5 File MD5 hash
   * @param ext File extension
   */
  async deleteFile(md5: string, ext: string): Promise<void> {
    // 1. Check local cache
    const cached = await this.fileCacheRepository.get(md5, ext);

    // 2. If synced to S3, delete S3 object
    if (cached?.syncStatus === 'synced' && this.s3Client) {
      try {
        await this.s3Client.delete(this._userId, md5, ext);
        log.info(`deleted file from S3: ${md5}.${ext}`);
      } catch (err) {
        log.warn(`failed to delete from S3: ${md5}.${ext}`, err);
        // Continue to delete local cache
      }
    }

    // 3. Delete local cache
    await this.fileCacheRepository.delete(md5, ext);
  }

  /**
   * Download a file from S3 with local caching.
   *
   * Flow:
   * 1. Check local cache (returns if hit and not expired, unless forceRefresh=true)
   *    - If cached file is 'pending' or 'failed' (with retryCount < MAX_RETRY_COUNT),
   *      trigger background sync (non-blocking) with per-file event broadcasting
   * 2. Download from S3 with deduplication
   * 3. Cache the downloaded file (TTL: 7 days, syncStatus='synced')
   * 4. Return the file
   *
   * Progress semantics:
   * - Online download: onProgress reflects S3 download progress
   * - Offline download (cache hit): returns immediately, onProgress not triggered
   *
   * On 404 (file not found on server), clears the cache entry and throws.
   *
   * P2-NEW-3 fix: background sync now uses FileOpCoordinator for per-file status broadcasting
   * P2-NEW-4 fix: added forceRefresh parameter to bypass local cache
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param onProgress Progress callback for download (optional)
   * @param signal AbortSignal for cancellation (optional)
   * @param forceRefresh If true, bypass local cache and download from S3 (optional, default: false)
   */
  async downloadFile(
    md5: string,
    ext: string,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
    forceRefresh?: boolean
  ): Promise<Blob> {
    // Check abort signal before starting
    if (signal?.aborted) {
      throw new DOMException('Download aborted', 'AbortError');
    }

    if (!this.s3Client) {
      throw new Error('S3Client not initialized');
    }

    // 1. Check local cache (skip if forceRefresh is true)
    // P2-NEW-4 fix: forceRefresh bypasses cache check
    if (!forceRefresh) {
      const cached = await this.fileCacheRepository.get(md5, ext);
      if (cached) {
        log.debug(`cache hit: ${md5}.${ext}, syncStatus=${cached.syncStatus}`);

        // If pending or failed, trigger background sync (don't block the return)
        // For failed files, check retry count to avoid infinite retries
        const shouldSync = cached.syncStatus === 'pending' ||
          (cached.syncStatus === 'failed' && (cached.retryCount ?? 0) < MAX_RETRY_COUNT);

        if (shouldSync && navigator.onLine) {
          log.info(`triggering background sync for ${cached.syncStatus} file: ${md5}.${ext}`);
          // P1-001/003 fix: use FileSyncTransaction for atomic state transitions
          // FileSyncTransaction handles: re-fetch entry, check transition result, execute action, notify
          const bgSync = this.fileCacheRepository.withSyncLock(md5, ext, async (lockSignal) => {
            const tx = new FileSyncTransaction(this.fileCacheRepository, this.fileOpCoordinator, this._lifecycleGuard);
            const result = await tx.run(md5, ext, {
              from: ['pending', 'failed'],
              to: 'syncing',
              signal: lockSignal,
              action: async (freshEntry, signal) => {
                // P1-003: freshEntry is re-fetched inside transaction, guaranteed current
                // signal is the same as lockSignal (passed through by FileSyncTransaction)
                if (freshEntry.blob.size > MULTIPART_THRESHOLD) {
                  await this._uploadMultipart(md5, ext, freshEntry.blob, freshEntry.contentType, signal);
                } else {
                  await this.s3Client!.upload(this._userId, md5, ext, freshEntry.blob, {
                    contentType: freshEntry.contentType,
                    signal,
                  });
                }
              },
              onSuccess: 'synced',
              onFailure: 'failed',
            });

            if (!result.success) {
              // P3-R8-01: Distinguish precondition failure (concurrent state change)
              // from actual errors. Precondition failures are expected in concurrent
              // scenarios and should be logged at debug level, not warn.
              if (result.error === 'Transition precondition not met') {
                log.debug(`background sync: skipped ${md5}.${ext} (state changed concurrently)`);
              } else {
                log.debug(`background sync: transaction returned '${result.error}' for ${md5}.${ext}`);
              }
            }
          }, SYNC_LOCK_TIMEOUT_MS, this._closeSignal).catch(err => {
            // AbortError: don't mark as failed — keep current state for retry
            if (err instanceof Error && err.name === 'AbortError') {
              log.info(`background sync cancelled for ${md5}.${ext}`);
              return;
            }
            // LifecycleClosedError: graceful shutdown
            if (err instanceof LifecycleClosedError) {
              log.debug('background sync: lifecycle closed, ignoring');
              return;
            }
            log.warn('background sync failed:', err);
          });
          this._syncTaskTracker.track(bgSync, `background-sync-${md5}.${ext}`);
        }

        return cached.blob;
      }
    } else {
      log.debug(`forceRefresh=true, skipping cache check for ${md5}.${ext}`);
    }

    // 2. Download from S3 with deduplication
    log.debug(`cache miss: ${md5}.${ext}, downloading from S3`);
    try {
      const blob = await this.fileCacheRepository.downloadWithDedup(
        md5,
        ext,
        () => this.s3Client!.download(this._userId, md5, ext, { signal, onProgress })
      );

      // 3. Get content type from head.
      // P0-3 fix: head() failure should NOT discard the successfully downloaded blob.
      // Fall back to default contentType so the file remains usable.
      let contentType = 'application/octet-stream';
      try {
        const head = await this.s3Client.head(this._userId, md5, ext);
        contentType = head.contentType ?? contentType;
      } catch (headErr) {
        log.warn(`head() failed for ${md5}.${ext}, using default contentType:`, headErr);
      }

      // 4. Cache the downloaded file
      // Gap 2 fix: if an entry already exists, use updateBlob() to only refresh data/contentType
      // without resetting createdAt (putWithSyncStatus would reset createdAt to Date.now()).
      // P1-3 fix is also preserved: syncStatus is not modified by updateBlob().
      const existing = await this.fileCacheRepository.get(md5, ext);
      if (existing) {
        log.debug(`downloadFile: entry exists for ${md5}.${ext}, updating blob only (preserving createdAt)`);
        await this.fileCacheRepository.updateBlob(md5, ext, blob, contentType);
      } else {
        await this.fileCacheRepository.putWithSyncStatus(
          md5,
          ext,
          blob,
          contentType,
          'synced'
        );
      }

      return blob;
    } catch (err) {
      // Handle abort separately
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      // S3 download failed: nothing was cached, no stale entry to clean up
      log.error(`download failed for ${md5}.${ext} (userId=${this._userId}):`, err);
      throw err;
    }
  }

  /**
   * Calculate MD5 hash of a Blob (runs in Worker thread).
   *
   * @param blob Blob to calculate MD5 for
   * @returns Promise resolving to 32-character hex MD5 hash
   */
  async calculateFileMD5(blob: Blob): Promise<string> {
    return this.fileCacheRepository.calculateMD5(blob);
  }

  /**
   * Get file metadata from S3 (without downloading).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @returns HeadObjectResult with contentLength, contentType, lastModified, etag
   */
  async headFile(md5: string, ext: string): Promise<HeadObjectResult> {
    if (!this.s3Client) {
      throw new Error('S3Client not initialized');
    }
    return this.s3Client.head(this._userId, md5, ext);
  }

  /**
   * Get a presigned URL for file operations.
   *
   * @param operation 'get' or 'put'
   * @param key S3 object key
   * @param expiresIn Expiration time in seconds (default: 3600)
   * @returns Presigned URL string
   */
  async getPresignedUrl(operation: 'get' | 'put', key: string, expiresIn?: number): Promise<string> {
    if (!this.s3Client) {
      throw new Error('S3Client not initialized');
    }
    return this.s3Client.getPresignedUrl(operation, key, expiresIn);
  }

  /**
   * List files by sync status.
   *
   * @param syncStatus Filter by sync status (optional, lists all if omitted)
   * @param limit Maximum number of entries to return (default: 100)
   * @param offset Number of entries to skip (default: 0)
   */
  async listFiles(
    syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed',
    limit: number = 100,
    offset: number = 0
  ): Promise<FileCacheEntry[]> {
    return this.fileCacheRepository.listBySyncStatus(syncStatus, limit, offset);
  }

  /**
   * Count files by sync status.
   *
   * @param syncStatus Filter by sync status (optional, counts all if omitted)
   */
  async countFiles(
    syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed'
  ): Promise<number> {
    return this.fileCacheRepository.countBySyncStatus(syncStatus);
  }

  /**
   * Get cache statistics: total files, total size, and breakdown by sync status.
   */
  async getCacheStats(): Promise<import('./file-cache-repository.js').CacheStats> {
    return this.fileCacheRepository.getCacheStats();
  }

  /**
   * Update file metadata (filename, contentType) in the local cache.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param updates Partial metadata to update
   */
  async updateFileMetadata(
    md5: string,
    ext: string,
    updates: { filename?: string; contentType?: string }
  ): Promise<void> {
    return this.fileCacheRepository.updateMetadata(md5, ext, updates);
  }

  // ========== Network-Aware Sync ==========

  // setupNetworkListener: DISABLED
  // Auto-sync on network online event is disabled in favor of manual retry.
  // Users now explicitly retry failed uploads via the UI.
  // The method has been removed; removeNetworkListener() remains for cleanup.

  /**
   * Remove the network online event listener.
   *
   * Called during close() to prevent memory leaks.
   */
  private removeNetworkListener(): void {
    if (this._onlineListener && typeof self !== 'undefined' && typeof self.removeEventListener === 'function') {
      self.removeEventListener('online', this._onlineListener);
      this._onlineListener = null;
      log.info('Network listener removed');
    }
  }

  /**
   * Batch sync all pending/failed files to S3.
   *
   * Automatically called when the network comes back online (via the 'online' event listener).
   * Can also be called manually at any time.
   *
   * Offline calls are no-ops: returns { synced: 0, failed: 0 } without errors.
   *
   * Mutex: if a sync is already in progress, returns the same Promise to avoid
   * duplicate work (e.g., multiple tabs triggering online event simultaneously).
   *
   * @returns Statistics: number of files synced and number of files that failed,
   *          plus detailed lists of synced and failed files (for UI broadcast)
   */
  async syncPendingFiles(): Promise<{
    synced: number;
    failed: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }> {
    // Mutex: if sync already in progress, join the existing sync
    if (this._syncPromise) {
      log.debug('sync already in progress, joining existing sync');
      return this._syncPromise;
    }

    this._syncPromise = this._doSyncPendingFiles();
    try {
      return await this._syncPromise;
    } finally {
      this._syncPromise = null;
    }
  }

  /**
   * Internal implementation of syncPendingFiles (called under mutex).
   */
  private async _doSyncPendingFiles(): Promise<{
    synced: number;
    failed: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }> {
    if (!this.s3Client || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      log.debug('syncPendingFiles: offline or no S3Client, skipping');
      return { synced: 0, failed: 0, syncedFiles: [], failedFiles: [] };
    }

    // First, resume any interrupted multipart uploads
    await this.resumeInterruptedUploads();

    // Collect pending and failed files
    const pending = await this.fileCacheRepository.listBySyncStatus('pending', 100, 0);
    const failed = await this.fileCacheRepository.listBySyncStatus('failed', 100, 0);

    const toSync = [...pending, ...failed];
    if (toSync.length === 0) {
      log.debug('syncPendingFiles: no pending/failed files');
      return { synced: 0, failed: 0, syncedFiles: [], failedFiles: [] };
    }

    log.info(`syncing ${toSync.length} pending/failed files`);

    let synced = 0;
    let failedCount = 0;
    const syncedFiles: Array<{ md5: string; ext: string }> = [];
    const failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }> = [];

    for (const entry of toSync) {
      // P3-R7-03: Early exit when lifecycle is closing.
      // Without this, each entry would immediately abort via withSyncLock's
      // externalSignal, causing N useless iterations and state transitions.
      if (this._closeSignal.aborted) {
        log.info(`syncPendingFiles: lifecycle closing, stopping sync loop (${toSync.length - synced - failedCount} remaining)`);
        break;
      }
      try {
        await this.fileCacheRepository.withSyncLock(entry.md5, entry.ext, async () => {
          await this.fileCacheRepository.syncWithDedup(entry.md5, entry.ext, async () => {
            // P1-002/003 fix: use FileSyncTransaction for atomic state transitions
            const tx = new FileSyncTransaction(this.fileCacheRepository, this.fileOpCoordinator, this._lifecycleGuard);
            const result = await tx.run(entry.md5, entry.ext, {
              from: ['pending', 'failed'],
              to: 'syncing',
              signal: this._closeSignal,
              action: async (freshEntry, signal) => {
                // P1-003: use freshEntry (re-fetched) instead of stale entry.data
                if (freshEntry.blob.size > MULTIPART_THRESHOLD) {
                  await this._uploadMultipart(entry.md5, entry.ext, freshEntry.blob, freshEntry.contentType, signal);
                } else {
                  await this.s3Client!.upload(this._userId, entry.md5, entry.ext, freshEntry.blob, {
                    contentType: freshEntry.contentType,
                    signal,
                  });
                }
              },
              onSuccess: 'synced',
              onFailure: 'failed',
            });

            if (!result.success) {
              // P3-R8-02: Differentiate abort from operational failure.
              // Abort means lifecycle is closing — leave state in 'syncing',
              // recoverStaleSyncing will reset to 'pending' on next startup.
              // Operational failure should transition to 'failed' for retry.
              if (result.aborted) {
                throw new DOMException('Sync aborted', 'AbortError');
              }
              throw new Error(result.error ?? 'Transaction failed');
            }
          });
        }, SYNC_LOCK_TIMEOUT_MS, this._closeSignal);
        synced++;
        syncedFiles.push({ md5: entry.md5, ext: entry.ext });
      } catch (err) {
        failedCount++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        // P3-R8-02: Abort scenario — state is 'syncing' (action was cancelled before completion).
        // Leave state unchanged; recoverStaleSyncing will reset on next startup.
        // Do NOT transition to 'failed' — the file data is valid, just not yet synced.
        if (err instanceof Error && err.name === 'AbortError') {
          log.info(`sync aborted for ${entry.md5}.${entry.ext} (lifecycle closing)`);
          failedFiles.push({ md5: entry.md5, ext: entry.ext, errorMessage: 'Aborted' });
          continue;
        }
        // P3-R5-02: FileSyncTransaction already transitions to 'failed' on operational errors.
        // Only transition here if the state is NOT already 'failed' (e.g., aborted transactions
        // leave state in 'syncing', which we want to mark as 'failed' for retry).
        const cached = await this.fileCacheRepository.get(entry.md5, entry.ext);
        if (cached?.syncStatus !== 'failed') {
          await this.fileCacheRepository.transitionSyncStatus(
            entry.md5, entry.ext, ['pending', 'syncing'], 'failed',
            { errorMessage }
          );
        }
        failedFiles.push({ md5: entry.md5, ext: entry.ext, errorMessage });
        log.warn(`Failed to sync ${entry.md5}.${entry.ext}:`, err);
      }
    }

    log.info(`sync complete: ${synced} synced, ${failedCount} failed`);
    return { synced, failed: failedCount, syncedFiles, failedFiles };
  }

  /**
   * Resume all interrupted multipart uploads.
   *
   * Scans uploadParts table for in-progress uploads and attempts to resume each.
   * Called during initialization and when network comes back online.
   *
   * Uses a sliding window with concurrency=2 to process uploads in parallel,
   * balancing throughput with bandwidth consumption.
   *
   * P2-NEW-6 fix: Returns syncedFiles/failedFiles for per-file event broadcasting.
   * Uses FileOpCoordinator for status change notifications.
   *
   * @returns Statistics: number of uploads resumed, failed, expired, plus detailed file lists
   */
  async resumeInterruptedUploads(): Promise<{
    resumed: number;
    failed: number;
    expired: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }> {
    if (!this.s3Client || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return { resumed: 0, failed: 0, expired: 0, syncedFiles: [], failedFiles: [] };
    }

    const progressRepo = this.uploadProgressRepository;
    const allProgress = await progressRepo.listAll();

    if (allProgress.length === 0) {
      return { resumed: 0, failed: 0, expired: 0, syncedFiles: [], failedFiles: [] };
    }

    log.info(`Found ${allProgress.length} interrupted uploads to resume`);

    let resumed = 0;
    let failed = 0;
    let expired = 0;
    const syncedFiles: Array<{ md5: string; ext: string }> = [];
    const failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }> = [];

    // P2-G fix: use _runWithConcurrency for better readability
    await this._runWithConcurrency(allProgress, RESUME_CONCURRENCY, async (progress) => {
      // Check expiration
      if (progress.expiresAt < Date.now()) {
        try {
          await this.s3Client!.abortMultipartUpload(
            this._userId, progress.md5, progress.ext, progress.uploadId
          );
        } catch { /* ignore abort errors */ }

        await progressRepo.delete(progress.md5, progress.ext);
        await this.fileCacheRepository.updateSyncStatus(
          progress.md5, progress.ext, 'failed',
          'Multipart upload expired (>7 days)'
        );
        this.fileOpCoordinator.notifyStatusChange(
          progress.md5, progress.ext, 'failed',
          'Multipart upload expired (>7 days)'
        );
        expired++;
        failedFiles.push({ md5: progress.md5, ext: progress.ext, errorMessage: 'Multipart upload expired' });
        return;
      }

      // Try to resume - need the blob from fileCache
      const cached = await this.fileCacheRepository.get(progress.md5, progress.ext);
      if (!cached) {
        await progressRepo.delete(progress.md5, progress.ext);
        await this.fileCacheRepository.updateSyncStatus(
          progress.md5, progress.ext, 'failed',
          'File data not available for resume'
        );
        this.fileOpCoordinator.notifyStatusChange(
          progress.md5, progress.ext, 'failed',
          'File data not available for resume'
        );
        failed++;
        failedFiles.push({ md5: progress.md5, ext: progress.ext, errorMessage: 'File data not available' });
        return;
      }

      try {
        await this._uploadMultipart(
          progress.md5,
          progress.ext,
          cached.blob,
          progress.contentType,
        );
        resumed++;
        syncedFiles.push({ md5: progress.md5, ext: progress.ext });
        // P2-R8-01: Persist syncStatus to 'synced' in DB. Without this, the file
        // remains 'pending' in IndexedDB and _doSyncPendingFiles (called immediately
        // after) would re-upload the entire file, wasting bandwidth.
        await this.fileCacheRepository.transitionSyncStatus(
          progress.md5, progress.ext, ['pending', 'syncing'], 'synced'
        );
        this.fileOpCoordinator.notifyStatusChange(progress.md5, progress.ext, 'synced');
      } catch (err) {
        failed++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn(`Failed to resume upload ${progress.md5}.${progress.ext}:`, err);
        failedFiles.push({ md5: progress.md5, ext: progress.ext, errorMessage });
        this.fileOpCoordinator.notifyStatusChange(progress.md5, progress.ext, 'failed', errorMessage);
      }
    });

    log.info(`Resume complete: ${resumed} resumed, ${failed} failed, ${expired} expired`);
    return { resumed, failed, expired, syncedFiles, failedFiles };
  }

  /**
   * Close the database.
   * Waits for active sync tasks to complete (with timeout) before closing.
   */
  async close(): Promise<void> {
    this._closing = true;

    // P1-R5-03: Abort close signal FIRST — tells all background tasks to stop
    this._closeController.abort();

    // Remove network listener to prevent memory leaks
    this.removeNetworkListener();

    // Clear delayed cleanup timer
    if (this._cleanupTimer) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    // Wait for active sync tasks to complete (max 5 seconds)
    const drainResult = await this._syncTaskTracker.drain(5000);
    if (!drainResult.completed) {
      log.warn(
        `close(): drain timed out, ${drainResult.remainingTasks.length} tasks abandoned:`,
        drainResult.remainingTasks
      );
    }

    // Activate lifecycle guard — after this point, all DB operations are intercepted
    this._lifecycleGuard.close();
    this.fileCacheRepository.closeLifecycleGuard();

    this.disconnect();
    this.s3Client?.dispose();
    this.s3Client = null;
    await closeDatabase();

    // Clean up FileOpCoordinator listeners (P2-D)
    this.fileOpCoordinator.clearAllListeners();

    log.info('PersistenceLayer closed');
  }

  /**
   * Flush all data (for development/testing).
   */
  async flushAll(): Promise<void> {
    await flushAll();
  }

  // ========== Data flow core ==========

  /**
   * Send a message: local write first + immediate return + background sync.
   */
  async sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const { content, messageClientId, sessionClientId } = params;

    // 1. Look up session
    const existing = await this.entityRepository.getClientSession(sessionClientId);

    let session: LocalSession;
    let isNewSession: boolean;
    let agentPrompt = '';
    // 3. Not found: create new session, read AGENT.md from VirtualFS as agent_prompt
    // Read AGENT.md from VirtualFS as agent_prompt (silently skip if not found).
    // Other errors (e.g. DB corruption) are logged at debug level for diagnostics.
    try {
      agentPrompt = await virtualFS.read('/AGENT.md');
    } catch (err) {
      log.debug('AGENT.md not found or unreadable (non-fatal):', err);
    }

    if (existing) {
      // 2. Found session: touch updated_at, keep existing sync_status and server_id
      const now = nowRFC3339();
      const result = await this.entityRepository.upsertSession(
        { client_id: existing.client_id, server_id: existing.server_id, updated_at: now, agent_prompt: agentPrompt },
        existing.sync_status,
        { silent: true }
      );
      session = result.after;
      isNewSession = false;
      agentPrompt = result.after.agent_prompt ?? "";
    } else {
      // Generate session title from first message content (first line, max 50 chars)
      const generatedTitle = this._generateSessionTitle(content);
      log.info('sendMessage: New session created, generated title:', `"${generatedTitle}"`);

      const result = await this.entityRepository.upsertSession(
        { client_id: sessionClientId, status: 'active', agent_prompt: agentPrompt, title: generatedTitle },
        'pending',
        { silent: true }
      );
      session = result.after;
      isNewSession = true;
      log.info('sendMessage: Session after upsert:', { client_id: session.client_id, title: session.title });
    }

    // 4. Write message
    const now = nowRFC3339();
    // Store the full ContentData (including type and data) so the message type can be
    // correctly identified when reading back.
    // MessageController._localMessageToUI and _extractTextFromContent handle deserialization.
    const contentStr = JSON.stringify(content);
    const msgResult = await this.entityRepository.upsertMessage(
      {
        client_id: messageClientId,
        session_client_id: session.client_id,
        role: 'user',
        content: contentStr,
        streaming_status: 'completed',
        created_at: now,
        updated_at: now,
      },
      'pending',
      { silent: true }
    );
    const message = msgResult.after;

    // 5. Return immediately
    // 6. Fire-and-forget async sync (tracked for graceful shutdown)
    if (this._closing) {
      log.warn('sendMessage: sync skipped, persistence is closing');
    } else {
      const syncTask = this._syncToServer(message, session, content, isNewSession, agentPrompt).catch(err => {
        log.error('_syncToServer failed:', err);
      });
      this._syncTaskTracker.track(syncTask, `sync-message-${message.client_id}`);
    }

    return { session, message };
  }

  /**
   * Insert a local message (not sent to server).
   *
   * Used for injecting system-generated messages into the conversation
   * (e.g. todo_list change notifications). The message is written directly
   * to IndexedDB with syncStatus 'synced' and does not trigger background sync.
   */
  async insertLocalMessage(params: {
    sessionClientId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    creatorKind?: string;
    creatorRefId?: string;
  }): Promise<LocalMessage> {
    const now = nowRFC3339();
    const result = await this.entityRepository.upsertMessage(
      {
        client_id: crypto.randomUUID(),
        session_client_id: params.sessionClientId,
        role: params.role,
        content: params.content,
        streaming_status: 'completed',
        creator_kind: params.creatorKind ?? 'system',
        creator_ref_id: params.creatorRefId ?? '',
        created_at: now,
        updated_at: now,
      },
      'synced',
    );
    return result.after;
  }

  // ========== Private helpers ==========

  /**
   * Concurrency controller — runs workers with bounded parallelism.
   *
   * P2-G fix: replaces shared-index sliding window for better readability.
   * At most `concurrency` workers run simultaneously; each new item starts
   * as soon as one slot opens.
   */
  private async _runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    const executing = new Set<Promise<void>>();

    for (const item of items) {
      const task = worker(item);
      executing.add(task);
      task.finally(() => executing.delete(task));

      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }

  /**
   * Look up a session and verify it has been synced to the server.
   *
   * Throws if the session is not found or has no server_id (not yet synced).
   * Extracted to eliminate the repeated lookup + guard pattern across
   * stopTurn, closeSession, openSession, and compactSession.
   *
   * Returns the session with `server_id` narrowed to non-undefined string.
   */
  private async _requireSyncedSession(sessionClientId: string): Promise<LocalSession & { server_id: string }> {
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session?.server_id) {
      throw new Error(`Session not found or not synced: ${sessionClientId}`);
    }
    return session as LocalSession & { server_id: string };
  }

  /**
   * Apply server-returned updates from an RPC response.
   *
   * No-op when the response has no updates. Extracted to eliminate the repeated
   * `if (response.updates && response.updates.length > 0)` guard.
   */
  private async _applyResponseUpdates(response: { updates?: Update[] }): Promise<void> {
    if (response.updates && response.updates.length > 0) {
      await this.client.applyUpdates(response.updates);
    }
  }

  /**
   * Generate a session title from message content.
   *
   * Takes the first line of the first message text, truncated to 50 characters.
   * Returns "New Chat" if content is empty or unparseable.
   */
  private _generateSessionTitle(content: ContentData): string {
    try {
      let text = '';
      if (typeof content.data === 'string') {
        text = content.data;
      } else if (content.data && typeof content.data === 'object') {
        // Attempt to extract text from the object
        const obj = content.data as Record<string, unknown>;
        text = (obj.text as string) || (obj.content as string) || JSON.stringify(content.data);
      }

      // Take first line, trim whitespace
      const firstLine = text.split('\n')[0]?.trim() || '';
      if (!firstLine) return 'New Chat';

      // Truncate to 50 characters
      return firstLine.length > 50 ? firstLine.substring(0, 50) + '…' : firstLine;
    } catch {
      return 'New Chat';
    }
  }

  /**
   * Background sync: send message to the server.
   *
   * P1-NEW-C fix: Use _lifecycleGuard.run() for all DB operations to prevent
   * writes to closed database. Replaces scattered _closing checks with unified
   * lifecycle management.
   */
  private async _syncToServer(
    message: LocalMessage,
    session: LocalSession,
    content: ContentData,
    isNewSession: boolean,
    agentPrompt: string,
  ): Promise<void> {
    // 1. Build request
    const req: SendMessageRequest = {
      server_session_id: session.server_id,
      content_data: content,
      client_id: message.client_id,
      client_session_id: session.client_id,
      agent_prompt: agentPrompt,
    };

    try {
      // 2. Call RPC
      const response = await this.client.sendMessage(req);

      // 3. On success: apply server-returned updates
      // P1-NEW-C: Use _lifecycleGuard.run() for graceful degradation
      await this._lifecycleGuard.run(async () => {
        await this._applyResponseUpdates(response);
      });

      // Fallback: ensure message sync_status is marked as synced
      // P1-NEW-C: Use _lifecycleGuard.run() for graceful degradation
      await this._lifecycleGuard.run(async () => {
        await this.entityRepository.upsertMessage(
          {
            client_id: message.client_id,
            server_id: response.result.message_id,
          },
          'synced'
        );
      });

      // If this is a new session, update session as well
      if (isNewSession) {
        // P1-NEW-C: Use _lifecycleGuard.run() for graceful degradation
        await this._lifecycleGuard.run(async () => {
          await this.entityRepository.upsertSession(
            {
              client_id: session.client_id,
              server_id: response.result.session_id,
            },
            'synced'
          );
        });
      }
    } catch (err) {
      // 4. On failure
      log.error('_syncToServer RPC failed:', err);

      // P1-NEW-C: Use _lifecycleGuard.run() for graceful degradation
      await this._lifecycleGuard.run(async () => {
        await this.entityRepository.upsertMessage(
          { client_id: message.client_id },
          'failed'
        );
      });

      if (isNewSession && session.sync_status === 'pending') {
        // P1-NEW-C: Use _lifecycleGuard.run() for graceful degradation
        await this._lifecycleGuard.run(async () => {
          await this.entityRepository.upsertSession(
            { client_id: session.client_id },
            'failed'
          );
        });
      }
    }
  }

  /**
   * Stop the current turn.
   */
  async stopTurn(sessionClientId: string): Promise<void> {
    const session = await this._requireSyncedSession(sessionClientId);
    const response = await this.client.stopTurn(session.server_id);
    await this._applyResponseUpdates(response);
  }

  /**
   * Close a session (notify backend to stop the turn loop).
   */
  async closeSession(sessionClientId: string): Promise<void> {
    const session = await this._requireSyncedSession(sessionClientId);
    const response = await this.client.closeSession(session.server_id);
    await this._applyResponseUpdates(response);
  }

  /**
   * Reopen a closed session.
   */
  async openSession(sessionClientId: string): Promise<void> {
    const session = await this._requireSyncedSession(sessionClientId);
    const response = await this.client.openSession(session.server_id);
    await this._applyResponseUpdates(response);
  }

  /**
   * Compact session context.
   */
  async compactSession(sessionClientId: string, customInstruction?: string): Promise<void> {
    const session = await this._requireSyncedSession(sessionClientId);
    const req: CompactSessionRequest = {
      session_id: session.server_id,
      custom_instruction: customInstruction,
    };
    const response = await this.client.compactSession(req);
    await this._applyResponseUpdates(response);
  }

  /**
   * Delete a session (soft delete): optimistic local update + async RPC sync.
   *
   * Flow:
   * 1. EntityRepository.softDeleteSession -> writes deleted_at + updated_at locally, sync_status='pending'
   * 2. Async RPC: call updateSession({ session_id, deleted_at })
   *    - Success: write back sync_status='synced'
   *    - Failure: exponential backoff retry (max 3 attempts), then sync_status='failed' + notify UI
   */
  async deleteSession(sessionClientId: string): Promise<void> {
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session) return;

    // Step 1: Optimistic local update (via EntityRepository, triggers UIUpdateBus)
    await this.entityRepository.softDeleteSession(sessionClientId);

    // Step 2: Async RPC sync (only when server_id exists)
    if (session.server_id) {
      const deletedAt = session.deleted_at ?? nowRFC3339();
      this._syncWithRetry(
        () => this.client.updateSession({ session_id: session.server_id!, deleted_at: deletedAt }),
        session.server_id,
        'delete',
      );
    }
  }

  /**
   * Update session title: optimistic local update + async RPC sync.
   */
  async updateSessionTitle(sessionClientId: string, title: string): Promise<void> {
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session) return;

    // Step 1: Optimistic local update
    const now = nowRFC3339();
    await this.entityRepository.upsertSession(
      {
        client_id: sessionClientId,
        title,
        updated_at: now,
      },
      'pending',
    );

    // Step 2: Async RPC sync
    if (session.server_id) {
      this._syncWithRetry(
        () => this.client.updateSession({ session_id: session.server_id!, title }),
        session.server_id,
        'update',
      );
    }
  }

  /**
   * Generic sync retry logic with exponential backoff.
   *
   * Runs asynchronously without blocking the caller.
   * On success: writes back sync_status='synced'.
   * On exceeding retry limit: marks sync_status='failed'.
   */
  private static readonly SYNC_MAX_RETRIES = 3;
  private static readonly SYNC_BASE_DELAY_MS = 1000;

  private _syncWithRetry(
    rpc: () => Promise<unknown>,
    serverId: string,
    action: 'delete' | 'update',
  ): void {
    // P2-005 fix: use TrackedBackgroundTask for lifecycle tracking and cancellable delays
    // P1-R5-02: pass closeSignal so task is aborted when lifecycle closes
    const task = new TrackedBackgroundTask(this._syncTaskTracker, this._lifecycleGuard, this._closeSignal);
    task.run(`${action}-session-${serverId}`, async (_signal) => {
      await rpc();
      // On success: write back sync_status='synced'
      await this._markSessionSynced(serverId);
    }, {
      retries: PersistenceLayer.SYNC_MAX_RETRIES - 1,
      baseDelay: PersistenceLayer.SYNC_BASE_DELAY_MS,
      exponentialBackoff: true,
    }).catch(err => {
      // Max retries exceeded: mark as failed
      log.error(`${action}Session RPC failed after ${PersistenceLayer.SYNC_MAX_RETRIES} attempts:`, err);
      // Use _lifecycleGuard.run to prevent DB writes after close
      this._lifecycleGuard.run(async () => {
        await this._markSessionSyncFailed(serverId);
      });
    });
  }

  private async _markSessionSynced(serverId: string): Promise<void> {
    const session = await this.entityRepository.getSessionByServerId(serverId);
    if (session) {
      await this.entityRepository.upsertSession({ client_id: session.client_id }, 'synced');
    }
  }

  private async _markSessionSyncFailed(serverId: string): Promise<void> {
    const session = await this.entityRepository.getSessionByServerId(serverId);
    if (session) {
      await this.entityRepository.upsertSession({ client_id: session.client_id }, 'failed');
    }
  }

  /**
   * Submit an RTC execution result (single attempt, no retry).
   * On failure: marks sync_status='failed'; caller retries via getNextRtcToProcess.
   */
  async submitRtcResult(params: {
    rtcClientId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): Promise<void> {
    const { rtcClientId, success, result, error } = params;
    const rtc = await this.entityRepository.getClientRtc(rtcClientId);
    if (!rtc?.server_id) {
      throw new Error(`RTC not synced yet: ${rtcClientId}`);
    }

    try {
      // 1. Update local execution status
      const now = nowRFC3339();
      await this.entityRepository.upsertRtc(
        {
          client_id: rtcClientId,
          status: success ? 'completed' : 'failed',
          result,
          error_message: error,
          completed_at: now,
          updated_at: now,
        },
        'pending',
        { silent: true }
      );

      // 2. Single submission attempt
      // Check and truncate large data to stay within the Centrifuge message size limit (default 64KB).
      // Lower threshold to 32KB to leave headroom for message headers and serialization overhead.
      const MAX_RESULT_SIZE = 32000; // 32KB safe threshold
      let resultToSend = result;
      let truncated = false;

      try {
        const resultStr = JSON.stringify(result);
        if (resultStr.length > MAX_RESULT_SIZE) {
          log.warn('result too large:', resultStr.length, 'bytes, truncating to', MAX_RESULT_SIZE, 'bytes');
          truncated = true;
          // Truncation strategy: keep head and tail, omit middle
          const keepStart = Math.floor(MAX_RESULT_SIZE * 0.8);
          const keepEnd = Math.floor(MAX_RESULT_SIZE * 0.2);
          const truncatedStr = resultStr.substring(0, keepStart) +
            '\n\n... [TRUNCATED: original size ' + resultStr.length + ' bytes] ...\n\n' +
            resultStr.substring(resultStr.length - keepEnd);
          // Try parsing back to object; on failure keep as string
          try {
            resultToSend = JSON.parse(truncatedStr);
          } catch {
            resultToSend = truncatedStr;
          }
        }
      } catch (err) {
        log.warn('failed to check result size:', err);
      }

      const response = await this.client.submitRtcResult(
        rtc.server_id,
        success,
        resultToSend,
        truncated ? '[Result truncated due to size limit. Full result stored locally.]' : error
      );

      await this._applyResponseUpdates(response);

      // Success: mark as synced
      await this.entityRepository.upsertRtc({ client_id: rtcClientId }, 'synced');
    } catch (err) {
      // Any error (local write or RPC): mark as failed, next getNextRtcToProcess will retry
      log.error('submitRtcResult failed:', err);
      await this.entityRepository.upsertRtc({ client_id: rtcClientId }, 'failed');
      throw err;
    }
  }

  /**
   * Fork a conversation: create a new session based on an old one, replacing the specified
   * message and triggering the AI flow.
   *
   * Flow:
   * 1. Locally create a new session (inherits old session title)
   * 2. Locally create a new message (replaces the old message)
   * 3. Return immediately
   * 4. Background sync to server (server copies historical messages)
   */
  async forkSession(params: {
    oldSessionClientId: string;   // client_id of the old session
    oldMessageClientId: string;   // client_id of the message to replace
    newSessionClientId: string;   // client_id for the new session
    newMessageClientId: string;   // client_id for the new message
    content: ContentData;         // New content
    limit?: number;               // How many historical messages to fork
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const { oldSessionClientId, oldMessageClientId, newSessionClientId, newMessageClientId, content, limit } = params;

    // 1. Look up old session
    const oldSession = await this.entityRepository.getClientSession(oldSessionClientId);
    if (!oldSession) {
      throw new Error(`Old session not found: ${oldSessionClientId}`);
    }
    if (!oldSession.server_id) {
      throw new Error(`Old session not synced yet: ${oldSessionClientId}`);
    }

    // 2. Look up old message
    const oldMessage = await this.entityRepository.getClientMessage(oldMessageClientId);
    if (!oldMessage) {
      throw new Error(`Old message not found: ${oldMessageClientId}`);
    }
    if (!oldMessage.server_id) {
      throw new Error(`Old message not synced yet: ${oldMessageClientId}`);
    }

    // 3. Locally create new session (inherits old session title)
    const now = nowRFC3339();
    const sessionResult = await this.entityRepository.upsertSession(
      {
        client_id: newSessionClientId,
        title: oldSession.title,
        status: 'active',
      },
      'pending',
      { silent: true }
    );
    const newSession = sessionResult.after;

    // 4. Locally create new message
    const msgResult = await this.entityRepository.upsertMessage(
      {
        client_id: newMessageClientId,
        session_client_id: newSession.client_id,
        role: 'user',
        content: JSON.stringify(content),
        streaming_status: 'completed',
        created_at: now,
        updated_at: now,
      },
      'pending',
      { silent: true }
    );
    const newMessage = msgResult.after;

    // 5. Return immediately
    // 6. Background sync — P2-006 fix: tracked in SyncTaskTracker with lifecycle guard
    // P1-R5-02: pass closeSignal so task is aborted when lifecycle closes
    const forkTask = new TrackedBackgroundTask(this._syncTaskTracker, this._lifecycleGuard, this._closeSignal);
    forkTask.run(`fork-session-${newSession.client_id}`, async (_signal) => {
      await this._syncForkToServer({
        oldSession,
        oldMessage,
        newSession,
        newMessage,
        content,
        limit,
      });
    }, { retries: 2, baseDelay: 1000 }).catch(err => {
      log.error('_syncForkToServer task failed:', err);
    });

    return { session: newSession, message: newMessage };
  }

  /**
   * Background sync: send ForkSession to server.
   */
  private async _syncForkToServer(params: {
    oldSession: LocalSession;
    oldMessage: LocalMessage;
    newSession: LocalSession;
    newMessage: LocalMessage;
    content: ContentData;
    limit?: number;
  }): Promise<void> {
    const { oldSession, oldMessage, newSession, newMessage, content, limit } = params;

    // 1. Build request
    const req: ForkSessionRequest = {
      old_server_session_id: oldSession.server_id!,
      old_server_message_id: oldMessage.server_id!,
      new_client_session_id: newSession.client_id,
      new_client_message_id: newMessage.client_id,
      content_data: content,
      limit,
    };

    try {
      // 2. Call RPC
      const response = await this.client.forkSession(req);

      // 3. On success: apply server-returned updates + DB writes
      // P2-006 fix: use _lifecycleGuard.run for all DB operations
      await this._lifecycleGuard.run(async () => {
        await this._applyResponseUpdates(response);
      });

      await this._lifecycleGuard.run(async () => {
        await this.entityRepository.upsertSession(
          {
            client_id: newSession.client_id,
            server_id: response.result.session_id,
          },
          'synced'
        );
      });

      const newMessageServerId = response.result.message_ids?.[response.result.message_ids.length - 1];
      if (newMessageServerId) {
        await this._lifecycleGuard.run(async () => {
          await this.entityRepository.upsertMessage(
            {
              client_id: newMessage.client_id,
              server_id: newMessageServerId,
            },
            'synced'
          );
        });
      }
    } catch (err) {
      // 4. On failure
      log.error('_syncForkToServer RPC failed:', err);

      // P2-006 fix: use _lifecycleGuard.run for all DB operations
      await this._lifecycleGuard.run(async () => {
        await this.entityRepository.upsertMessage(
          { client_id: newMessage.client_id },
          'failed'
        );
      });

      await this._lifecycleGuard.run(async () => {
        await this.entityRepository.upsertSession(
          { client_id: newSession.client_id },
          'failed'
        );
      });
    }
  }
}

/**
 * Create a persistence layer instance.
 */
export function createPersistenceLayer(config: PersistenceConfig): PersistenceLayer {
  // Initialize database
  getDatabase(config.databaseName);
  return new PersistenceLayer(config);
}
