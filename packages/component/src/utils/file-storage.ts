/**
 * File Storage Utility
 *
 * High-level API for file operations with automatic MD5 calculation,
 * caching, and progress tracking. Wraps the WorkerBridge file operations.
 *
 * Progress callback semantics:
 * - Online upload: onProgress reflects S3 upload progress (0% -> 100%)
 * - Offline upload: onProgress jumps to 100% after writing to local cache
 *   (background sync progress is not reported via onProgress; tracked via syncStatus)
 * - Online download: onProgress reflects S3 download progress
 * - Offline download (cache hit): returns immediately, onProgress not triggered
 */

import type { WorkerBridge } from '../worker-bridge.js';
import type { FileCacheEntry } from '@rtc-agent/persistence';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('FileStorage');

/**
 * Run tasks with concurrency control.
 *
 * Sliding window algorithm: maintains a fixed number of concurrent workers,
 * each pulling the next task from the queue upon completion.
 *
 * @param tasks Array of task functions
 * @param concurrency Maximum concurrent tasks
 * @param onProgress Progress callback (completed count, total count)
 * @param signal AbortSignal to cancel remaining tasks
 * @returns Array of results (success values or Error objects)
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal
): Promise<(T | Error)[]> {
  const total = tasks.length;
  const results: (T | Error)[] = new Array(total);
  let completedCount = 0;
  let taskIndex = 0;

  async function runNext(): Promise<void> {
    while (taskIndex < total) {
      if (signal?.aborted) return;

      const idx = taskIndex++;
      const task = tasks[idx];

      try {
        results[idx] = await task();
      } catch (err) {
        results[idx] = err instanceof Error ? err : new Error(String(err));
      }

      completedCount++;
      onProgress?.(completedCount, total);
    }
  }

  // Start concurrency number of workers
  const workers = Array.from(
    { length: Math.min(concurrency, total) },
    () => runNext()
  );

  await Promise.all(workers);
  return results;
}

/**
 * File information returned by upload operations.
 */
export interface FileInfo {
  /** MD5 hash (32-character hex) */
  md5: string;
  /** File extension (without dot) */
  ext: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** Original filename (if available) */
  filename?: string;
  /** Sync status: pending, syncing, synced, or failed */
  syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed';
  /** Local creation time (Unix timestamp in ms) */
  createdAt?: number;
  /** Last sync time (Unix timestamp in ms) */
  syncedAt?: number;
  /** Error message if sync failed */
  errorMessage?: string;
}

/**
 * Options for file upload.
 */
export interface UploadOptions {
  /** File to upload */
  file: File | Blob;
  /** Original filename (used to extract extension) */
  filename?: string;
  /** MIME type (overrides file.type) */
  contentType?: string;
  /** Progress callback: (loaded bytes, total bytes) */
  onProgress?: (loaded: number, total: number) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Cache TTL in milliseconds (default: 7 days). Controls how long the file is cached locally. */
  cacheTtlMs?: number;
}

/**
 * Options for file download.
 */
export interface DownloadOptions {
  /** Force download from S3, bypassing cache */
  forceRefresh?: boolean;
  /** Progress callback: (loaded bytes, total bytes) */
  onProgress?: (loaded: number, total: number) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Options for batch operations.
 */
export interface BatchOptions {
  /** Progress callback: (completed count, total count) */
  onProgress?: (current: number, total: number) => void;

  /**
   * Maximum concurrent operations (default: 3).
   *
   * Controls how many operations run in parallel.
   * - Upload: concurrent S3 uploads via WorkerBridge
   * - Download: concurrent S3 downloads via WorkerBridge
   * - Delete: concurrent delete operations
   *
   * Higher values improve throughput but increase memory/bandwidth usage.
   * Recommended: 1-2 for large files (>10MB), 3-5 for mixed, 5-10 for small files.
   */
  concurrency?: number;

