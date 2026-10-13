import type { ContentData } from '@rtc-agent/protocol';
import type {
  ConnectionState,
  ConnectionStateEvent,
  HeadObjectResult,
} from '@rtc-agent/client';
import type {
  PersistenceConfig,
  AgentMdConfig,
  FileSystemMetadataOverride,
  UIUpdateQueueEntry,
  CachedFileInfo,
  FileCacheEntry,
  FileSyncStatus,
  GrepResult,
} from '@rtc-agent/persistence';
import type {
  UIUpdateEvent,
  LocalSession,
  LocalMessage,
  LocalRtc,
  DebugHistoryItem,
  PagedResult,
} from '@rtc-agent/persistence';

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
 *
 * CRITICAL: All callbacks may return void or Promise<void>. Comlink proxies always wrap
 * returns in Promises (even for void-returning functions), so WorkerCore must handle
 * both sync and async results for proper failure tracking.
 */
export interface WorkerCallbacks {
  onUIUpdate: (payload: UIUpdatePayload) => Promise<void> | void;
  requestToken: () => Promise<string>;
  requestTokenRefresh: () => Promise<'refresh' | 'relogin'>;
  onConnectionStateChange: (event: ConnectionStateEvent) => Promise<void> | void;
  onGapFillState: (isSyncing: boolean) => Promise<void> | void;
  /** Called when catch-up detects a gap in events (e.g., TTL cleanup deleted missed events). */
  onStateGap: () => Promise<void> | void;
  /** Called when the user's account is banned (disconnect code 4501). Required: ban is a security-critical event that must not be silently dropped. */
  onAccountBanned: (reason: string) => Promise<void> | void;
}

/**
 * WorkerPersistenceCore: the interface exposed by the Worker side.
 *
 * This is a composite interface built from smaller, focused sub-interfaces.
 * Each sub-interface groups related operations for better maintainability and documentation.
 *
 * Core responsibilities:
 * - init(): Initialize shared state (only the first Tab actually executes; subsequent calls are idempotent)
 * - registerCallback / unregisterCallback: manage per-Tab callbacks
 * - Other methods pass through to PersistenceLayer
 *
 * Interface composition:
 * - WorkerLifecycleOps: Tab lifecycle management (close, flush)
 * - WorkerConnectionOps: WebSocket connection management
 * - WorkerQueryOps: Read-only queries for sessions, messages, RTCs
 * - WorkerDebugOps: Debug history management
 * - WorkerOperationOps: Write operations (send message, submit result, etc.)
 * - WorkerVirtualFSOps: Virtual file system operations
 * - WorkerFileCacheOps: File cache and S3 operations
 */
