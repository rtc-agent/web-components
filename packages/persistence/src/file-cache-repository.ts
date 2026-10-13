// File Cache Repository — IndexedDB file cache management

import { getDatabase, type FileCacheEntry } from './database.js';
import { createLogger, FileSyncStatus } from '@rtc-agent/protocol';
import SparkMD5 from 'spark-md5';
import { LifecycleGuard, LifecycleClosedError } from './lifecycle-guard.js';
import { ResourceScope } from './resource-scope.js';

const log = createLogger('FileCacheRepository');

/** Default TTL: 7 days */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** P3-FIX: Extended TTL for pending/failed files: 30 days (prevents premature cleanup of unsynced data) */
const PENDING_FAILED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Maximum retry attempts for sync operations */
const MAX_RETRY_COUNT = 3;

/** P2-NEW-5: Default timeout for withSyncLock (5 minutes) */
export const SYNC_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** P0-FIX: Stale syncing threshold - entries stuck in 'syncing' for more than 5 minutes are considered stale */
export const STALE_SYNCING_THRESHOLD_MS = 5 * 60 * 1000;

// FileSyncStatus is imported from @rtc-agent/protocol
// Re-export for backward compatibility
export { FileSyncStatus } from '@rtc-agent/protocol';

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
  totalSize: number; // bytes
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
  /** P1-FIX: Track Promise chain lengths for monitoring potential memory leaks */
  private _syncLockChainLengths = new Map<string, number>();
  /** Lifecycle guard: prevents DB operations after PersistenceLayer.close() */
  private _lifecycleGuard = new LifecycleGuard('FileCacheRepository');
  /** H3-FIX: Lock to prevent concurrent recoverStaleSyncing calls */
  private _recoverStaleSyncingPromise: Promise<number> | null = null;

  /**
   * MD5 Worker pool for reusing worker instances.
   * PERFORMANCE: Creating a new Worker for each MD5 calculation is expensive (~10-50ms).
   * This pool maintains up to 4 workers to handle concurrent MD5 calculations.
   * Workers are created lazily and reused across calculations.
   */
  private static _md5WorkerPool: Worker[] = [];
  private static _md5WorkerBusy = new Set<Worker>();
  private static readonly MAX_MD5_WORKERS = 4;

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
    ttlMs: number = DEFAULT_TTL_MS,
  ): Promise<void> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check
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
   * P3-FIX: Race condition note — There's a theoretical window between the expiry check
   * and the return where the entry could expire. However, this is acceptable because:
   * 1. The TTL is conservative (7 days for synced, 30 days for pending/failed)
   * 2. The entry is still valid at the time of check
   * 3. Subsequent calls will see the expired entry and clean it up
   * 4. The alternative (holding a lock during the entire operation) would hurt performance
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  async get(md5: string, ext: string): Promise<CachedFileInfo | null> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check
    const db = getDatabase();
    const entry = await db.fileCache.get([md5, ext]);

    if (!entry) {
      return null;
    }

    // Check expiration (but never evict pending/failed files to prevent data loss)
    // P3-FIX: pending/failed files use extended TTL (30 days) to prevent premature cleanup
    const now = Date.now();
    const isExpired = entry.expiresAt < now;
    const isPendingOrFailed =
      entry.syncStatus === 'pending' || entry.syncStatus === 'failed';

    if (isExpired && entry.syncStatus === 'synced') {
      log.debug(`cache expired: ${md5}.${ext}`);
      await db.fileCache.delete([md5, ext]);
      return null;
    }

    // P3-FIX: For pending/failed files, check if they've exceeded the extended TTL
    // This prevents abandoned pending/failed files from accumulating indefinitely
    if (isExpired && isPendingOrFailed) {
      // Check if this is a pending/failed file with extended TTL
      // If it was created with the standard TTL, it should have been upgraded to extended TTL
      // For safety, we use the extended TTL check here
      const extendedExpiry = entry.createdAt + PENDING_FAILED_TTL_MS;
      if (now > extendedExpiry) {
        log.debug(
          `cache expired (pending/failed, exceeded 30-day TTL): ${md5}.${ext}`,
        );
        await db.fileCache.delete([md5, ext]);
        return null;
      }
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
      filename: entry.filename, // P3-004 fix: include filename from cache
    };
  }

  /**
   * Evict all expired cache entries.
   *
   * P3-FIX: Now evicts both synced files (standard TTL) and pending/failed files
   * that have exceeded the extended TTL (30 days). This prevents abandoned
   * pending/failed files from accumulating indefinitely while still protecting
   * recently failed files that might be retried.
   *
   * @returns Number of entries evicted
   */
  async evictExpired(): Promise<number> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check
    const db = getDatabase();
    const now = Date.now();

    // P3-FIX: Evict expired synced entries (standard TTL check)
    const expiredSynced = await db.fileCache
      .where('expiresAt')
      .below(now)
      .filter((entry) => entry.syncStatus === 'synced')
      .toArray();

    // P3-FIX: Evict pending/failed entries that exceed the extended TTL (30 days)
    // This prevents abandoned files from accumulating indefinitely
    const expiredPendingFailed = await db.fileCache
      .where('expiresAt')
      .below(now)
      .filter((entry) => {
        const isPendingOrFailed =
          entry.syncStatus === 'pending' || entry.syncStatus === 'failed';
        if (!isPendingOrFailed) return false;

        // Check if this entry has exceeded the extended TTL from creation time
        const extendedExpiry = entry.createdAt + PENDING_FAILED_TTL_MS;
        return now > extendedExpiry;
      })
      .toArray();

    const allExpired = [...expiredSynced, ...expiredPendingFailed];

    if (allExpired.length === 0) {
      return 0;
    }

    // Delete all expired entries
    const keys = allExpired.map((e) => [e.md5, e.ext] as [string, string]);
    await db.fileCache.bulkDelete(keys);

    log.info(
      `evicted ${allExpired.length} expired cache entries (${expiredSynced.length} synced, ${expiredPendingFailed.length} pending/failed)`,
    );
    return allExpired.length;
  }

  /**
   * Delete a file cache entry.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  async delete(md5: string, ext: string): Promise<void> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check
    const db = getDatabase();
    await db.fileCache.delete([md5, ext]);
    log.info(`deleted file cache entry: ${md5}.${ext}`);
  }

  /**
   * Clear all cached files.
   */
  async clear(): Promise<void> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check
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
    downloadFn: () => Promise<Blob>,
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
   * Uses Web Worker to avoid blocking the main thread for large files.
   * Falls back to synchronous computation if Web Workers are unavailable.
   *
   * @param blob Blob to calculate MD5 for
   * @returns Promise resolving to 32-character hex MD5 hash
   */
  async calculateMD5(blob: Blob): Promise<string> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check

    // Try using Web Worker to avoid blocking main thread
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      try {
        return await this._calculateMD5InWorker(blob);
      } catch (err) {
        // Fallback to synchronous computation if worker fails
        log.warn('MD5 worker failed, falling back to main thread:', err);
      }
    }

    // Fallback: synchronous computation on main thread
    const buffer = await blob.arrayBuffer();
    return SparkMD5.ArrayBuffer.hash(buffer);
  }

  /**
   * Calculate MD5 in a Web Worker to avoid blocking the main thread.
   *
   * Uses a worker pool to reuse existing workers instead of creating new ones.
   * This prevents main thread blocking for large files (>1MB) and reduces
   * worker creation overhead (~10-50ms per worker).
   * Worker computation has a 30-second timeout to prevent indefinite hangs.
   *
   * @param blob Blob to calculate MD5 for
   * @returns Promise resolving to 32-character hex MD5 hash
   * @throws Error if worker computation fails or times out
   */
  private async _calculateMD5InWorker(blob: Blob): Promise<string> {
    // Get or create a worker from the pool
    let worker = FileCacheRepository._md5WorkerPool.find(
      (w) => !FileCacheRepository._md5WorkerBusy.has(w),
    );

    if (!worker) {
      // Create a new worker if pool is not full
      if (FileCacheRepository._md5WorkerPool.length < FileCacheRepository.MAX_MD5_WORKERS) {
        worker = FileCacheRepository._createMD5Worker();
        FileCacheRepository._md5WorkerPool.push(worker);
      } else {
        // All workers are busy, wait for one to become available
        // Use a simple polling approach with exponential backoff
        const maxWait = 5000; // 5 seconds max wait
        const startTime = Date.now();
        let waitTime = 50;

        while (Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          worker = FileCacheRepository._md5WorkerPool.find(
            (w) => !FileCacheRepository._md5WorkerBusy.has(w),
          );
          if (worker) break;
          waitTime = Math.min(waitTime * 2, 500); // Exponential backoff, max 500ms
        }

        if (!worker) {
          throw new Error('MD5 worker pool exhausted (all workers busy for 5s)');
        }
      }
    }

    // Mark worker as busy
    FileCacheRepository._md5WorkerBusy.add(worker);

    try {
      // Send blob to worker and wait for result with timeout
      const result = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('MD5 calculation timed out (30s)'));
        }, 30000);

        const onMessage = (e: MessageEvent) => {
          clearTimeout(timeout);
          worker!.removeEventListener('message', onMessage);
          worker!.removeEventListener('error', onError);

          if (e.data.success) {
            resolve(e.data.hash);
          } else {
            reject(new Error(e.data.error));
          }
        };

        const onError = (err: ErrorEvent) => {
          clearTimeout(timeout);
          worker!.removeEventListener('message', onMessage);
          worker!.removeEventListener('error', onError);
          reject(new Error(`Worker error: ${err.message || 'Unknown error'}`));
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);

        // Send blob to worker (blob is cloned, not transferred, for safety)
        worker.postMessage({ blob });
      });

      return result;
    } finally {
      // Mark worker as available (don't terminate, keep in pool)
      FileCacheRepository._md5WorkerBusy.delete(worker);
    }
  }

  /**
   * Create a new MD5 worker that loads SparkMD5 from CDN.
   * Using CDN keeps bundle size small while maintaining reliability.
   */
  private static _createMD5Worker(): Worker {
    const workerScript = `
      importScripts('https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js');

      self.onmessage = async (e) => {
        try {
          const { blob } = e.data;
          const buffer = await blob.arrayBuffer();
          const hash = self.SparkMD5.ArrayBuffer.hash(buffer);
          self.postMessage({ success: true, hash });
        } catch (err) {
          self.postMessage({ success: false, error: err.message || String(err) });
        }
      };
    `;

    const workerBlob = new Blob([workerScript], {
      type: 'application/javascript',
    });
    const workerUrl = URL.createObjectURL(workerBlob);
    return new Worker(workerUrl);
  }

  // ========== Offline-first sync methods ==========

  /**
   * Write file cache with explicit sync status.
   *
   * Used for offline-first uploads: file is written locally with syncStatus='pending',
   * then synced to S3 asynchronously.
   *
   * P3-FIX: pending/failed files now use extended TTL (30 days) to prevent premature cleanup.
   * This ensures that files waiting for sync are not evicted before they can be synced.
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param data File content as Blob
   * @param contentType MIME type
   * @param syncStatus Initial sync status
   * @param filename Original filename (optional, for UI display)
   * @param ttlMs Time-to-live in milliseconds (default: 7 days for synced, 30 days for pending/failed)
   */
  async putWithSyncStatus(
    md5: string,
    ext: string,
    data: Blob,
    contentType: string,
    syncStatus: 'pending' | 'syncing' | 'synced' | 'failed',
    filename?: string,
    ttlMs: number = DEFAULT_TTL_MS,
  ): Promise<void> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check
    const db = getDatabase();
    const now = Date.now();

    // P3-FIX: Use extended TTL for pending/failed files to prevent premature cleanup
    // This ensures that files waiting for sync are not evicted before they can be synced
    const effectiveTtl =
      (syncStatus === 'pending' || syncStatus === 'failed') &&
      ttlMs === DEFAULT_TTL_MS
        ? PENDING_FAILED_TTL_MS
        : ttlMs;

    const entry: FileCacheEntry = {
      md5,
      ext,
      data,
      contentType,
      size: data.size,
      expiresAt: now + effectiveTtl,
      lastAccessedAt: now,
      createdAt: now,
      syncStatus,
      filename,
      retryCount: 0,
    };

    await db.fileCache.put(entry);
    log.debug(
      `cached file with sync status: ${md5}.${ext}, status=${syncStatus}, filename=${filename ?? 'n/a'}, ttl=${effectiveTtl}ms`,
    );
  }

  /**
   * Update the sync status of a cached file.
   *
   * Uses atomic `modify()` (not read-then-write) to prevent race conditions
   * where concurrent operations could overwrite each other's changes.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param status New sync status
   * @param errorMessage Error message (when status='failed')
   * @throws Error if the entry does not exist
   */
  async updateSyncStatus(
    md5: string,
    ext: string,
    status: 'pending' | 'syncing' | 'synced' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check
    const db = getDatabase();
    const key = [md5, ext];

    let found = false;
    await db.fileCache
      .where('[md5+ext]')
      .equals(key)
      .modify((entry) => {
        found = true;
        entry.syncStatus = status;

        if (status === 'synced') {
          entry.syncedAt = Date.now();
          entry.errorMessage = undefined;
        } else if (status === 'failed') {
          entry.errorMessage = errorMessage;
          entry.retryCount = (entry.retryCount || 0) + 1;
        }
      });

    if (!found) {
      throw new Error(`File cache entry not found: ${md5}.${ext}`);
    }

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
    metadata?: { errorMessage?: string; syncedAt?: number },
  ): Promise<boolean> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check
    const db = getDatabase();
    const fromSet = new Set(Array.isArray(from) ? from : [from]);
    const key = [md5, ext];

    let transitioned = false;
    await db.fileCache
      .where('[md5+ext]')
      .equals(key)
      .modify((entry) => {
        if (!fromSet.has(entry.syncStatus as FileSyncStatus)) {
          log.debug(
            `transitionSyncStatus: skipped ${md5}.${ext}, ` +
              `current=${entry.syncStatus}, expected one of [${[...fromSet].join(',')}], target=${to}`,
          );
          return;
        }
        entry.syncStatus = to;
        if (to === 'synced') {
          entry.syncedAt = metadata?.syncedAt ?? Date.now();
          entry.errorMessage = undefined;
          entry.syncingStartedAt = undefined; // P0-FIX: Clear syncing timestamp on success
        } else if (to === 'failed') {
          entry.errorMessage = metadata?.errorMessage;
          entry.retryCount = (entry.retryCount || 0) + 1;
          entry.syncingStartedAt = undefined; // P0-FIX: Clear syncing timestamp on failure
        } else if (to === 'syncing') {
          // P0-FIX: Set syncing timestamp when entering syncing state (heartbeat mechanism)
          entry.syncingStartedAt = Date.now();
        } else if (to === 'pending') {
          entry.syncingStartedAt = undefined; // P0-FIX: Clear syncing timestamp when returning to pending
        }
        transitioned = true;
      });

    if (transitioned) {
      log.debug(
        `transitionSyncStatus: ${md5}.${ext} -> ${to} (from [${[...fromSet].join(',')}])`,
      );
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
   * H3-FIX: Added concurrency control to prevent multiple simultaneous calls
   * from interfering with each other (e.g., during rapid reconnection attempts).
   *
   * @returns Number of entries recovered
   */
  async recoverStaleSyncing(): Promise<number> {
    this._lifecycleGuard.assertActive(); // P1-A: guard check

    // H3-FIX: Deduplicate concurrent calls - return existing promise if one is in flight
    if (this._recoverStaleSyncingPromise) {
      log.debug('recoverStaleSyncing: already in progress, returning existing promise');
      return this._recoverStaleSyncingPromise;
    }

    // Create and store the promise for deduplication
    this._recoverStaleSyncingPromise = this._recoverStaleSyncingInternal();

    try {
      const result = await this._recoverStaleSyncingPromise;
      return result;
    } finally {
      // Clean up the promise reference after completion
      this._recoverStaleSyncingPromise = null;
    }
  }

  /**
   * Internal implementation of recoverStaleSyncing.
   * Separated to enable concurrency control in the public method.
   *
   * P0-FIX: Now uses syncingStartedAt timestamp to detect stale entries.
   * Only recovers entries that have been in 'syncing' state for more than
   * STALE_SYNCING_THRESHOLD_MS (5 minutes). This prevents recovering entries
   * that are actively being uploaded.
   */
  private async _recoverStaleSyncingInternal(): Promise<number> {
    const db = getDatabase();
    const now = Date.now();
    const threshold = now - STALE_SYNCING_THRESHOLD_MS;

    // Get all syncing entries
    const allSyncingEntries = await db.fileCache
      .where('syncStatus')
      .equals('syncing')
      .toArray();

    if (allSyncingEntries.length === 0) {
      log.debug('recoverStaleSyncing: no syncing entries found');
      return 0;
    }

    // P0-FIX: Filter to only stale entries (syncingStartedAt older than threshold)
    // If syncingStartedAt is missing (legacy entry), treat as stale for safety
    const staleEntries = allSyncingEntries.filter((entry) => {
      const startedAt = entry.syncingStartedAt;
      // If no timestamp, consider it stale (legacy entry or data corruption)
      if (!startedAt) {
        log.warn(
          `recoverStaleSyncing: entry ${entry.md5}.${entry.ext} has no syncingStartedAt, treating as stale`,
        );
        return true;
      }
      return startedAt < threshold;
    });

    if (staleEntries.length === 0) {
      log.debug('recoverStaleSyncing: no stale syncing entries found (all within threshold)');
      return 0;
    }

    const keys = staleEntries.map((e) => [e.md5, e.ext] as [string, string]);
    await db.fileCache.where('[md5+ext]').anyOf(keys).modify({
      syncStatus: 'pending',
      syncingStartedAt: undefined, // P0-FIX: Clear the timestamp when recovering
    });

    log.info(
      `recovered ${staleEntries.length} stale syncing entries -> pending (${allSyncingEntries.length - staleEntries.length} still active)`,
    );
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
    externalSignal?: AbortSignal,
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
        fn(controller.signal), // Pass signal to fn
        new Promise<never>((_, reject) => {
          // P1-NEW-A: Use scope.setTimeout for automatic cleanup
          scope.setTimeout(() => {
            const err = new Error(
              `withSyncLock timed out for ${key} after ${timeoutMs}ms`,
            );
            controller.abort(err); // P1-B: abort underlying operation on timeout
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
      () => fnWithTimeout(),
    );

    // Store the chained promise (settled when fn completes or throws)
    const settled = next.then(
      (v) => v,
      (e) => {
        throw e;
      },
    );

    // C1-FIX: Track chain position to prevent unbounded Promise chain growth.
    // When this is the first operation in the chain (prev was already resolved),
    // we can clean up immediately after completion instead of waiting for the next operation.
    const isFirstInChain = prev === this._syncLocks.get(key);

    // P1-FIX: Monitor Promise chain length to detect potential memory leaks.
    // In high-frequency scenarios, chains can grow unbounded if cleanup fails.
    // Log a warning if chain exceeds threshold for debugging.
    const CHAIN_LENGTH_WARNING_THRESHOLD = 50;
    const currentChainLength = this._syncLockChainLengths.get(key) ?? 0;
    const newChainLength = isFirstInChain ? 1 : currentChainLength + 1;
    this._syncLockChainLengths.set(key, newChainLength);

    if (newChainLength > CHAIN_LENGTH_WARNING_THRESHOLD) {
      log.warn(
        `withSyncLock: Promise chain length for ${key} is ${newChainLength} ` +
        `(threshold: ${CHAIN_LENGTH_WARNING_THRESHOLD}). ` +
        `This may indicate a memory leak if cleanup is not working correctly.`,
      );
    }

    this._syncLocks.set(
      key,
      settled.finally(() => {
        // C1-FIX: Clean up map entry when chain is empty or this is the last operation.
        // If this was the first operation and no new operations queued, remove immediately.
        // Otherwise, only remove if we're still the head of the chain.
        const currentHead = this._syncLocks.get(key);
        if (isFirstInChain || currentHead === settled) {
          // Check if a new operation has queued behind us
          // If settled is still the head, no new operations have queued, safe to delete
          if (currentHead === settled) {
            this._syncLocks.delete(key);
            this._syncLockChainLengths.delete(key); // P1-FIX: Clean up chain length counter
          }
        } else {
          // P1-FIX: Decrement chain length when an operation completes but chain continues
          const currentLength = this._syncLockChainLengths.get(key) ?? 0;
          if (currentLength > 0) {
            this._syncLockChainLengths.set(key, currentLength - 1);
          }
        }
        // Clean up external signal listener
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }),
    );

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
    syncFn: () => Promise<void>,
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
    offset: number = 0,
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
    syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed',
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
    await db.fileCache.toCollection().each((entry) => {
      const status = entry.syncStatus as FileSyncStatus;
      if (stats.byStatus[status]) {
        stats.byStatus[status].count++;
        stats.byStatus[status].size += entry.size ?? 0;
      } else {
        // P3-R6-01: Log unexpected syncStatus values (possible DB corruption)
        log.warn(
          `getCacheStats: unexpected syncStatus "${status}" for ${entry.md5}.${entry.ext}`,
        );
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
    contentType?: string,
  ): Promise<void> {
    const db = getDatabase();
    await db.fileCache
      .where('[md5+ext]')
      .equals([md5, ext])
      .modify((entry) => {
        entry.data = data;
        if (contentType !== undefined) {
          entry.contentType = contentType;
        }
        entry.size = data.size;
        entry.lastAccessedAt = Date.now();
        // Note: createdAt, syncStatus, syncedAt, filename, retryCount, etc. are NOT modified
      });
    log.debug(
      `updated blob data: ${md5}.${ext}, size=${data.size}, contentType=${contentType ?? 'preserved'}`,
    );
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
    updates: { filename?: string; contentType?: string },
  ): Promise<void> {
    const db = getDatabase();
    const entry = await db.fileCache.get([md5, ext]);
    if (!entry) throw new Error(`File cache entry not found: ${md5}.${ext}`);
    const partial: Partial<FileCacheEntry> = {};
    if (updates.filename !== undefined) partial.filename = updates.filename;
    if (updates.contentType !== undefined)
      partial.contentType = updates.contentType;
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
  async updateRetryCount(
    md5: string,
    ext: string,
    retryCount: number,
  ): Promise<void> {
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
   * P3-FIX: Entries with the same lastAccessedAt are processed atomically to prevent
   * cursor-based pagination from splitting or duplicating them across batches.
   *
   * INDEX NOTE: The [syncStatus+lastAccessedAt] compound index (v15+) is defined but
   * the current query pattern (where('lastAccessedAt').above().filter(syncStatus==='synced'))
   * cannot directly leverage it. Dexie's compound index requires the 1st column to be the
   * primary equality filter, while here lastAccessedAt is used for range and syncStatus for
   * equality filter. Future optimization: rewrite as
   * where('[syncStatus+lastAccessedAt]').between(['synced', lastProcessedTime], ['synced', Infinity])
   * to fully utilize the compound index and eliminate the in-memory filter.
   *
   * @param targetBytes Number of bytes to free
   * @returns Actual evicted count and bytes freed
   */
  async evictLRU(
    targetBytes: number,
  ): Promise<{ evictedCount: number; evictedBytes: number }> {
    const db = getDatabase();
    const BATCH_SIZE = 100;
    let evictedBytes = 0;
    let evictedCount = 0;
    let lastProcessedTime = -1;

    // P1-FIX: Wrap entire LRU eviction in transaction to ensure atomicity.
    // If bulkDelete fails (e.g., database closed), statistics won't be returned.
    // Transaction also prevents concurrent Tab interference during read-modify-write cycle.
    await db.transaction('rw!', db.fileCache, async () => {
      while (evictedBytes < targetBytes) {
        // Load one batch of synced entries, ordered by lastAccessedAt ascending (oldest first)
        const batch = await db.fileCache
          .where('lastAccessedAt')
          .above(lastProcessedTime)
          .filter((e) => e.syncStatus === 'synced')
          .limit(BATCH_SIZE)
          .sortBy('lastAccessedAt');

        if (batch.length === 0) break;

        // CRITICAL: If the last entry shares its timestamp with earlier entries,
        // load ALL entries at that timestamp to avoid splitting them across batches.
        // sortBy('lastAccessedAt') doesn't guarantee order within the same timestamp,
        // so splitting could cause entries to be skipped or duplicated.
        const lastTime = batch[batch.length - 1].lastAccessedAt;
        const firstTimeAtLastIndex = batch.findIndex(
          (e) => e.lastAccessedAt === lastTime,
        );

        let entriesToConsider = batch;
        if (
          firstTimeAtLastIndex >= 0 &&
          firstTimeAtLastIndex < batch.length - 1
        ) {
          // Same timestamp spans multiple positions — load all entries at this timestamp
          const allAtLastTime = await db.fileCache
            .where('lastAccessedAt')
            .equals(lastTime)
            .filter((e) => e.syncStatus === 'synced')
            .toArray();
          // Replace partial batch entries at lastTime with complete set
          entriesToConsider = [
            ...batch.slice(0, firstTimeAtLastIndex),
            ...allAtLastTime,
          ];
        }

        const keysToDelete: [string, string][] = [];
        let batchBytes = 0;
        let batchCount = 0;
        for (const entry of entriesToConsider) {
          if (evictedBytes + batchBytes >= targetBytes) break;
          keysToDelete.push([entry.md5, entry.ext]);
          batchBytes += entry.size ?? 0;
          batchCount++;
        }

        // Advance cursor past the last processed timestamp
        lastProcessedTime = lastTime;

        if (keysToDelete.length > 0) {
          // bulkDelete is now within transaction — if it fails, batchBytes/batchCount
          // won't be committed to evictedBytes/evictedCount
          await db.fileCache.bulkDelete(keysToDelete);
          // Only update statistics after successful deletion
          evictedBytes += batchBytes;
          evictedCount += batchCount;
        }
      }
    });

    if (evictedCount > 0) {
      log.info(
        `evictLRU: evicted ${evictedCount} files, freed ${evictedBytes} bytes`,
      );
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
   * Updates syncStatus on each attempt. retryCount is managed atomically
   * by transitionSyncStatus (when transitioning to 'failed').
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param uploadFn Function to perform the actual upload
   * @throws After MAX_RETRY_COUNT failed attempts
   */
  async syncWithRetry(
    md5: string,
    ext: string,
    uploadFn: () => Promise<void>,
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
            log.debug(
              `retry ${attempt}/${MAX_RETRY_COUNT} for ${md5}.${ext} after ${delay}ms`,
            );
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
            log.warn(
              `syncWithRetry: lifecycle closed for ${md5}.${ext}, stopping retry`,
            );
            return;
          }
          lastError = err as Error;
          // transitionSyncStatus to 'failed' atomically increments retryCount,
          // so no separate updateRetryCount call is needed.
          await this.updateSyncStatus(md5, ext, 'failed', String(err));
          log.warn(
            `sync attempt ${attempt + 1}/${MAX_RETRY_COUNT} failed for ${md5}.${ext}:`,
            err,
          );
        }
      }

      log.error(
        `sync failed after ${MAX_RETRY_COUNT} retries for ${md5}.${ext}`,
        lastError,
      );
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
      '[FileCacheRepository] not initialized. Call initFileCacheRepository() first.',
    );
  }
  return fileCacheRepositoryInstance;
}