  /**
   * Error handling strategy (default: 'continue').
   *
   * - 'continue': Continue remaining operations on failure (best-effort).
   *   Returns only successful results.
   * - 'cancel': Cancel remaining operations on first failure.
   *   Already-completed operations are preserved.
   */
  onError?: 'continue' | 'cancel';
}

/**
 * Options for batch upload operations.
 *
 * Extends BatchOptions with per-file progress, cancellation, and cache TTL
 * that are forwarded to each individual upload() call within the batch.
 */
export interface BatchUploadOptions extends BatchOptions {
  /** Per-file progress callback: (loaded bytes, total bytes) forwarded to each upload */
  onFileProgress?: (loaded: number, total: number) => void;
  /** AbortSignal forwarded to each upload for cancellation */
  signal?: AbortSignal;
  /** Cache TTL in milliseconds forwarded to each upload */
  cacheTtlMs?: number;
}

/**
 * Options for batch download operations.
 *
 * Extends BatchOptions with per-file progress, cancellation, and force refresh
 * that are forwarded to each individual download() call within the batch.
 */
export interface BatchDownloadOptions extends BatchOptions {
  /** Per-file progress callback: (loaded bytes, total bytes) forwarded to each download */
  onFileProgress?: (loaded: number, total: number) => void;
  /** AbortSignal forwarded to each download for cancellation */
  signal?: AbortSignal;
  /** Force download from S3, bypassing cache — forwarded to each download */
  forceRefresh?: boolean;
}

/**
 * Filter options for listing files.
 */
export interface ListFilter {
  /** Filter by sync status */
  syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed';
  /** Maximum number of entries to return (default: 100) */
  limit?: number;
  /** Number of entries to skip (default: 0) */
  offset?: number;
}

/**
 * Options for updating file metadata.
 */
export interface UpdateMetadataOptions {
  /** Original filename */
  filename?: string;
  /** MIME type */
  contentType?: string;
}

/**
 * Result of a paginated file listing.
 */
export interface ListResult {
  /** Array of file info entries */
  files: FileInfo[];
  /** Total number of files matching the filter */
  total: number;
  /** Whether more files are available beyond the current page */
  hasMore: boolean;
}

/**
 * Extract file extension from filename.
 *
 * @param filename - Filename to extract extension from
 * @returns Extension without dot, or 'bin' if no extension found
 *
 * @example
 * ```typescript
 * getFileExtension('document.pdf') // 'pdf'
 * getFileExtension('image.JPG') // 'jpg'
 * getFileExtension('noextension') // 'bin'
 * ```
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return 'bin';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Generate a filename from MD5 and extension.
 *
 * @param md5 - MD5 hash
 * @param ext - File extension
 * @returns Generated filename in format: {md5}.{ext}
 */
export function generateFilename(md5: string, ext: string): string {
  return `${md5}.${ext}`;
}

/**
 * File Storage Utility Class
 *
 * Provides intelligent file upload/download with automatic MD5 calculation,
 * caching, and progress tracking.
 *
 * Progress callback semantics:
 *
 * - Online upload: onProgress reflects S3 upload progress (0% -> 100%)
 * - Offline upload: onProgress jumps to 100% after writing to local cache
 *   (background sync progress is not reported via onProgress; tracked via syncStatus)
 * - Online download: onProgress reflects S3 download progress
 * - Offline download (cache hit): returns immediately, onProgress not triggered
 *
 * @example
 * ```typescript
 * const fileStorage = new FileStorage(workerBridge, userId);
 *
 * // Upload a file
 * const fileInfo = await fileStorage.upload({
 *   file: input.files[0],
 *   onProgress: (loaded, total) => console.log(`${loaded}/${total}`)
 * });
 *
 * // Download a file
 * const blob = await fileStorage.download(fileInfo.md5, fileInfo.ext);
 *
 * // Upload with cancellation
 * const controller = new AbortController();
 * const fileInfo = await fileStorage.upload({
 *   file: input.files[0],
 *   signal: controller.signal,
 * });
 * controller.abort(); // cancels the upload
 *
 * // List files with pagination
 * const result = await fileStorage.list({ limit: 10, offset: 0 });
 * console.log(result.files, result.total, result.hasMore);
 *
 * // Generate presigned URL
 * const url = await fileStorage.getPresignedUrl({ md5: fileInfo.md5, ext: fileInfo.ext });
 *
 * // Check if file exists
 * const exists = await fileStorage.exists({ md5: fileInfo.md5, ext: fileInfo.ext });
 * ```
 */
export class FileStorage {
  constructor(
    private readonly bridge: WorkerBridge,
    private readonly userId: string
  ) {}

