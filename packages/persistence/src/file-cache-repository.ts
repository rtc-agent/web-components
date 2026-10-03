// File Cache Repository — IndexedDB file cache management

import { getDatabase, type FileCacheEntry } from './database.js';
import { createLogger } from '@rtc-agent/client';
import SparkMD5 from 'spark-md5';
import { LifecycleGuard, LifecycleClosedError } from './lifecycle-guard.js';
import { ResourceScope } from './resource-scope.js';

const log = createLogger('FileCacheRepository');

/** Default TTL: 7 days */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum retry attempts for sync operations */
const MAX_RETRY_COUNT = 3;

/** P2-NEW-5: Default timeout for withSyncLock (5 minutes) */
export const SYNC_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** File sync status lifecycle: pending -> syncing -> synced | failed */
export type FileSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/**
 * Cached file information — 所有层（PersistenceLayer、WorkerCore、WorkerBridge）统一使用此类型
 *
 * 包含文件数据（blob）和元数据（content type、同步状态、时间戳、错误信息、重试次数、文件名）。
 */
export interface CachedFileInfo {
  blob: Blob;
  contentType: string;
  syncStatus: FileSyncStatus;
  createdAt: number;
  syncedAt?: number;
  errorMessage?: string;
  retryCount: number;
  /** Original filename (if stored) */
  filename?: string;
}

/**
 * Cache statistics: aggregated file count and size by sync status.
 */
export interface CacheStats {
  totalFiles: number;
  totalSize: number;  // bytes
  byStatus: {
    pending: { count: number; size: number };
    syncing: { count: number; size: number };
    synced: { count: number; size: number };
    failed: { count: number; size: number };
  };
}

/**
 * Calculate retry delay with exponential backoff.
 *
 * Delays: 1s, 2s, 4s (for attempts 0, 1, 2)
 *
 * @param retryCount Current retry attempt (0-based)
 * @returns Delay in milliseconds
 */
function getRetryDelay(retryCount: number): number {
  return Math.pow(2, retryCount) * 1000;
}

/**
 * File Cache Repository
 *
 * Manages IndexedDB file cache for S3 downloaded files.
 * Features:
 * - TTL-based expiration (default 7 days)
 * - Concurrent download deduplication
 * - Lazy expiration cleanup
 * - Offline-first sync status tracking (pending/syncing/synced/failed)
 * - Sync deduplication (prevents duplicate uploads)
 * - Eviction protection for pending/failed files (prevents data loss)
 */
export class FileCacheRepository {
  /** In-flight download deduplication map */
  private inFlightDownloads = new Map<string, Promise<Blob>>();
  /** In-flight sync deduplication map (prevents duplicate uploads) */
  private syncInFlight = new Map<string, Promise<void>>();
  /** Per-file sync lock chains (ensures sequential sync per file) */
  private _syncLocks = new Map<string, Promise<unknown>>();
  /** Lifecycle guard: prevents DB operations after PersistenceLayer.close() */
  private _lifecycleGuard = new LifecycleGuard('FileCacheRepository');

  /**
   * Cache a downloaded file.
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param data File content as Blob
   * @param contentType MIME type
   * @param ttlMs Time-to-live in milliseconds (default: 7 days)
   */
  async put(
    md5: string,
    ext: string,
    data: Blob,
    contentType: string,
    ttlMs: number = DEFAULT_TTL_MS
  ): Promise<void> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const db = getDatabase();
    const now = Date.now();
    const entry: FileCacheEntry = {
      md5,
      ext,
      data,
      contentType,
      size: data.size,
      expiresAt: now + ttlMs,
      lastAccessedAt: now,
      createdAt: now,
      syncStatus: 'synced',
      retryCount: 0,
    };

