import type { ContentData } from '@rtc-agent/protocol';
import type { ConnectionState, ConnectionStateEvent, HeadObjectResult } from '@rtc-agent/client';
import type { PersistenceConfig, AgentMdConfig, FileSystemMetadataOverride, UIUpdateQueueEntry, CachedFileInfo, FileCacheEntry, FileSyncStatus, GrepResult } from '@rtc-agent/persistence';
import type { UIUpdateEvent, LocalSession, LocalMessage, LocalRtc, DebugHistoryItem, PagedResult } from '@rtc-agent/persistence';

/**
 * Payload for onUIUpdate callback: includes the event and its persisted seq.
 * The seq is used by the main thread to track progress and minimize redundant catch-up replays.
 */
export interface UIUpdatePayload {
  event: UIUpdateEvent;
  /** Persisted seq in IndexedDB (0 if persist failed or event was suspended). */
  seq: number;
}

/**
 * Worker-side callbacks: each connected Tab registers its own set.
 *
 * - onUIUpdate: Worker broadcasts entity changes to this Tab (includes seq for cursor tracking)
 * - requestToken: Centrifuge requests a token from any Tab when needed
 * - requestTokenRefresh: Centrifuge requests a token refresh from any Tab when expired
 * - onConnectionStateChange: Worker broadcasts RTCAgentClient connection state changes to this Tab
 * - onGapFillState: Worker broadcasts gap fill state changes (start/end) to this Tab
 * - onStateGap: Catch-up detected a gap in events (TTL cleanup deleted missed events).
 *               The tab should trigger a full state refresh to recover.
 * - onAccountBanned: Worker broadcasts account ban notification (disconnect code 4501) to this Tab
 */
export interface WorkerCallbacks {
  onUIUpdate: (payload: UIUpdatePayload) => void;
  requestToken: () => Promise<string>;
  requestTokenRefresh: () => Promise<'refresh' | 'relogin'>;
  onConnectionStateChange: (event: ConnectionStateEvent) => void;
  onGapFillState: (isSyncing: boolean) => void;
  /** Called when catch-up detects a gap in events (e.g., TTL cleanup deleted missed events). */
  onStateGap: () => void;
  /** Called when the user's account is banned (disconnect code 4501). */
  onAccountBanned?: (reason: string) => void;
}

/**
 * WorkerPersistenceCore: the interface exposed by the Worker side.
 *
 * - init(): Initialize shared state (only the first Tab actually executes; subsequent calls are idempotent)
 * - registerCallback / unregisterCallback: manage per-Tab callbacks
 * - Other methods pass through to PersistenceLayer
 */
export interface WorkerPersistenceCore {
  init(config: PersistenceConfig): Promise<void>;

  /** Register a Tab's callbacks (called by facade on connect) */
  registerCallback(cb: WorkerCallbacks): void;
  /** Unregister a Tab's callbacks */
  unregisterCallback(cb: WorkerCallbacks): void;

  /**
   * Get persistent UI update events for catch-up after page refresh or reconnection.
   *
   * Returns events from the IndexedDB queue where seq > fromSeq, ordered by seq ascending.
   * The main thread uses this to replay missed events that were persisted while the tab
   * was disconnected or refreshing.
   *
   * Also detects gaps: if fromSeq > 0 but events were deleted by TTL cleanup,
   * hasGap is true and the caller should trigger a full state refresh.
   *
   * @param fromSeq - Return events with seq > fromSeq
   * @param limit - Maximum number of events to return (default: 1000)
   * @returns entries, hasGap (events were skipped), hasMore (more events beyond limit)
   */
  getCatchUpEvents(fromSeq: number, limit?: number): Promise<{
    entries: UIUpdateQueueEntry[];
    hasGap: boolean;
    hasMore: boolean;
  }>;

  /**
   * Health check: verify the Worker is running.
   *
   * Works without init(); used by the main thread to verify that the
   * SharedWorker started successfully.
   */
  ping(): string;