  /**
   * Upload a file with automatic MD5 calculation.
   *
   * Flow:
   * 1. Check abort signal (fail fast if already aborted)
   * 2. Calculate MD5 hash of the file (in Worker thread)
   * 3. Extract extension from filename
   * 4. Upload to S3 via WorkerBridge (with progress and abort support)
   * 5. Return file metadata
   *
   * @param options - Upload options
   * @returns File metadata (md5, ext, size, contentType)
   * @throws DOMException with name 'AbortError' if signal is aborted
   */
  async upload(options: UploadOptions): Promise<FileInfo> {
    const { file, filename, contentType, onProgress, signal } = options;

    // Fail fast if already aborted
    if (signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }

    // Calculate MD5 in Worker thread (doesn't block main thread)
    const md5 = await this.bridge.calculateFileMD5(file);

    // Extract extension
    const ext = filename ? getFileExtension(filename) : 'bin';

    // Determine content type
    const resolvedContentType = contentType || file.type || 'application/octet-stream';

    // Upload to S3 (signal is checked at bridge entry; Comlink cannot forward it)
    // P2-R7-04: Pass filename through WorkerBridge so cache stores it
    const result = await this.bridge.uploadFile(md5, ext, file, resolvedContentType, filename, onProgress, signal, options.cacheTtlMs);

    return {
      md5,
      ext,
      size: file.size,
      contentType: resolvedContentType,
      filename,
      syncStatus: result?.syncStatus ?? 'synced',
      syncedAt: result?.syncedAt,
      errorMessage: result?.errorMessage,
    };
  }

  /**
   * Download a file with automatic caching.
   *
   * Flow:
   * 1. Check abort signal (fail fast if already aborted)
   * 2. Check local cache (unless forceRefresh is true)
   * 3. If cache hit, return cached blob
   * 4. If cache miss, download from S3 via WorkerBridge
   * 5. Cache the downloaded file
   * 6. Return the blob
   *
   * P2-NEW-4 fix: forceRefresh is now properly passed to the bridge/worker/persistence layer
   *
   * @param md5 - File MD5 hash
   * @param ext - File extension
   * @param options - Download options
   * @returns File content as Blob
   * @throws DOMException with name 'AbortError' if signal is aborted
   */
  async download(
    md5: string,
    ext: string,
    options?: DownloadOptions
  ): Promise<Blob> {
    const { forceRefresh = false, onProgress, signal } = options || {};

    // Fail fast if already aborted
    if (signal?.aborted) {
      throw new DOMException('Download aborted', 'AbortError');
    }

    // P2-NEW-4 fix: pass forceRefresh to bridge, which will forward it to the worker/persistence layer
    // The cache check is now done in PersistenceLayer.downloadFile, not here
    const blob = await this.bridge.downloadFile(md5, ext, onProgress, signal, forceRefresh);

    return blob;
  }