    await db.fileCache.put(entry);
    log.debug(`cached file: ${md5}.${ext}, size=${data.size}, ttl=${ttlMs}ms`);
  }

  /**
   * Get a cached file.
   *
   * Returns null if not found or expired.
   * Updates lastAccessedAt on hit.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  async get(md5: string, ext: string): Promise<CachedFileInfo | null> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const db = getDatabase();
    const entry = await db.fileCache.get([md5, ext]);

    if (!entry) {
      return null;
    }

    // Check expiration (but never evict pending/failed files to prevent data loss)
    if (entry.expiresAt < Date.now() && entry.syncStatus === 'synced') {
      log.debug(`cache expired: ${md5}.${ext}`);
      await db.fileCache.delete([md5, ext]);
      return null;
    }

    // Update lastAccessedAt
    await db.fileCache.update([md5, ext], { lastAccessedAt: Date.now() });

    return {
      blob: entry.data,
      contentType: entry.contentType,
      syncStatus: entry.syncStatus,
      createdAt: entry.createdAt,
      syncedAt: entry.syncedAt,
      errorMessage: entry.errorMessage,
      retryCount: entry.retryCount,
      filename: entry.filename,  // P3-004 fix: include filename from cache
    };
  }

  /**
   * Evict all expired cache entries.
   *
   * Only evicts entries with syncStatus='synced' to prevent data loss.
   * Pending and failed files are preserved until they are successfully synced.
   *
   * @returns Number of entries evicted
   */
  async evictExpired(): Promise<number> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const db = getDatabase();
    const now = Date.now();

    // Only evict expired entries that are already synced to S3
    // Pending/failed files must be preserved to prevent data loss
    const expired = await db.fileCache
      .where('expiresAt')
      .below(now)
      .filter(entry => entry.syncStatus === 'synced')
      .toArray();

    if (expired.length === 0) {
      return 0;
    }

    // Delete expired synced entries
    const keys = expired.map(e => [e.md5, e.ext] as [string, string]);
    await db.fileCache.bulkDelete(keys);

    log.info(`evicted ${expired.length} expired synced cache entries`);
    return expired.length;
  }

  /**
   * Delete a file cache entry.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  async delete(md5: string, ext: string): Promise<void> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const db = getDatabase();
    await db.fileCache.delete([md5, ext]);
    log.info(`deleted file cache entry: ${md5}.${ext}`);
  }

  /**
   * Clear all cached files.
   */
  async clear(): Promise<void> {
    const db = getDatabase();
    await db.fileCache.clear();
    log.info('cleared all file cache');
  }

  /**
   * Download a file with deduplication.
   *
   * If multiple callers request the same file simultaneously,
   * only one download is performed and the result is shared.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param downloadFn Function to perform the actual download
   */
  async downloadWithDedup(
    md5: string,
    ext: string,
    downloadFn: () => Promise<Blob>
  ): Promise<Blob> {
    const key = `${md5}.${ext}`;

    // Check if already in-flight
    const inFlight = this.inFlightDownloads.get(key);
    if (inFlight) {
      log.debug(`deduplicating download: ${key}`);
      return inFlight;
    }

    // Start download
    const downloadPromise = downloadFn().finally(() => {
      this.inFlightDownloads.delete(key);
    });

    this.inFlightDownloads.set(key, downloadPromise);
    return downloadPromise;
  }

  /**
   * Calculate MD5 hash of a Blob.
   *
   * Runs in the Worker thread to avoid blocking the main thread.
   *
   * @param blob Blob to calculate MD5 for
   * @returns Promise resolving to 32-character hex MD5 hash
   */
  async calculateMD5(blob: Blob): Promise<string> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const buffer = await blob.arrayBuffer();
    return SparkMD5.ArrayBuffer.hash(buffer);
  }

  // ========== Offline-first sync methods ==========

  /**
   * Write file cache with explicit sync status.
   *
   * Used for offline-first uploads: file is written locally with syncStatus='pending',
   * then synced to S3 asynchronously.
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param data File content as Blob
   * @param contentType MIME type
   * @param syncStatus Initial sync status
   * @param filename Original filename (optional, for UI display)
   * @param ttlMs Time-to-live in milliseconds (default: 7 days)
   */
  async putWithSyncStatus(
    md5: string,
    ext: string,
    data: Blob,
    contentType: string,
    syncStatus: 'pending' | 'syncing' | 'synced' | 'failed',
    filename?: string,
    ttlMs: number = DEFAULT_TTL_MS
  ): Promise<void> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const db = getDatabase();
    const now = Date.now();

    const entry: FileCacheEntry = {
      md5,
      ext,
      data,
      contentType,
      size: data.size,
      expiresAt: now + ttlMs,
      lastAccessedAt: now,
      createdAt: now,
      syncStatus,
      filename,
      retryCount: 0,
    };

    await db.fileCache.put(entry);
    log.debug(`cached file with sync status: ${md5}.${ext}, status=${syncStatus}, filename=${filename ?? 'n/a'}`);
  }

  /**
   * Update the sync status of a cached file.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param status New sync status
   * @param errorMessage Error message (when status='failed')
   */
  async updateSyncStatus(
    md5: string,
    ext: string,
    status: 'pending' | 'syncing' | 'synced' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const db = getDatabase();
    const entry = await db.fileCache.get([md5, ext]);

    if (!entry) {
      throw new Error(`File cache entry not found: ${md5}.${ext}`);
    }

    const updates: Partial<FileCacheEntry> = {
      syncStatus: status,
    };

    if (status === 'synced') {
      updates.syncedAt = Date.now();
      updates.errorMessage = undefined;
    } else if (status === 'failed') {
      updates.errorMessage = errorMessage;
      updates.retryCount = (entry.retryCount || 0) + 1;
    }

    await db.fileCache.update([md5, ext], updates);
    log.debug(`updated sync status: ${md5}.${ext} -> ${status}`);
  }

  /**
   * Atomic state transition with precondition check.
   *
   * Uses Dexie's `.modify()` inside a readwrite transaction to ensure
   * the current syncStatus matches one of the allowed `from` states
   * before applying the transition. This prevents race conditions where
   * multiple callers attempt conflicting state changes.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param from Allowed precondition state(s)
   * @param to Target state
   * @param metadata Optional metadata (errorMessage for 'failed', syncedAt for 'synced')
   * @returns true if transition succeeded, false if precondition not met or entry not found
   */
  async transitionSyncStatus(
    md5: string,
    ext: string,
    from: FileSyncStatus | FileSyncStatus[],
    to: FileSyncStatus,
    metadata?: { errorMessage?: string; syncedAt?: number }
  ): Promise<boolean> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const db = getDatabase();
    const fromSet = new Set(Array.isArray(from) ? from : [from]);
    const key = [md5, ext];

    let transitioned = false;
    await db.fileCache.where('[md5+ext]').equals(key).modify(entry => {
      if (!fromSet.has(entry.syncStatus as FileSyncStatus)) {
        log.debug(
          `transitionSyncStatus: skipped ${md5}.${ext}, ` +
          `current=${entry.syncStatus}, expected one of [${[...fromSet].join(',')}], target=${to}`
        );
        return;
      }
      entry.syncStatus = to;
      if (to === 'synced') {
        entry.syncedAt = metadata?.syncedAt ?? Date.now();
        entry.errorMessage = undefined;
      } else if (to === 'failed') {
        entry.errorMessage = metadata?.errorMessage;
        entry.retryCount = (entry.retryCount || 0) + 1;
      }
      transitioned = true;
    });

    if (transitioned) {
      log.debug(`transitionSyncStatus: ${md5}.${ext} -> ${to} (from [${[...fromSet].join(',')}])`);
    }
    return transitioned;
  }

  /**
   * Recover stale 'syncing' entries by downgrading them to 'pending'.
   *
   * Called during startup to handle files that were left in 'syncing' state
   * due to abnormal termination (browser crash, tab close, network disconnect).
   * These entries would otherwise be stuck forever since 'syncing' has no
   * automatic recovery mechanism.
   *
   * @returns Number of entries recovered
   */
  async recoverStaleSyncing(): Promise<number> {
    this._lifecycleGuard.assertActive();  // P1-A: guard check
    const db = getDatabase();
    const staleEntries = await db.fileCache
      .where('syncStatus')
      .equals('syncing')
      .toArray();

    if (staleEntries.length === 0) {
      log.debug('recoverStaleSyncing: no stale syncing entries found');
      return 0;
    }

    const keys = staleEntries.map(e => [e.md5, e.ext] as [string, string]);
    await db.fileCache.where('[md5+ext]').anyOf(keys).modify({
      syncStatus: 'pending',
    });

    log.info(`recovered ${staleEntries.length} stale syncing entries -> pending`);
    return staleEntries.length;
  }

  /**
   * Per-file sync lock: ensures only one sync operation runs at a time per file.
   *
   * Uses promise chaining (not mutex) so operations queue sequentially.
   * Each call for the same key waits for the previous operation to settle
   * before starting its own. Different files run in parallel.
   *
   * P2-NEW-5 fix: Added optional timeoutMs parameter. If the operation takes longer
   * than the timeout, it will be rejected with an error. Default: 5 minutes.
   *
   * P1-B fix: Added AbortSignal support. The fn callback receives an AbortSignal
   * that is aborted on timeout or external cancellation. This allows the underlying
   * operation to stop gracefully instead of continuing after the caller has moved on.
   *
   * P1-NEW-A fix: Use ResourceScope to manage timer lifecycle, ensuring cleanup
   * whether the operation succeeds, fails, or times out.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param fn Async function to execute under the lock. Receives an AbortSignal.
   * @param timeoutMs Optional timeout in milliseconds (default: SYNC_LOCK_TIMEOUT_MS)
   * @param externalSignal Optional external AbortSignal for cancellation
   */
  async withSyncLock<T>(
    md5: string,
    ext: string,
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number = SYNC_LOCK_TIMEOUT_MS,
    externalSignal?: AbortSignal
  ): Promise<T> {
    const key = `${md5}.${ext}`;
    const prev = this._syncLocks.get(key) ?? Promise.resolve();

    // Create internal AbortController, merge with external signal
    const controller = new AbortController();

    // P1-NEW-A: Use ResourceScope to manage timer and listener lifecycle
    const scope = new ResourceScope();

    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    const fnWithTimeout = (): Promise<T> => {
      return Promise.race([
        fn(controller.signal),  // Pass signal to fn
        new Promise<never>((_, reject) => {
          // P1-NEW-A: Use scope.setTimeout for automatic cleanup
          scope.setTimeout(() => {
            const err = new Error(`withSyncLock timed out for ${key} after ${timeoutMs}ms`);
            controller.abort(err);  // P1-B: abort underlying operation on timeout
            reject(err);
          }, timeoutMs);
          // If external signal aborts first, timer will be cleaned up by scope.dispose()
        }),
      ]).finally(() => {
        // P1-NEW-A: Always clean up resources (timer + listeners) after operation completes
        scope.dispose();
      });
    };

    const next = prev.then(
      () => fnWithTimeout(),
      () => fnWithTimeout()
    );

    // Store the chained promise (settled when fn completes or throws)
    const settled = next.then(
      (v) => v,
      (e) => { throw e; }
    );
    this._syncLocks.set(key, settled.finally(() => {
      // Clean up map entry when this is the last operation in the chain
      if (this._syncLocks.get(key) === settled) {
        this._syncLocks.delete(key);
      }
      // Clean up external signal listener
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }));

    return next;
  }

  /**
   * Sync a file with deduplication.
   *
   * If multiple callers try to sync the same file simultaneously,
   * only one sync is performed and the result is shared.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param syncFn Function to perform the actual sync
   */
  async syncWithDedup(
    md5: string,
    ext: string,
    syncFn: () => Promise<void>
  ): Promise<void> {
    const key = `${md5}.${ext}`;
    const existing = this.syncInFlight.get(key);
    if (existing) {
      log.debug(`deduplicating sync: ${key}`);
      return existing;
    }

    const promise = syncFn().finally(() => {
      this.syncInFlight.delete(key);
    });
    this.syncInFlight.set(key, promise);
    return promise;
  }

  /**
   * List files by sync status.
   *
   * @param syncStatus Filter by sync status (optional, lists all if omitted)
   * @param limit Maximum number of entries to return (default: 100)
   * @param offset Number of entries to skip (default: 0)
   */
  async listBySyncStatus(
    syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed',
    limit: number = 100,
    offset: number = 0
  ): Promise<FileCacheEntry[]> {
    const db = getDatabase();
    let collection = db.fileCache.toCollection();

    if (syncStatus) {
      collection = db.fileCache.where('syncStatus').equals(syncStatus);
    }

    return collection.offset(offset).limit(limit).toArray();
  }

  /**
   * Count files by sync status.
   *
   * @param syncStatus Filter by sync status (optional, counts all if omitted)
   */
  async countBySyncStatus(
    syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed'
  ): Promise<number> {
    const db = getDatabase();
    if (syncStatus) {
      return db.fileCache.where('syncStatus').equals(syncStatus).count();
    }
    return db.fileCache.count();
  }

  /**
   * Get cache statistics: total files, total size, and breakdown by sync status.
   *
   * P2-E fix: Uses Dexie's each() for streaming aggregation instead of toArray(),
   * avoiding loading all entries (with their Blob data) into memory at once.
   * Memory footprint: O(1) instead of O(N).
   */
  async getCacheStats(): Promise<CacheStats> {
    const db = getDatabase();

    const stats: CacheStats = {
      totalFiles: 0,
      totalSize: 0,
      byStatus: {
        pending: { count: 0, size: 0 },
        syncing: { count: 0, size: 0 },
        synced: { count: 0, size: 0 },
        failed: { count: 0, size: 0 },
      },
    };

    // P2-E: stream through entries one at a time, no full table load
    await db.fileCache.toCollection().each(entry => {
      const status = entry.syncStatus as FileSyncStatus;
      if (stats.byStatus[status]) {
        stats.byStatus[status].count++;
        stats.byStatus[status].size += entry.size ?? 0;
      } else {
        // P3-R6-01: Log unexpected syncStatus values (possible DB corruption)
        log.warn(`getCacheStats: unexpected syncStatus "${status}" for ${entry.md5}.${entry.ext}`);
      }
      stats.totalFiles++;
      stats.totalSize += entry.size ?? 0;
    });

    return stats;
  }

  /**
   * Update only the blob data and contentType of an existing cache entry.
   *
   * Preserves createdAt, syncStatus, syncedAt, and other metadata fields.
   * Used by downloadFile() to refresh cached data without resetting the original
   * creation timestamp (which would happen if putWithSyncStatus() were used).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param data New file content as Blob
   * @param contentType New MIME type (optional, preserves existing if omitted)
   * @throws Error if the entry does not exist
   */
  async updateBlob(
    md5: string,
    ext: string,
    data: Blob,
    contentType?: string
  ): Promise<void> {
    const db = getDatabase();
    await db.fileCache.where('[md5+ext]').equals([md5, ext]).modify(entry => {
      entry.data = data;
      if (contentType !== undefined) {
        entry.contentType = contentType;
      }
      entry.size = data.size;
      entry.lastAccessedAt = Date.now();
      // Note: createdAt, syncStatus, syncedAt, filename, retryCount, etc. are NOT modified
    });
    log.debug(`updated blob data: ${md5}.${ext}, size=${data.size}, contentType=${contentType ?? 'preserved'}`);
  }

  /**
   * Update the metadata of a cached file (filename, contentType).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param updates Partial metadata to update
   */
  async updateMetadata(
    md5: string,
    ext: string,
    updates: { filename?: string; contentType?: string }
  ): Promise<void> {
    const db = getDatabase();
    const entry = await db.fileCache.get([md5, ext]);
    if (!entry) throw new Error(`File cache entry not found: ${md5}.${ext}`);
    const partial: Partial<FileCacheEntry> = {};
    if (updates.filename !== undefined) partial.filename = updates.filename;
    if (updates.contentType !== undefined) partial.contentType = updates.contentType;
    await db.fileCache.update([md5, ext], partial);
    log.debug(`updated metadata: ${md5}.${ext}`, updates);
  }

  /**
   * Update the retry count of a cached file.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param retryCount New retry count value
   */
  async updateRetryCount(md5: string, ext: string, retryCount: number): Promise<void> {
    const db = getDatabase();
    await db.fileCache.update([md5, ext], { retryCount });
    log.debug(`updated retry count: ${md5}.${ext} -> ${retryCount}`);
  }

  /**
   * LRU cache eviction (only evicts synced files).
   *
   * Evicts the least recently accessed synced files until the target byte count is reached.
   * Pending/failed/syncing files are never evicted to prevent data loss.
   *
   * P2-F fix: Uses cursor-based pagination (BATCH_SIZE per iteration) instead of
   * loading all candidates into memory at once. This avoids loading all synced entries
   * (with their Blob data) for a potentially large table.
   *
   * @param targetBytes Number of bytes to free
   * @returns Actual evicted count and bytes freed
   */
  async evictLRU(targetBytes: number): Promise<{ evictedCount: number; evictedBytes: number }> {
    const db = getDatabase();
    const BATCH_SIZE = 100;
    let evictedBytes = 0;
    let evictedCount = 0;

    // P2-NEW-D: Use composite cursor to handle duplicate lastAccessedAt values
    let lastProcessedTime = 0;
    let lastProcessedKey = '';  // md5 + ext composite

    while (evictedBytes < targetBytes) {
      // P2-F: load one batch at a time, ordered by lastAccessedAt ascending (oldest first)
      // P2-NEW-D: Use composite condition to skip already-processed entries
      const batch = await db.fileCache
        .where('lastAccessedAt')
        .aboveOrEqual(lastProcessedTime)
        .filter(e => {
          // Only include synced files
          if (e.syncStatus !== 'synced') return false;

          // P2-NEW-D: Skip entries we've already processed (same timestamp but earlier in sort order)
          if (e.lastAccessedAt === lastProcessedTime) {
            const key = `${e.md5}.${e.ext}`;
            return key > lastProcessedKey;
          }

          return true;
        })
        .limit(BATCH_SIZE)
        .sortBy('lastAccessedAt');

      if (batch.length === 0) break;

      const keysToDelete: [string, string][] = [];
      for (const entry of batch) {
        if (evictedBytes >= targetBytes) break;
        keysToDelete.push([entry.md5, entry.ext]);
        evictedBytes += entry.size ?? 0;
        evictedCount++;

        // P2-NEW-D: Update composite cursor
        lastProcessedTime = entry.lastAccessedAt;
        lastProcessedKey = `${entry.md5}.${entry.ext}`;
      }

      if (keysToDelete.length > 0) {
        await db.fileCache.bulkDelete(keysToDelete);
      }
    }

    if (evictedCount > 0) {
      log.info(`evictLRU: evicted ${evictedCount} files, freed ${evictedBytes} bytes`);
    }

    return { evictedCount, evictedBytes };
  }

  /**
   * Sync a file with per-file lock and exponential backoff retry.
   *
   * Wraps the entire retry loop with `withSyncLock` so concurrent calls
   * for the same file queue sequentially (each sees the result of the prior).
   *
   * - Attempt 0: immediate
   * - Attempt 1: after 1s delay
   * - Attempt 2: after 2s delay
   * - Attempt 3: after 4s delay (then throws)
   *
   * Updates syncStatus and retryCount on each attempt.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param uploadFn Function to perform the actual upload
   * @throws After MAX_RETRY_COUNT failed attempts
   */
  async syncWithRetry(
    md5: string,
    ext: string,
    uploadFn: () => Promise<void>
  ): Promise<void> {
    // P2-2 fix: wrap entire retry loop with per-file lock so concurrent
    // syncWithRetry calls for the same file queue sequentially instead of
    // each running their own independent retry loop.
    return this.withSyncLock(md5, ext, async (lockSignal) => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRY_COUNT; attempt++) {
        try {
          if (attempt > 0) {
            const delay = getRetryDelay(attempt - 1);
            log.debug(`retry ${attempt}/${MAX_RETRY_COUNT} for ${md5}.${ext} after ${delay}ms`);
            // P2-R5-06: cancellable delay — respects lifecycle close signal
            await this._cancellableDelay(delay, lockSignal);
          }

          await this.updateSyncStatus(md5, ext, 'syncing');
          await uploadFn();
          await this.updateSyncStatus(md5, ext, 'synced');

          log.debug(`sync succeeded for ${md5}.${ext}`);
          return;
        } catch (err) {
          // P1-A: If lifecycle is closed, stop retrying immediately
          if (err instanceof LifecycleClosedError) {
            log.warn(`syncWithRetry: lifecycle closed for ${md5}.${ext}, stopping retry`);
            return;
          }
          lastError = err as Error;
          await this.updateSyncStatus(md5, ext, 'failed', String(err));
          await this.updateRetryCount(md5, ext, attempt + 1);
          log.warn(`sync attempt ${attempt + 1}/${MAX_RETRY_COUNT} failed for ${md5}.${ext} (retryCount=${attempt + 1}):`, err);
        }
      }

      log.error(`sync failed after ${MAX_RETRY_COUNT} retries for ${md5}.${ext} (final retryCount=${MAX_RETRY_COUNT})`, lastError);
      throw lastError!;
    });
  }

  /**
   * P2-R5-06: Cancellable delay — resolves early if signal is aborted.
   *
   * Unlike `setTimeout`, this delay can be interrupted by the signal,
   * allowing graceful shutdown instead of waiting the full duration.
   */
  private _cancellableDelay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        resolve(); // Resolve instead of reject for graceful shutdown
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Close the lifecycle guard.
   *
   * Called by PersistenceLayer.close() to prevent further DB operations.
   * After this, all DB operations will throw LifecycleClosedError.
   */
  closeLifecycleGuard(): void {
    this._lifecycleGuard.close();
  }

  /**
   * Reset the lifecycle guard (for testing/re-initialization).
   *
   * Allows DB operations again after a previous close().
   * Should only be used in test scenarios where singletons are reused.
   */
  resetLifecycleGuard(): void {
    this._lifecycleGuard = new LifecycleGuard('FileCacheRepository');
  }
}

// ========== Singleton ==========

let fileCacheRepositoryInstance: FileCacheRepository | null = null;

/**
 * Initialize the FileCacheRepository singleton.
 */
export function initFileCacheRepository(): FileCacheRepository {
  if (!fileCacheRepositoryInstance) {
    fileCacheRepositoryInstance = new FileCacheRepository();
    log.info('FileCacheRepository initialized');
  }
  return fileCacheRepositoryInstance;
}

/**
 * Get the FileCacheRepository singleton.
 */
export function getFileCacheRepository(): FileCacheRepository {
  if (!fileCacheRepositoryInstance) {
    throw new Error(
      '[FileCacheRepository] not initialized. Call initFileCacheRepository() first.'
    );
  }
  return fileCacheRepositoryInstance;
}