  // ========== Connection ==========
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;
  getConnectionState(): Promise<ConnectionState>;

  // ========== Queries ==========
  listSessions(cursor?: string, limit?: number): Promise<LocalSession[]>;
  getSession(clientId: string): Promise<LocalSession | undefined>;
  listMessages(
    sessionClientId: string,
    cursor?: string,
    limit?: number,
    direction?: 'backward' | 'forward',
  ): Promise<LocalMessage[]>;
  getMessage(clientId: string): Promise<LocalMessage | undefined>;
  listRtc(
    sessionClientId: string,
    cursor?: number,
    limit?: number,
  ): Promise<LocalRtc[]>;
  getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined>;

  // ========== Debug History ==========
  addDebugHistoryItem(item: DebugHistoryItem): Promise<void>;
  queryDebugHistory(
    functionName?: string,
    cursor?: string,
    limit?: number
  ): Promise<PagedResult<DebugHistoryItem>>;
  countDebugHistory(functionName?: string): Promise<number>;
  clearDebugHistory(): Promise<void>;
  batchDeleteDebugHistory(ids: string[]): Promise<void>;

  // ========== Operations ==========
  sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }>;

  /** Insert a local message (not sent to server) */
  insertLocalMessage(params: {
    sessionClientId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    creatorKind?: string;
    creatorRefId?: string;
  }): Promise<LocalMessage>;

  stopTurn(sessionClientId: string): Promise<void>;

  /** Close session (notify backend to stop turn loop) */
  closeSession(sessionClientId: string): Promise<void>;

  /** Reopen a closed session */
  openSession(sessionClientId: string): Promise<void>;

  compactSession(sessionClientId: string, customInstruction?: string): Promise<void>;

  submitRtcResult(params: {
    rtcClientId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): Promise<void>;

  forkSession(params: {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    newMessageClientId: string;
    content: ContentData;
    limit?: number;
  }): Promise<{ session: LocalSession; message: LocalMessage }>;

  /** Soft-delete session (local optimistic update + async RPC sync) */
  deleteSession(sessionClientId: string): Promise<void>;

  /** Update session title (local optimistic update + async RPC sync) */
  updateSessionTitle(sessionClientId: string, title: string): Promise<void>;

  // ========== Lifecycle ==========
  close(): Promise<void>;
  flushAll(): Promise<void>;

  // ========== Additional capabilities ==========

  /**
   * Initialize the virtual file system (AGENT.md).
   *
   * VirtualFS runs inside the Worker (sharing the same IndexedDB),
   * so it must be invoked via Comlink rather than calling initializeVirtualFS
   * directly on the main thread.
   */
  initializeVirtualFS(config?: AgentMdConfig): Promise<void>;

  /**
   * Batch-write files to the virtual file system, optionally deleting stale paths.
   *
   * The main thread cannot directly access Worker-internal VirtualFS/IndexedDB;
   * this method sends file content to the Worker for writing.
   *
   * When deletePaths is provided, those paths are removed after writing —
   * used for doc reconciliation (cleaning up orphan function/scenario docs).
   */
  batchWriteFiles(
    files: Array<{
      path: string;
      content: string;
      metadata?: FileSystemMetadataOverride;
    }>,
    deletePaths?: string[],
  ): Promise<void>;

  /**
   * Reset OffsetManager cache (equivalent to getOffsetManager().reset()).
   *
   * The main thread cannot access Worker-internal OffsetManager;
   * this method passes the reset call through.
   */
  resetOffset(): Promise<void>;

  // ========== virtualFS proxy (main thread -> Worker) ==========

  /**
   * Read a virtual file (executed inside Worker: getDatabase + read).
   *
   * The main thread cannot directly access IndexedDB;
   * this method proxies virtualFS.read calls into the Worker.
   */
  virtualFSRead(path: string, offset?: number, limit?: number): Promise<string>;

  /**
   * Write a virtual file (executed inside Worker).
   */
  virtualFSWrite(
    path: string,
    content: string,
    mode: 'overwrite' | 'append',
    metadataOverride?: FileSystemMetadataOverride,
  ): Promise<number>;

  /**
   * List directory contents (executed inside Worker).
   */
  virtualFSLs(path?: string): Promise<string[]>;

  /**
   * Search by file name (executed inside Worker).
   */
  virtualFSFind(pattern: string, path?: string): Promise<string[]>;

  /**
   * Search file contents (executed inside Worker).
   */
  virtualFSGrep(
    pattern: string,
    path?: string,
    caseSensitive?: boolean,
    maxResults?: number,
  ): Promise<GrepResult>;

  /**
   * Query files by type (executed inside Worker).
   *
   * Return type matches persistence package's FileSystemEntry;
   * Date fields are preserved as Date instances during Comlink transport.
   */
  virtualFSQueryByType(type: string): Promise<Array<{
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
  }>>;

  /**
   * Check if a file exists (executed inside Worker).
   */
  virtualFSExists(path: string): Promise<boolean>;

  /**
   * Delete a file (executed inside Worker).
   */
  virtualFSRemove(path: string): Promise<void>;

  // ========== File Cache & S3 Operations ==========

  /**
   * Cache a downloaded file (executed inside Worker).
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param blob File content as Blob
   * @param contentType MIME type
   * @param ttlMs Time-to-live in milliseconds (default: 7 days)
   */
  cacheFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    ttlMs?: number
  ): Promise<void>;

  /**
   * Cache a downloaded file with pending sync status (executed inside Worker).
   *
   * Similar to cacheFile but records the entry with syncStatus='pending',
   * meaning the file content is cached locally but not yet uploaded to S3.
   * Used for optimistic local caching before upload completes.
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param blob File content as Blob
   * @param contentType MIME type
   * @param filename Original filename (optional)
   */
  cacheFilePending(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    filename?: string
  ): Promise<void>;

  /**
   * Get a cached file (executed inside Worker).
   *
   * Returns null if not found or expired.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  getCachedFile(
    md5: string,
    ext: string
  ): Promise<CachedFileInfo | null>;

  /**
   * Evict all expired cache entries (executed inside Worker).
   *
   * @returns Number of entries evicted
   */
  evictExpiredCache(): Promise<number>;

  /**
   * Evict synced cache entries using LRU strategy (executed inside Worker).
   *
   * Only evicts files with syncStatus='synced'. Pending/failed/syncing files
   * are preserved to prevent data loss.
   *
   * @param targetBytes Number of bytes to free (default: 100MB)
   * @returns Actual evicted count and bytes freed
   */
  evictCache(targetBytes?: number): Promise<{ evictedCount: number; evictedBytes: number }>;

  /**
   * Upload a file to S3 (executed inside Worker).
   *
   * Directly uploads without checking existence (S3 handles overwrite idempotently).
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param blob File content as Blob
   * @param contentType MIME type (optional)
   * @param filename Original filename (optional)
   * @param operationId Unique ID for cancellation (optional, generated by WorkerBridge)
   * @param onProgress Progress callback (optional)
   * @returns Upload result with sync status information
   */
  uploadFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType?: string,
    filename?: string,
    operationId?: string,
    onProgress?: (loaded: number, total: number) => void,
    cacheTtlMs?: number
  ): Promise<{ syncStatus: 'pending' | 'syncing' | 'synced' | 'failed'; syncedAt?: number; errorMessage?: string }>;

  /**
   * Download a file from S3 with local caching (executed inside Worker).
   *
   * Flow:
   * 1. Check local cache (returns if hit and not expired, unless forceRefresh=true)
   * 2. Download from S3 with deduplication
   * 3. Cache the downloaded file (TTL: 7 days)
   * 4. Return the file
   *
   * P2-NEW-4 fix: added forceRefresh parameter to bypass local cache
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param onProgress Progress callback for download (optional)
   * @param operationId Unique ID for cancellation (optional, generated by WorkerBridge)
   * @param forceRefresh If true, bypass local cache and download from S3 (optional)
   */
  downloadFile(md5: string, ext: string, onProgress?: (loaded: number, total: number) => void, operationId?: string, forceRefresh?: boolean): Promise<Blob>;

  /**
   * Cancel an ongoing file operation (upload or download) by its operationId.
   *
   * Called by WorkerBridge when an AbortSignal fires. The WorkerCore maintains
   * a map of operationId -> AbortController; calling this aborts the controller,
   * which propagates to the underlying HTTP request via the PersistenceLayer's signal.
   *
   * No-op if operationId is not found (e.g., operation already completed).
   *
   * @param operationId Unique ID returned by WorkerBridge when starting the operation
   */
  cancelFileOperation(operationId: string): void;

  /**
   * Delete a file from local cache and S3 (executed inside Worker).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  deleteFile(md5: string, ext: string): Promise<void>;

  // ========== MD5 Calculation ==========

  /**
   * Calculate MD5 hash of a Blob (executed inside Worker).
   *
   * Runs in the Worker thread to avoid blocking the main thread.
   *
   * @param blob Blob to calculate MD5 for
   * @returns Promise resolving to 32-character hex MD5 hash
   */
  calculateFileMD5(blob: Blob): Promise<string>;

  // ========== S3 Metadata Operations ==========

  /**
   * Get file metadata from S3 without downloading (executed inside Worker).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @returns HeadObjectResult with contentLength, contentType, lastModified, etag
   */
  headFile(md5: string, ext: string): Promise<HeadObjectResult>;

  /**
   * Get a presigned URL for file operations (executed inside Worker).
   *
   * @param operation 'get' or 'put'
   * @param key S3 object key
   * @param expiresIn Expiration time in seconds (optional)
   * @returns Presigned URL string
   */
  getPresignedUrl(operation: 'get' | 'put', key: string, expiresIn?: number): Promise<string>;

  // ========== File List & Count ==========

  /**
   * List files by sync status (executed inside Worker).
   *
   * @param syncStatus Filter by sync status (optional)
   * @param limit Maximum number of entries (default: 100)
   * @param offset Number of entries to skip (default: 0)
   */
  listFiles(syncStatus?: FileSyncStatus, limit?: number, offset?: number): Promise<FileCacheEntry[]>;

  /**
   * Count files by sync status (executed inside Worker).
   *
   * @param syncStatus Filter by sync status (optional)
   */
  countFiles(syncStatus?: FileSyncStatus): Promise<number>;

  /**
   * Batch sync all pending/failed files to S3 (executed inside Worker).
   *
   * Automatically called when the network comes back online.
   * Can also be called manually to trigger sync.
   *
   * @returns Statistics: number of files synced and failed, plus detailed file lists
   *          for per-file UI broadcast (syncedFiles, failedFiles)
   */
  syncPendingFiles(): Promise<{
    synced: number;
    failed: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }>;

  /**
   * Resume all interrupted multipart uploads.
   *
   * Scans for in-progress multipart uploads and attempts to resume them.
   * Called during initialization and on network recovery.
   *
   * P2-NEW-6 fix: Returns syncedFiles/failedFiles for per-file event broadcasting.
   *
   * @returns Statistics: number of uploads resumed, failed, expired, plus detailed file lists
   */
  resumeInterruptedUploads(): Promise<{
    resumed: number;
    failed: number;
    expired: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }>;

  /**
   * Get cache statistics: total files, total size, and breakdown by sync status.
   */
  getCacheStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    byStatus: {
      pending: { count: number; size: number };
      syncing: { count: number; size: number };
      synced: { count: number; size: number };
      failed: { count: number; size: number };
    };
  }>;

  /**
   * Update file metadata (filename, contentType) in the local cache (executed inside Worker).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param updates Partial metadata to update (filename and/or contentType)
   */
  updateFileMetadata(md5: string, ext: string, updates: { filename?: string; contentType?: string }): Promise<void>;
}