  /**
   * List files with pagination and optional status filtering.
   *
   * @param filter - Optional filter for pagination and sync status
   * @returns Paginated result with files, total count, and hasMore flag
   *
   * @example
   * ```typescript
   * // First page
   * const page1 = await fileStorage.list({ limit: 10, offset: 0 });
   * // page1.files: FileInfo[], page1.total: number, page1.hasMore: boolean
   *
   * // Filter by status
   * const pending = await fileStorage.list({ syncStatus: 'pending' });
   * ```
   */
  async list(filter?: ListFilter): Promise<ListResult> {
    const { limit = 100, offset = 0, syncStatus } = filter || {};
    const entries = await this.bridge.listFiles(syncStatus, limit, offset);
    const total = await this.bridge.countFiles(syncStatus);
    return {
      files: entries.map(toFileInfo),
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Check if a file is cached locally.
   *
   * @param md5 - File MD5 hash
   * @param ext - File extension
   * @returns True if file is cached
   */
  async isCached(md5: string, ext: string): Promise<boolean> {
    const cached = await this.bridge.getCachedFile(md5, ext);
    return cached !== null;
  }

  /**
   * Get file metadata without downloading the file.
   *
   * Checks local cache first, then falls back to S3 HEAD request.
   *
   * @param identifier - File identifier (md5 + ext or FileInfo)
   * @returns File metadata or null if not found
   */
  async getMetadata(identifier: FileIdentifier): Promise<FileInfo | null> {
    const { md5, ext } = normalizeIdentifier(identifier);

    // Check local cache first
    const cached = await this.bridge.getCachedFile(md5, ext);
    if (cached) {
      return {
        md5,
        ext,
        size: cached.blob.size,
        contentType: cached.contentType,
        filename: cached.filename,  // P3-004 fix: return filename from cache
        syncStatus: cached.syncStatus as FileInfo['syncStatus'],
        createdAt: cached.createdAt,
        syncedAt: cached.syncedAt,
        errorMessage: cached.errorMessage,
      };
    }

    // Check S3 via HEAD request
    try {
      const head = await this.bridge.headFile(md5, ext);
      return {
        md5,
        ext,
        size: head.contentLength,
        contentType: head.contentType || 'application/octet-stream',
        filename: undefined,
        // P3-R5-01: If file exists on S3 but not in local cache, syncStatus is
        // always 'synced' (the S3 HEAD succeeded, proving it's on S3).
        syncStatus: 'synced',
      };
    } catch (e) {
      // P2-NEW-B fix: Use structured error detection instead of string matching
      // AWS SDK errors have $metadata.httpStatusCode, or code property
      const isNotFound = (() => {
        if (!e || typeof e !== 'object') return false;
        const anyErr = e as any;
        return (
          anyErr.$metadata?.httpStatusCode === 404 ||
          anyErr.code === 'NoSuchKey' ||
          anyErr.name === 'NotFound' ||
          anyErr.name === 'NoSuchKey'
        );
      })();

      if (isNotFound) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Check if a file exists (in cache or S3).
   *
   * @param identifier - File identifier (md5 + ext or FileInfo)
   * @returns True if file exists
   */
  async exists(identifier: FileIdentifier): Promise<boolean> {
    const metadata = await this.getMetadata(identifier);
    return metadata !== null;
  }

  /**
   * Get a presigned URL for direct file access.
   *
   * @param identifier - File identifier (md5 + ext or FileInfo)
   * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
   * @returns Presigned URL string
   */
  async getPresignedUrl(
    identifier: FileIdentifier,
    expiresIn: number = 3600
  ): Promise<string> {
    const { md5, ext } = normalizeIdentifier(identifier);
    const key = `user-${this.userId}/${md5}.${ext}`;

    return await this.bridge.getPresignedUrl('get', key, expiresIn);
  }

  // ========== Thumbnail URL Management ==========

  /** Shared blob URL cache (md5.ext → {url, refCount}) */
  private _blobUrlCache = new Map<string, {url: string; refCount: number}>();

  /** Inflight dedup (md5.ext → Promise) */
  private _inflightThumbnail = new Map<string, Promise<string>>();

  /**
   * Get thumbnail URL with shared blob URL cache and inflight dedup.
   *
   * Strategy:
   * 1. Already have blob URL → return directly (refCount++)
   * 2. Request in-flight → reuse Promise (dedup)
   * 3. Local cache hit → download() + createObjectURL()
   * 4. Cache miss → download() (auto-caches) + createObjectURL()
   * 5. Download fails → getPresignedUrl() (final fallback, browser loads directly)
   *
   * @param identifier - File identifier (md5 + ext or FileInfo)
   * @returns URL string (blob: or https:) for use in <img src>
   */
  async getThumbnailUrl(identifier: FileIdentifier): Promise<string> {
    const {md5, ext} = normalizeIdentifier(identifier);
    const key = `${md5}.${ext}`;

    // 1. Already have blob URL → return directly
    const cached = this._blobUrlCache.get(key);
    if (cached) {
      cached.refCount++;
      return cached.url;
    }

    // 2. Inflight dedup
    const inflight = this._inflightThumbnail.get(key);
    if (inflight) {
      return inflight;
    }

    // 3-5. Load
    const promise = this._resolveThumbnailUrl(md5, ext, key);
    this._inflightThumbnail.set(key, promise);
    return promise;
  }

  private async _resolveThumbnailUrl(
    md5: string,
    ext: string,
    key: string
  ): Promise<string> {
    try {
      // 3. Check local cache
      const isCached = await this.isCached(md5, ext);
      if (isCached) {
        const blob = await this.download(md5, ext);
        return this._createBlobUrl(blob, key);
      }

      // 4. Cache miss → download (auto-caches)
      try {
        const blob = await this.download(md5, ext);
        return this._createBlobUrl(blob, key);
      } catch (downloadErr) {
        // 5. Download failed → fallback to presigned URL
        log.warn('Download failed, falling back to presigned URL:', downloadErr);
        this._inflightThumbnail.delete(key);
        return await this.getPresignedUrl({md5, ext}, 3600);
      }
    } catch (err) {
      this._inflightThumbnail.delete(key);
      throw err;
    }
  }

  private _createBlobUrl(blob: Blob, key: string): string {
    const url = URL.createObjectURL(blob);
    this._blobUrlCache.set(key, {url, refCount: 1});
    this._inflightThumbnail.delete(key);
    return url;
  }

  /**
   * Release thumbnail URL reference.
   *
   * Decrements refCount. When refCount reaches 0, revokes the blob URL.
   * Call this in component disconnectedCallback.
   *
   * @param identifier - File identifier (md5 + ext or FileInfo)
   */
  releaseThumbnailUrl(identifier: FileIdentifier): void {
    const {md5, ext} = normalizeIdentifier(identifier);
    const key = `${md5}.${ext}`;
    const entry = this._blobUrlCache.get(key);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount <= 0) {
      URL.revokeObjectURL(entry.url);
      this._blobUrlCache.delete(key);
    }
  }

  /**
   * Cache file locally for upload (edit mode).
   *
   * Writes file to local cache with syncStatus='pending', without uploading to S3.
   * Returns FileInfo with real fileid (md5.ext) so components can use getThumbnailUrl()
   * immediately. The actual S3 upload happens later via upload().
   *
   * @param file - File object to cache
   * @returns FileInfo with real md5, ext, and syncStatus='pending'
   */
  async cacheFileForUpload(file: File): Promise<FileInfo> {
    // 1. Calculate MD5 (Worker thread, doesn't block main thread)
    const md5 = await this.bridge.calculateFileMD5(file);
    const ext = getFileExtension(file.name);
    const contentType = file.type || 'application/octet-stream';

    // 2. Write to local cache with syncStatus='pending' (no S3 upload)
    await this.bridge.cacheFilePending(md5, ext, file, contentType, file.name);

    // 3. Return FileInfo with real fileid
    return {
      md5,
      ext,
      size: file.size,
      contentType,
      filename: file.name,
      syncStatus: 'pending',
    };
  }

  /**
   * Execute batch operations with concurrency control and error handling.
   *
   * Common implementation for uploadBatch, downloadBatch, and deleteBatch.
   * Encapsulates: concurrency clamping, abort-on-error cancellation, progress tracking.
   *
   * @param items - Array of items to process
   * @param buildTask - Factory function that creates a task for each item
   * @param options - Batch options (concurrency, onError, onProgress)
   * @returns Array of successful results
   */
  private async _batchExecute<T>(
    items: unknown[],
    buildTask: (item: unknown, index: number) => () => Promise<T>,
    options?: BatchOptions
  ): Promise<T[]> {
    const {
      onProgress,
      concurrency = 3,
      onError = 'continue',
    } = options || {};

    if (items.length === 0) {
      return [];
    }

    // Clamp concurrency to valid range
    const effectiveConcurrency = Math.max(1, Math.min(10, concurrency));

    const succeeded: T[] = [];
    const cancelController = new AbortController();

    // Build task list
    const tasks = items.map((item, index) => {
      const task = buildTask(item, index);
      return async (): Promise<T> => {
        // Check if batch was cancelled
        if (cancelController.signal.aborted) {
          throw new DOMException('Batch cancelled', 'AbortError');
        }

        const result = await task();
        succeeded.push(result);
        return result;
      };
    });

    // Wrap tasks to handle cancellation on error
    const wrappedTasks = tasks.map((task) => async (): Promise<T> => {
      try {
        return await task();
      } catch (err) {
        if (onError === 'cancel' && !(err instanceof DOMException && err.name === 'AbortError')) {
          cancelController.abort();
        }
        throw err;
      }
    });

    await runWithConcurrency(
      wrappedTasks,
      effectiveConcurrency,
      onProgress,
      onError === 'cancel' ? cancelController.signal : undefined,
    );

    return succeeded;
  }

  /**
   * Batch upload multiple files with concurrency control.
   *
   * @param files - Array of files to upload
   * @param options - Batch options (concurrency, onError, onProgress)
   * @returns Array of successfully uploaded file metadata
   *
   * @example
   * ```typescript
   * // Upload with concurrency control
   * const results = await fileStorage.uploadBatch(
   *   files,
   *   { concurrency: 5, onProgress: (done, total) => console.log(`${done}/${total}`) }
   * );
   *
   * // Cancel on first error
   * const results = await fileStorage.uploadBatch(
   *   files,
   *   { onError: 'cancel' }
   * );
   * ```
   */
  async uploadBatch(
    files: Array<{ file: File | Blob; filename?: string }>,
    options?: BatchUploadOptions
  ): Promise<FileInfo[]> {
    return this._batchExecute<FileInfo>(
      files,
      (item) => {
        const f = item as { file: File | Blob; filename?: string };
        return () => this.upload({
          file: f.file,
          filename: f.filename,
          onProgress: options?.onFileProgress,
          signal: options?.signal,
          cacheTtlMs: options?.cacheTtlMs,
        });
      },
      options
    );
  }

  /**
   * Batch download multiple files with concurrency control.
   *
   * @param keys - Array of {md5, ext} to download
   * @param options - Batch options (concurrency, onError, onProgress)
   * @returns Array of successfully downloaded Blobs
   *
   * @example
   * ```typescript
   * // Download with concurrency control
   * const blobs = await fileStorage.downloadBatch(
   *   keys,
   *   { concurrency: 5, onProgress: (done, total) => console.log(`${done}/${total}`) }
   * );
   * ```
   */
  async downloadBatch(
    keys: Array<{ md5: string; ext: string }>,
    options?: BatchDownloadOptions
  ): Promise<Blob[]> {
    return this._batchExecute<Blob>(
      keys,
      (item) => {
        const key = item as { md5: string; ext: string };
        // P3-003 fix: forward options to individual downloads
        return () => this.download(key.md5, key.ext, {
          onProgress: options?.onFileProgress,
          signal: options?.signal,
          forceRefresh: options?.forceRefresh,
        });
      },
      options
    );
  }

  /**
   * Delete a file (local cache + S3).
   *
   * @param identifier - File identifier (md5 + ext or FileInfo)
   */
  async delete(identifier: FileIdentifier): Promise<void> {
    const { md5, ext } = normalizeIdentifier(identifier);
    await this.bridge.deleteFile(md5, ext);
  }

  /**
   * Delete multiple files with concurrency control.
   *
   * @param identifiers - Array of file identifiers
   * @param options - Batch options (concurrency, onError, onProgress)
   *
   * @example
   * ```typescript
   * // Delete with concurrency control
   * await fileStorage.deleteBatch(
   *   identifiers,
   *   { concurrency: 5, onProgress: (done, total) => console.log(`${done}/${total}`) }
   * );
   * ```
   */
  async deleteBatch(
    identifiers: FileIdentifier[],
    options?: BatchOptions
  ): Promise<void> {
    await this._batchExecute<void>(
      identifiers,
      (item) => {
        const identifier = item as FileIdentifier;
        return () => this.delete(identifier);
      },
      options
    );
  }

  /**
   * Resume interrupted multipart uploads.
   *
   * Typically called automatically during initialization and network recovery.
   * Can be called manually to trigger resume.
   *
   * P2-NEW-6 fix: Returns syncedFiles/failedFiles for per-file event broadcasting.
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
    return this.bridge.resumeInterruptedUploads();
  }

  /**
   * Get cache statistics: total files, total size, and breakdown by sync status.
   *
   * @returns CacheStats with totalFiles, totalSize (bytes), and byStatus breakdown
   */
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
    return this.bridge.getCacheStats();
  }

  /**
   * Evict synced cache entries using LRU strategy.
   *
   * Only evicts files with syncStatus='synced'. Pending/failed/syncing files
   * are preserved to prevent data loss.
   *
   * @param targetBytes Number of bytes to free (default: 100MB)
   * @returns Actual evicted count and bytes freed
   *
   * @example
   * ```typescript
   * // Free up 50MB of cache space
   * const result = await fileStorage.evictCache(50 * 1024 * 1024);
   * console.log(`Evicted ${result.evictedCount} files, freed ${result.evictedBytes} bytes`);
   * ```
   */
  async evictCache(targetBytes?: number): Promise<{ evictedCount: number; evictedBytes: number }> {
    return this.bridge.evictCache(targetBytes);
  }

  /**
   * Update file metadata (filename, contentType) in the local cache.
   *
   * Updates the metadata fields of an existing cached file entry.
   * Throws if the file entry is not found in the local cache.
   *
   * @param identifier - File identifier (md5 + ext or FileInfo)
   * @param options - Metadata fields to update
   *
   * @example
   * ```typescript
   * await fileStorage.updateMetadata(
   *   { md5: fileInfo.md5, ext: fileInfo.ext },
   *   { filename: 'report.pdf', contentType: 'application/pdf' }
   * );
   * ```
   */
  async updateMetadata(
    identifier: FileIdentifier,
    options: UpdateMetadataOptions
  ): Promise<void> {
    const { md5, ext } = normalizeIdentifier(identifier);
    await this.bridge.updateFileMetadata(md5, ext, options);
  }
}

/**
 * File identifier: either {md5, ext} or FileInfo.
 */
type FileIdentifier = { md5: string; ext: string } | FileInfo;

/**
 * Normalize a file identifier to {md5, ext}.
 */
function normalizeIdentifier(identifier: FileIdentifier): { md5: string; ext: string } {
  return { md5: identifier.md5, ext: identifier.ext };
}

/**
 * Convert a FileCacheEntry (from bridge) to FileInfo.
 *
 * The bridge returns entries with fields: md5, ext, size, contentType, filename,
 * syncStatus, createdAt, syncedAt, errorMessage, etc. This extracts the user-facing fields.
 */
function toFileInfo(entry: FileCacheEntry): FileInfo {
  return {
    md5: entry.md5,
    ext: entry.ext,
    size: entry.size,
    contentType: entry.contentType,
    filename: entry.filename,
    syncStatus: entry.syncStatus,
    createdAt: entry.createdAt,
    syncedAt: entry.syncedAt,
    errorMessage: entry.errorMessage,
  };
}