export interface WorkerPersistenceCore
  extends WorkerLifecycleOps,
    WorkerConnectionOps,
    WorkerQueryOps,
    WorkerDebugOps,
    WorkerOperationOps,
    WorkerVirtualFSOps,
    WorkerFileCacheOps {
  /**
   * Initialize shared state in the Worker.
   *
   * Only the first Tab actually executes initialization; subsequent calls are idempotent.
   * Must be called after registerCallback() to ensure no events are missed during init.
   */
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
  getCatchUpEvents(
    fromSeq: number,
    limit?: number,
  ): Promise<{
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
}

/**
 * Tab lifecycle operations: managing the connection between a Tab and the SharedWorker.
 *
 * Reference counting ensures shared resources are only destroyed when the last Tab disconnects.
 */
export interface WorkerLifecycleOps {
  /**
   * Close this Tab's connection to the SharedWorker.
   *
   * Reference counting: only destroys shared resources if this is the last tab.
   *
   * @param callerCallback - Optional callback to remove before checking reference count.
   *                         Ensures cleanup even if unregisterCallback failed earlier.
   */
  close(callerCallback?: WorkerCallbacks): Promise<void>;

  /** Flush all pending writes to IndexedDB (used for graceful shutdown). */
  flushAll(): Promise<void>;
}

/**
 * WebSocket connection operations: managing the Centrifuge connection lifecycle.
 */
export interface WorkerConnectionOps {
  /** Establish WebSocket connection to the backend. */
  connect(): Promise<void>;

  /** Gracefully close the WebSocket connection. */
  disconnect(): void;

  /** Attempt to re-establish a lost connection. */
  reconnect(): Promise<void>;

  /** Get the current connection state (for UI indicators). */
  getConnectionState(): Promise<ConnectionState>;
}

/**
 * Read-only query operations: retrieving sessions, messages, and RTCs from IndexedDB.
 *
 * All queries are executed in the Worker (which shares IndexedDB with the main thread).
 */
export interface WorkerQueryOps {
  /** List sessions with cursor-based pagination. */
  listSessions(cursor?: string, limit?: number): Promise<LocalSession[]>;

  /** Get a single session by client ID. */
  getSession(clientId: string): Promise<LocalSession | undefined>;

  /** List messages for a session with cursor-based pagination. */
  listMessages(
    sessionClientId: string,
    cursor?: string,
    limit?: number,
    direction?: 'backward' | 'forward',
  ): Promise<LocalMessage[]>;

  /** Get a single message by client ID. */
  getMessage(clientId: string): Promise<LocalMessage | undefined>;

  /** List RTCs (tool calls) for a session. */
  listRtc(
    sessionClientId: string,
    cursor?: number,
    limit?: number,
  ): Promise<LocalRtc[]>;

  /** Get the next RTC pending processing (for worker loop). */
  getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined>;
}

/**
 * Debug history operations: managing the debug audit log.
 *
 * Debug history is persisted in IndexedDB and can be queried for troubleshooting.
 */
export interface WorkerDebugOps {
  /** Add an item to the debug history. */
  addDebugHistoryItem(item: DebugHistoryItem): Promise<void>;

  /** Query debug history with pagination and optional function filter. */
  queryDebugHistory(
    functionName?: string,
    cursor?: string,
    limit?: number,
  ): Promise<PagedResult<DebugHistoryItem>>;

  /** Count debug history items (optionally filtered by function). */
  countDebugHistory(functionName?: string): Promise<number>;

  /** Clear all debug history (for privacy/compliance). */
  clearDebugHistory(): Promise<void>;

  /** Batch-delete specific debug history items by ID. */
  batchDeleteDebugHistory(ids: string[]): Promise<void>;
}

/**
 * Write operations: sending messages, submitting results, managing sessions.
 *
 * These operations modify state in IndexedDB and may trigger backend RPCs.
 */
export interface WorkerOperationOps {
  /**
   * Send a message to the backend and persist it locally.
   *
   * Returns both the session and message for immediate UI updates.
   */
  sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }>;

  /**
   * Insert a local-only message (not sent to backend).
   *
   * Used for system messages, tool results, or optimistic UI updates.
   */
  insertLocalMessage(params: {
    sessionClientId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    creatorKind?: string;
    creatorRefId?: string;
  }): Promise<LocalMessage>;

  /** Stop the current turn (cancel ongoing backend processing). */
  stopTurn(sessionClientId: string): Promise<void>;

  /**
   * Close a session (notify backend to stop the turn loop).
   *
   * This is a graceful shutdown: the session remains in IndexedDB but is marked closed.
   */
  closeSession(sessionClientId: string): Promise<void>;

  /** Reopen a previously closed session. */
  openSession(sessionClientId: string): Promise<void>;

  /**
   * Compact a session (reduce context size by summarizing old messages).
   *
   * Optional customInstruction allows user-guided summarization.
   */
  compactSession(
    sessionClientId: string,
    customInstruction?: string,
  ): Promise<void>;

  /**
   * Submit the result of an RTC (tool call) to the backend.
   *
   * Triggers the next iteration of the agent loop.
   */
  submitRtcResult(params: {
    rtcClientId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): Promise<void>;

  /**
   * Fork a session (create a new session branched from an existing one).
   *
   * Used for "try again" or "branch conversation" features.
   */
  forkSession(params: {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    newMessageClientId: string;
    content: ContentData;
    limit?: number;
  }): Promise<{ session: LocalSession; message: LocalMessage }>;

  /**
   * Soft-delete a session (local optimistic update + async backend sync).
   *
   * The session is immediately removed from the UI, then deleted from the backend.
   * If the backend RPC fails, the session is restored locally.
   */
  deleteSession(sessionClientId: string): Promise<void>;

  /**
   * Update a session's title (local optimistic update + async backend sync).
   *
   * Similar to deleteSession: immediate local update, eventual backend consistency.
   */
  updateSessionTitle(sessionClientId: string, title: string): Promise<void>;

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
}

/**
 * Virtual file system operations: reading/writing files in IndexedDB-backed VirtualFS.
 *
 * All operations are executed in the Worker (which shares IndexedDB).
 * The main thread cannot directly access IndexedDB, so these are proxied via Comlink.
 */
export interface WorkerVirtualFSOps {
  /**
   * Read a virtual file.
   *
   * @param path - File path relative to VirtualFS root
   * @param offset - Byte offset to start reading (optional)
   * @param limit - Maximum bytes to read (optional)
   */
  virtualFSRead(path: string, offset?: number, limit?: number): Promise<string>;

  /**
   * Write a virtual file.
   *
   * @param path - File path relative to VirtualFS root
   * @param content - File content to write
   * @param mode - 'overwrite' (replace) or 'append' (add to end)
   * @param metadataOverride - Optional metadata updates (name, description, tags, etc.)
   * @returns Number of bytes written
   */
  virtualFSWrite(
    path: string,
    content: string,
    mode: 'overwrite' | 'append',
    metadataOverride?: FileSystemMetadataOverride,
  ): Promise<number>;

  /**
   * List directory contents.
   *
   * @param path - Directory path (omit for root)
   * @returns Array of file/directory names
   */
  virtualFSLs(path?: string): Promise<string[]>;

  /**
   * Search by file name (glob pattern).
   *
   * @param pattern - Glob pattern (e.g., "*.md", "docs/*.txt")
   * @param path - Base directory to search in (optional)
   * @returns Array of matching file paths
   */
  virtualFSFind(pattern: string, path?: string): Promise<string[]>;

  /**
   * Search file contents (regex).
   *
   * @param pattern - Regex pattern to search for
   * @param path - Base directory to search in (optional)
   * @param caseSensitive - Case-sensitive search (default: false)
   * @param maxResults - Maximum number of matches (optional)
   */
  virtualFSGrep(
    pattern: string,
    path?: string,
    caseSensitive?: boolean,
    maxResults?: number,
  ): Promise<GrepResult>;

  /**
   * Query files by type metadata field.
   *
   * Return type matches persistence package's FileSystemEntry;
   * Date fields are preserved as Date instances during Comlink transport.
   *
   * @param type - Type value to filter by (e.g., "function", "scenario")
   */
  virtualFSQueryByType(type: string): Promise<
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
  >;

  /**
   * Check if a file exists.
   *
   * @param path - File path to check
   */
  virtualFSExists(path: string): Promise<boolean>;

  /**
   * Delete a file.
   *
   * @param path - File path to delete
   */
  virtualFSRemove(path: string): Promise<void>;
}

/**
 * File cache and S3 operations: managing downloaded files and uploads.
 *
 * The file cache uses IndexedDB to store downloaded files locally,
 * reducing redundant S3 downloads and enabling offline access.
 *
 * Upload operations are asynchronous: files are first cached locally (pending),
 * then uploaded to S3 in the background (syncing -> synced).
 * Failed uploads can be retried automatically when the network recovers.
 */
export interface WorkerFileCacheOps {
  /**
   * Cache a downloaded file.
   *
   * @param md5 - File content MD5 hash (32 hex chars)
   * @param ext - File extension
   * @param blob - File content as Blob
   * @param contentType - MIME type
   * @param ttlMs - Time-to-live in milliseconds (default: 7 days)
   */
  cacheFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    ttlMs?: number,
  ): Promise<void>;

  /**
   * Cache a downloaded file with pending sync status.
   *
   * Similar to cacheFile but records the entry with syncStatus='pending',
   * meaning the file content is cached locally but not yet uploaded to S3.
   * Used for optimistic local caching before upload completes.
   *
   * @param md5 - File content MD5 hash (32 hex chars)
   * @param ext - File extension
   * @param blob - File content as Blob
   * @param contentType - MIME type
   * @param filename - Original filename (optional)
   */
  cacheFilePending(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    filename?: string,
  ): Promise<void>;

  /**
   * Get a cached file.
   *
   * Returns null if not found or expired.
   *
   * @param md5 - File content MD5 hash
   * @param ext - File extension
   */
  getCachedFile(md5: string, ext: string): Promise<CachedFileInfo | null>;

  /**
   * Evict all expired cache entries.
   *
   * @returns Number of entries evicted
   */
  evictExpiredCache(): Promise<number>;

  /**
   * Evict synced cache entries using LRU strategy.
   *
   * Only evicts files with syncStatus='synced'. Pending/failed/syncing files
   * are preserved to prevent data loss.
   *
   * @param targetBytes - Number of bytes to free (default: 100MB)
   * @returns Actual evicted count and bytes freed
   */
  evictCache(
    targetBytes?: number,
  ): Promise<{ evictedCount: number; evictedBytes: number }>;

  /**
   * Upload a file to S3.
   *
   * Directly uploads without checking existence (S3 handles overwrite idempotently).
   *
   * @param md5 - File content MD5 hash (32 hex chars)
   * @param ext - File extension
   * @param blob - File content as Blob
   * @param contentType - MIME type (optional)
   * @param filename - Original filename (optional)
   * @param operationId - Unique ID for cancellation (optional, generated by WorkerBridge)
   * @param onProgress - Progress callback (optional)
   * @param cacheTtlMs - Cache TTL in milliseconds (optional)
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
    cacheTtlMs?: number,
  ): Promise<{
    syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
    syncedAt?: number;
    errorMessage?: string;
  }>;

  /**
   * Download a file from S3 with local caching.
   *
   * Flow:
   * 1. Check local cache (returns if hit and not expired, unless forceRefresh=true)
   * 2. Download from S3 with deduplication
   * 3. Cache the downloaded file (TTL: 7 days)
   * 4. Return the file
   *
   * P2-NEW-4 fix: added forceRefresh parameter to bypass local cache
   *
   * @param md5 - File content MD5 hash
   * @param ext - File extension
   * @param onProgress - Progress callback for download (optional)
   * @param operationId - Unique ID for cancellation (optional, generated by WorkerBridge)
   * @param forceRefresh - If true, bypass local cache and download from S3 (optional)
   */
  downloadFile(
    md5: string,
    ext: string,
    onProgress?: (loaded: number, total: number) => void,
    operationId?: string,
    forceRefresh?: boolean,
  ): Promise<Blob>;

  /**
   * Cancel an ongoing file operation (upload or download) by its operationId.
   *
   * Called by WorkerBridge when an AbortSignal fires. The WorkerCore maintains
   * a map of operationId -> AbortController; calling this aborts the controller,
   * which propagates to the underlying HTTP request via the PersistenceLayer's signal.
   *
   * No-op if operationId is not found (e.g., operation already completed).
   *
   * @param operationId - Unique ID returned by WorkerBridge when starting the operation
   */
  cancelFileOperation(operationId: string): void;

  /**
   * Delete a file from local cache and S3.
   *
   * @param md5 - File content MD5 hash
   * @param ext - File extension
   */
  deleteFile(md5: string, ext: string): Promise<void>;

  /**
   * Calculate MD5 hash of a Blob.
   *
   * Runs in the Worker thread to avoid blocking the main thread.
   *
   * @param blob - Blob to calculate MD5 for
   * @returns Promise resolving to 32-character hex MD5 hash
   */
  calculateFileMD5(blob: Blob): Promise<string>;

  /**
   * Get file metadata from S3 without downloading.
   *
   * @param md5 - File content MD5 hash
   * @param ext - File extension
   * @returns HeadObjectResult with contentLength, contentType, lastModified, etag
   */
  headFile(md5: string, ext: string): Promise<HeadObjectResult>;

  /**
   * Get a presigned URL for file operations.
   *
   * @param operation - 'get' or 'put'
   * @param key - S3 object key
   * @param expiresIn - Expiration time in seconds (optional)
   * @returns Presigned URL string
   */
  getPresignedUrl(
    operation: 'get' | 'put',
    key: string,
    expiresIn?: number,
  ): Promise<string>;

  /**
   * List files by sync status.
   *
   * @param syncStatus - Filter by sync status (optional)
   * @param limit - Maximum number of entries (default: 100)
   * @param offset - Number of entries to skip (default: 0)
   */
  listFiles(
    syncStatus?: FileSyncStatus,
    limit?: number,
    offset?: number,
  ): Promise<FileCacheEntry[]>;

  /**
   * Count files by sync status.
   *
   * @param syncStatus - Filter by sync status (optional)
   */
  countFiles(syncStatus?: FileSyncStatus): Promise<number>;

  /**
   * Batch sync all pending/failed files to S3.
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
   * Update file metadata (filename, contentType) in the local cache.
   *
   * @param md5 - File content MD5 hash
   * @param ext - File extension
   * @param updates - Partial metadata to update (filename and/or contentType)
   */
  updateFileMetadata(
    md5: string,
    ext: string,
    updates: { filename?: string; contentType?: string },
  ): Promise<void>;
}
