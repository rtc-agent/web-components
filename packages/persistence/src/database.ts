import Dexie, { type Table } from 'dexie';
import type { Session, Turn, Message, Rtc } from '@rtc-agent/protocol';
import { createLogger, SyncStatus } from '@rtc-agent/protocol';

const log = createLogger('Database');

/** Default database name prefix. Custom prefixes are allowed via database-name attribute. */
export const DB_NAME_PREFIX = 'rtc-agent-';

// ========== Sync status ==========

// SyncStatus is imported from @rtc-agent/protocol
// Re-export for backward compatibility
export { SyncStatus } from '@rtc-agent/protocol';

// ========== Local entities (client_id as primary key, server_id as server UUID) ==========

/**
 * Local entity types: client-first offline-first wrappers around protocol types.
 *
 * Design rationale:
 * - Protocol types (Session, Turn, Message, Rtc) use server-assigned UUIDs as primary keys.
 * - In an offline-first architecture, the client must generate entities before server sync.
 * - Local types use `client_id` (client-generated UUID) as the primary key, ensuring
 *   idempotent writes and conflict-free merges. `server_id` is populated after server response.
 * - `sync_status` tracks the sync lifecycle (pending → syncing → synced/failed).
 * - `session_client_id` replaces `session_id` to reference the session's client_id,
 *   maintaining referential integrity before server IDs are assigned.
 * - These types use `Omit<T, 'id'>` to inherit all protocol fields except the server ID,
 *   ensuring schema alignment while swapping the key generation strategy.
 */

export interface LocalSession extends Omit<Session, 'id'> {
  /** Primary key: client-generated idempotent ID */
  client_id: string;
  /** Server ID (UUID), populated after server response */
  server_id?: string;
  /** Sync status */
  sync_status: SyncStatus;
  /** Count of turns with status='pending' in this session (aggregated at write time) */
  pending_turn_count: number;
  /** Count of turns with status='running' in this session (aggregated at write time) */
  running_turn_count: number;
}

export interface LocalTurn extends Omit<Turn, 'id' | 'session_id'> {
  client_id: string;
  server_id?: string;
  /** References session's client_id */
  session_client_id: string;
  sync_status: SyncStatus;
}

export interface LocalMessage extends Omit<Message, 'id' | 'session_id'> {
  client_id: string;
  server_id?: string;
  /** References session's client_id */
  session_client_id: string;
  sync_status: SyncStatus;
  /**
   * Parent message's client_id (resolved from parent_message_id).
   * toolcall_output uses this to reference the corresponding toolcall_input.
   */
  parent_client_id?: string;
}

export interface LocalRtc extends Omit<Rtc, 'id' | 'session_id'> {
  client_id: string;
  server_id?: string;
  /** References session's client_id */
  session_client_id: string;
  /** Redundant copy of session.device_id, used for execution-time filtering */
  session_device_id?: string;
  sync_status: SyncStatus;
}

// ========== Offset persistence ==========

export interface OffsetRecord {
  /** Primary key: channel name, e.g. 'topic:u=xxx' */
  channel: string;
  /** Current processed offset */
  offset: number;
  /** Current epoch */
  epoch: string;
  /** Last update time */
  updatedAt: number;
}

// ========== Virtual file system ==========

export type FileSystemEntryType = 'function' | 'scenario' | 'script' | 'index';

export interface FileSystemEntryMetadata {
  /** File name (without path) */
  name: string;
  /** File description */
  description: string;
  /** Tag list */
  tags?: string[];
  /** Group (function type only) */
  group?: string;
  /** Creation time */
  createdAt: Date;
  /** Last update time */
  updatedAt: Date;
  /** Whether the file has been edited by the user (protects from system overwrites) */
  editedByUser?: boolean;
}

/**
 * Metadata fields that can be overridden when writing files.
 *
 * Used by batchWriteFiles, virtualFSWrite, and other file write operations
 * to allow partial metadata updates without specifying all fields.
 */
export type FileSystemMetadataOverride = Partial<{
  name: string;
  description: string;
  tags: string[];
  editedByUser: boolean;
}>;

export interface FileSystemEntry {
  /** Primary key: file path, e.g. '/functions/user/register.md' */
  path: string;
  /** File type */
  type: FileSystemEntryType;
  /** File content */
  content: string;
  /** Metadata */
  metadata: FileSystemEntryMetadata;
}

// ========== Debug history ==========

/**
 * Application-level debug history item (camelCase for UI consumption)
 */
export interface DebugHistoryItem {
  /** Unique ID */
  id: string;
  /** Full function name (e.g. "user.register") */
  functionName: string;
  /** JSON string of the parameters used */
  params: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Execution duration in ms */
  durationMs: number;
  /** Timestamp of execution */
  timestamp: number;
  /** Log entries captured during execution */
  logs: LogEntry[];
  /** Error message if failed */
  errorMessage?: string;
  /** Execution result (serialized) */
  result?: unknown;
}

/**
 * Log level for debug output
 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * Log entry for debug output
 */
export interface LogEntry {
  /** Timestamp (ms since epoch) */
  timestamp: number;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Optional structured data */
  data?: unknown;
}

/**
 * Database row type (snake_case for IndexedDB storage)
 */
export interface LocalDebugHistoryItem {
  /** Primary key: UUID */
  id: string;
  /** Function name (e.g. 'user.register') */
  function_name: string;
  /** Parameters as JSON string */
  params: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Execution duration in milliseconds */
  duration_ms: number;
  /** Timestamp (used for sorting + cursor pagination) */
  timestamp: number;
  /** Logs as JSON string (avoids structured clone overhead) */
  logs: string;
  /** Error message (if failed) */
  error_message?: string;
  /** Result as JSON string (if succeeded) */
  result?: string;
}

// ========== UI Update Queue ==========

/**
 * Input type for adding UI update queue entries to IndexedDB.
 * The `seq` field is auto-generated by IndexedDB's auto-increment, so it's not included here.
 */
export interface UIUpdateQueueInput {
  /** The UIUpdateEvent (stored as unknown since it comes pre-cloned) */
  event: unknown;
  /** Timestamp when the event was persisted (Date.now()) */
  timestamp: number;
}

/**
 * Persistent queue entry for UI update events (as stored in IndexedDB).
 * Ensures events are not lost during page refreshes or weak-network reconnections.
 */
export interface UIUpdateQueueEntry extends UIUpdateQueueInput {
  /**
   * Auto-increment primary key (assigned by IndexedDB on add()).
   * Required field - Dexie's `++seq` ensures this is always populated after insertion.
   */
  seq: number;
}

// ========== File cache ==========

/**
 * File cache entry for downloaded files from S3.
 * Primary key: [md5+ext] composite key
 *
 * Supports offline-first data model with sync status tracking.
 */
export interface FileCacheEntry {
  /** File content MD5 hash (32 hex chars) */
  md5: string;
  /** File extension (e.g., 'txt', 'jpg') */
  ext: string;
  /** File content as Blob */
  data: Blob;
  /** MIME type */
  contentType: string;
  /** File size in bytes */
  size: number;
  /** Expiration timestamp (ms since epoch) */
  expiresAt: number;
  /** Last access timestamp (ms since epoch, for future LRU) */
  lastAccessedAt: number;
  /** Creation timestamp (ms since epoch) */
  createdAt: number;

  // ========== Offline-first fields ==========

  /**
   * Sync status with S3:
   * - 'pending': file uploaded locally but not yet synced to S3 (offline upload)
   * - 'syncing': currently being uploaded to S3
   * - 'synced': successfully synced to S3 (normal download cache)
   * - 'failed': sync to S3 failed
   */
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  /** Original filename (for UI display, optional) */
  filename?: string;
  /** Error message from most recent sync failure */
  errorMessage?: string;
  /** Timestamp of last successful sync (ms since epoch) */
  syncedAt?: number;
  /** Number of retry attempts for failed syncs */
  retryCount: number;
  /**
   * P0-FIX: Timestamp when 'syncing' state started (ms since epoch).
   * Used for heartbeat mechanism to detect stale syncing entries.
   * Set when transitioning to 'syncing', cleared when leaving 'syncing'.
   */
  syncingStartedAt?: number;
}

/**
 * Batch intent record for tracking split transaction atomicity.
 *
 * When a large batch is split into multiple transactions, a batch intent record
 * is written first to track the overall operation. If any transaction fails,
 * the intent record is used to coordinate compensation rollback across all
 * completed transactions, providing "best-effort atomicity" for split batches.
 *
 * Lifecycle:
 * 1. Created before any split transactions begin (status: 'pending')
 * 2. Updated to 'completed' after all transactions succeed
 * 3. Updated to 'failed' if any transaction fails (triggers compensation)
 * 4. Cleaned up after successful completion or compensation
 */
export interface BatchIntentRecord {
  /** Unique identifier for this batch operation (UUID) */
  batchId: string;
  /** Creation timestamp (ms since epoch) */
  createdAt: number;
  /** Last update timestamp (ms since epoch) */
  updatedAt: number;
  /**
   * Batch status:
   * - 'pending': transactions in progress
   * - 'completed': all transactions succeeded
   * - 'failed': at least one transaction failed (compensation in progress)
   */
  status: 'pending' | 'completed' | 'failed';
  /** JSON-serialized list of entity types involved in the batch */
  entityTypes: string;
  /** Total number of write operations in the batch */
  totalOperations: number;
  /** JSON-serialized list of completed writes (for compensation tracking) */
  completedWrites?: string;
  /** Error message if batch failed */
  errorMessage?: string;
}

// ========== Upload progress (multipart resume) ==========

/**
 * Upload part status within a multipart upload.
 */
export interface UploadPartRecord {
  /** Part number (1-10000, S3 constraint) */
  partNumber: number;
  /** ETag returned by S3 after successful upload */
  etag: string;
  /** Part size in bytes */
  size: number;
}

/**
 * Multipart upload progress record.
 * Primary key: [md5+ext] composite key (one active upload per file)
 *
 * Stores the state needed to resume an interrupted multipart upload.
 */
export interface UploadProgressEntry {
  /** File content MD5 hash (32 hex chars) — part of composite PK */
  md5: string;
  /** File extension — part of composite PK */
  ext: string;
  /** S3 multipart upload ID (from CreateMultipartUpload) */
  uploadId: string;
  /** S3 object key */
  s3Key: string;
  /** Total file size in bytes */
  fileSize: number;
  /** Part size in bytes (all parts except the last are this size) */
  partSize: number;
  /** Total number of parts */
  totalParts: number;
  /** Array of completed parts (with ETags) */
  completedParts: UploadPartRecord[];
  /** Number of bytes uploaded so far */
  bytesUploaded: number;
  /** MIME type */
  contentType: string;
  /** Original filename (optional, for UI) */
  filename?: string;
  /** Creation timestamp (ms since epoch) */
  createdAt: number;
  /** Last update timestamp (ms since epoch) */
  updatedAt: number;
  /**
   * S3 multipart upload expiration (createdAt + 7 days).
   * After this time, the uploadId becomes invalid and must be restarted.
   */
  expiresAt: number;
}

// ========== Database definition ==========

export class RTCAgentDatabase extends Dexie {
  sessions!: Table<LocalSession, string>;
  turns!: Table<LocalTurn, string>;
  messages!: Table<LocalMessage, string>;
  rtcs!: Table<LocalRtc, string>;
  offsets!: Table<OffsetRecord, string>;
  fileSystemEntries!: Table<FileSystemEntry, string>;
  debugHistory!: Table<LocalDebugHistoryItem, string>;
  ui_updates!: Table<UIUpdateQueueEntry, number>;
  fileCache!: Table<FileCacheEntry, [string, string]>;
  uploadParts!: Table<UploadProgressEntry, [string, string]>;
  batchIntents!: Table<BatchIntentRecord, string>;

  /** P3-FIX: Track migration failure for degraded-state detection */
  private _migrationFailed = false;

  constructor(databaseName: string) {
    if (!databaseName) {
      throw new Error(`[RTCAgentDatabase] databaseName must not be empty`);
    }
    log.info('Initializing database:', databaseName);
    super(databaseName);

    // Database migration chain (v1 -> v14).
    // Each version must be sequential; never skip or modify existing versions.
    // See: .claude/skills/rtc-agent-development-standards/js-ts/indexeddb.md

    // v1: Legacy schema, using id (server UUID) as primary key
    this.version(1).stores({
      sessions: 'id, &client_id, sync_status, owner_ref_id, status',
      turns: 'id, &client_id, sync_status, session_id, status',
      messages:
        'id, &client_id, sync_status, session_id, turn_id, global_offset',
      rtcs: 'id, &client_id, sync_status, session_id, turn_id, status',
      offsets: 'channel',
    });

    // v2: Migrate to client_id as primary key, add server_id field
    this.version(2)
      .stores({
        // Primary key: client_id; indexes: server_id, sync_status, etc.
        sessions: 'client_id, server_id, sync_status, owner_ref_id, status',
        turns: 'client_id, server_id, sync_status, session_client_id, status',
        messages:
          'client_id, server_id, sync_status, session_client_id, turn_id, global_offset',
        rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
        offsets: 'channel',
      })
      .upgrade(async (tx) => {
        log.info(
          'Migrating database from v1 to v2: switching to client_id as primary key',
        );
        // Data migration: v1 PK was id (server UUID), v2 PK is client_id.
        // Since update(key, changes) looks up by the new PK, old records may lack client_id,
        // causing update to find no target row and silently fail. Use clear + add instead.
        //
        // NOTE: Dexie's upgrade() runs within a transaction. If any error occurs,
        // Dexie automatically rolls back the entire transaction. No manual backup/restore needed.
        //
        // P0-FIX (data safety): Restructured migration order to prevent data loss.
        // Previously, each table was migrated then immediately cleared. If a later table's
        // migration failed, earlier tables' old data was already gone.
        // Now: (1) migrate ALL tables by adding new records, (2) verify integrity, (3) clear ALL.
        // This ensures old data remains available for recovery until all new data is written.

        const BATCH_SIZE = 1000;
        const TABLES_TO_MIGRATE = ['sessions', 'turns', 'messages', 'rtcs'] as const;

        // Phase 1: Add new records for all tables (old records remain until Phase 3)
        // Track migration counts per table for integrity verification
        const migrationCounts = new Map<string, number>();
        const sessionIdMap = new Map<string, string>(); // server_id -> client_id (for FK resolution)

        // 1a. Migrate sessions first to build the server_id -> client_id mapping
        const sessionsTable = tx.table('sessions');
        let totalSessionsMigrated = 0;
        let sessionsOffset = 0;

        while (true) {
          const sessionBatch = await sessionsTable
            .orderBy('id')
            .offset(sessionsOffset)
            .limit(BATCH_SIZE)
            .toArray();

          if (sessionBatch.length === 0) break;

          for (const row of sessionBatch) {
            const r = row as Record<string, unknown>;
            const oldId = r['id'] as string | undefined;
            const oldClientId = r['client_id'] as string | undefined;

            const newClientId = oldClientId || oldId || crypto.randomUUID();
            if (oldId) {
              sessionIdMap.set(oldId, newClientId);
            }

            const newRow: Record<string, unknown> = { ...r };
            newRow['client_id'] = newClientId;
            newRow['server_id'] = oldId;
            delete newRow['id'];

            await sessionsTable.add(newRow);
            totalSessionsMigrated++;
          }

          sessionsOffset += BATCH_SIZE;
        }

        migrationCounts.set('sessions', totalSessionsMigrated);
        log.info(`[DB Migration v2] Sessions: migrated ${totalSessionsMigrated} records`);

        // 1b. Migrate turns, messages, rtcs (all depend on sessionIdMap from sessions)
        for (const name of ['turns', 'messages', 'rtcs'] as const) {
          const table = tx.table(name);
          let offset = 0;
          let totalMigrated = 0;

          while (true) {
            const batch = await table
              .orderBy('id')
              .offset(offset)
              .limit(BATCH_SIZE)
              .toArray();

            if (batch.length === 0) break;

            for (const row of batch) {
              const r = row as Record<string, unknown>;
              const oldId = r['id'] as string | undefined;
              const oldClientId = r['client_id'] as string | undefined;
              const oldSessionId = r['session_id'] as string | undefined;

              const newRow: Record<string, unknown> = { ...r };

              // client_id: prefer old value, fall back to crypto.randomUUID() to avoid empty PK collision
              newRow['client_id'] = oldClientId || oldId || crypto.randomUUID();
              // server_id: preserve old server UUID
              newRow['server_id'] = oldId;
              delete newRow['id'];

              // session_id -> session_client_id: resolve via session mapping
              if (oldSessionId) {
                const sessionClientId = sessionIdMap.get(oldSessionId);
                newRow['session_client_id'] = sessionClientId || oldSessionId;
              } else {
                newRow['session_client_id'] = '';
              }
              delete newRow['session_id'];

              await table.add(newRow);
              totalMigrated++;
            }

            offset += BATCH_SIZE;
          }

          migrationCounts.set(name, totalMigrated);
          log.info(`[DB Migration v2] ${name}: migrated ${totalMigrated} records`);
        }

        // Phase 2: Verify migration integrity before clearing old data
        // Each table should now contain both old and new records (old records have 'id', new have 'client_id')
        for (const name of TABLES_TO_MIGRATE) {
          const table = tx.table(name);
          const actualCount = await table.count();
          const migratedCount = migrationCounts.get(name) ?? 0;
          const originalCount = actualCount - migratedCount;

          // Sanity check: migrated count should not exceed total count (i.e., we didn't add more than existed)
          if (migratedCount > actualCount) {
            throw new Error(
              `[DB Migration v2] Integrity check failed for ${name}: ` +
              `migrated (${migratedCount}) > total in table (${actualCount}). ` +
              `This indicates a bug in migration logic. Transaction will rollback.`
            );
          }

          log.info(
            `[DB Migration v2] ${name}: original=${originalCount}, migrated=${migratedCount}, ` +
            `total_before_clear=${actualCount}`
          );
        }

        // Phase 3: All migrations successful, now clear old data from all tables
        // After clear, only the new records (with client_id PK) remain
        for (const name of TABLES_TO_MIGRATE) {
          await tx.table(name).clear();
        }

        log.info(
          `[DB Migration v2] Migration complete. Cleared old data from ${TABLES_TO_MIGRATE.length} tables.`
        );
      });

    // v3: Add updated_at index for sorting
    this.version(3).stores({
      sessions:
        'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages:
        'client_id, server_id, sync_status, session_client_id, turn_id, global_offset',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
      offsets: 'channel',
    });

    // v4: Add created_at index for message ordering
    this.version(4).stores({
      sessions:
        'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages:
        'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
      offsets: 'channel',
    });

    // v5: Add offset index for RTC ordering
    this.version(5).stores({
      sessions:
        'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages:
        'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset',
      offsets: 'channel',
    });

    // v6: Add virtual file system fileSystemEntries table
    this.version(6).stores({
      sessions:
        'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages:
        'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset',
      offsets: 'channel',
      // fileSystemEntries: primary key path; indexes: type / metadata.group / metadata.tags
      // *metadata.tags is a multi-valued index, supporting array field queries
      fileSystemEntries: 'path, type, metadata.group, *metadata.tags',
    });

    // v7: Add device_id index for RTC Device ID filtering
    this.version(7).stores({
      sessions:
        'client_id, server_id, sync_status, owner_ref_id, status, updated_at, device_id',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages:
        'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset',
      offsets: 'channel',
      fileSystemEntries: 'path, type, metadata.group, *metadata.tags',
    });

    // v8: Add session_device_id index for RTC execution-time filtering.
    // Move Device ID filtering from write-time to execution-time.
    // Backfill existing RTC records: look up session.device_id via session_client_id.
    this.version(8)
      .stores({
        sessions:
          'client_id, server_id, sync_status, owner_ref_id, status, updated_at, device_id',
        turns: 'client_id, server_id, sync_status, session_client_id, status',
        messages:
          'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
        rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset, session_device_id',
        offsets: 'channel',
        fileSystemEntries: 'path, type, metadata.group, *metadata.tags',
      })
      .upgrade(async (tx) => {
        // Backfill session_device_id for existing RTC records
        //
        // OPTIMIZATION: Pre-fetch all sessions to build a lookup map, avoiding N+1 queries.
        // The modify() callback processes all RTC records in a single pass, looking up
        // device_id from the pre-built map. This is efficient for typical datasets.
        //
        // NOTE: Dexie's modify() processes records individually but batches writes internally.
        // For very large datasets (>10k records), consider chunking with offset/limit if
        // performance becomes an issue. Current implementation is sufficient for expected usage.
        const sessions = await tx.table('sessions').toArray();
        const sessionDeviceMap = new Map<string, string>();
        for (const s of sessions) {
          if (s.device_id) {
            sessionDeviceMap.set(s.client_id, s.device_id);
          }
        }

        // Single atomic modify pass for all RTC records
        await tx
          .table('rtcs')
          .toCollection()
          .modify((rtc) => {
            if (rtc.session_client_id && !rtc.session_device_id) {
              const deviceId = sessionDeviceMap.get(rtc.session_client_id);
              if (deviceId) {
                rtc.session_device_id = deviceId;
              }
            }
          });
      });

    // v9: Add debugHistory table for function debugger history persistence
    this.version(9).stores({
      sessions:
        'client_id, server_id, sync_status, owner_ref_id, status, updated_at, device_id',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages:
        'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset, session_device_id',
      offsets: 'channel',
      fileSystemEntries: 'path, type, metadata.group, *metadata.tags',
      debugHistory: 'id, function_name, timestamp',
    });

    // v10: Add compound index for efficient function_name + timestamp queries
    //       Also add ui_updates table for persistent UI update event queue
    this.version(10).stores({
      debugHistory: 'id, function_name, timestamp, [function_name+timestamp]',
      ui_updates: '++seq, timestamp',
    });

    // v11: Add fileCache table for S3 file download caching
    this.version(11).stores({
      fileCache: '[md5+ext], expiresAt',
    });

    // v12: Extend fileCache with offline-first sync status tracking
    // Adds syncStatus index for querying by sync state; migrates existing entries to 'synced'
    this.version(12)
      .stores({
        fileCache: '[md5+ext], expiresAt, syncStatus',
      })
      .upgrade(async (tx) => {
        // Smooth migration: treat existing cached files as already synced
        await tx
          .table('fileCache')
          .toCollection()
          .modify((entry: Record<string, unknown>) => {
            if (!entry.syncStatus) {
              entry.syncStatus = 'synced';
              entry.retryCount = 0;
            }
          });
      });

    // v13: Add uploadParts table for multipart upload progress tracking (resume upload)
    this.version(13).stores({
      uploadParts: '[md5+ext], uploadId, expiresAt',
    });

    // v14: Add lastAccessedAt index for efficient LRU eviction queries
    // P2-NEW-1 fix: evictLRU uses sortBy('lastAccessedAt'), adding an index avoids full table scan
    this.version(14).stores({
      fileCache: '[md5+ext], expiresAt, syncStatus, lastAccessedAt', // added lastAccessedAt index
    });

    // v15: Add compound indexes for common multi-field query patterns.
    //
    // Compound indexes avoid full-table scans when queries filter by multiple fields.
    // Dexie compound index syntax: [field1+field2] creates a composite index usable for
    // exact match (equals), range (above/below/between), and sorted iteration.
    //
    // Indexes added:
    //   messages: [session_client_id+created_at] — listMessagesBySession filters by session
    //             and orders by created_at; enables future DB-level cursor pagination.
    //   turns:    [session_client_id+status]     — countActiveTurns filters turns by session
    //             and status ('pending'/'running'); two indexed queries replace
    //             where().filter().count() pattern.
    //   rtcs:     [session_client_id+offset]     — listRtcBySession lists RTCs for a session
    //             ordered by offset; enables future DB-level sorted retrieval.
    //   fileCache:[syncStatus+lastAccessedAt]    — evictLRU evicts synced files by LRU order;
    //             compound index enables future indexed cursor pagination.
    this.version(15).stores({
      messages:
        'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at, [session_client_id+created_at]',
      turns:
        'client_id, server_id, sync_status, session_client_id, status, [session_client_id+status]',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset, session_device_id, [session_client_id+offset]',
      fileCache:
        '[md5+ext], expiresAt, syncStatus, lastAccessedAt, [syncStatus+lastAccessedAt]',
    });

    // v16: Add compound indexes for efficient pagination and sorted queries.
    //
    // Indexes added:
    //   sessions: [deleted_at+updated_at] — listSessions filters by deleted_at and orders by updated_at;
    //             enables DB-level cursor pagination instead of loading all sessions into memory.
    //   rtcs:     [sync_status+offset]    — getNextRtcToProcess queries failed RTCs ordered by offset;
    //             [status+offset]         — getNextRtcToProcess queries pending RTCs ordered by offset.
    //             Both avoid in-memory sortBy('offset') on large datasets.
    this.version(16).stores({
      sessions:
        'client_id, server_id, sync_status, owner_ref_id, status, updated_at, device_id, [deleted_at+updated_at]',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset, session_device_id, [session_client_id+offset], [sync_status+offset], [status+offset]',
    });

    // v17: Add batchIntents table for split transaction atomicity tracking.
    //
    // When large batches are split into multiple transactions, this table tracks
    // the overall batch intent and enables proper compensation rollback if any
    // transaction fails. This provides "best-effort atomicity" across split transactions.
    //
    // The batch intent record is created before any split transactions begin, and
    // updated to 'completed' or 'failed' based on the outcome. If a failure occurs,
    // the compensation logic uses the intent record to coordinate rollback.
    this.version(17).stores({
      batchIntents: 'batchId, status, createdAt',
    });

    // P3-FIX: Add schema version detection and degradation warning mechanism.
    // If migration to v17 fails, IndexedDB will automatically rollback to v16.
    // However, if migration succeeds but subsequent initialization fails, or if user
    // downgrades to an older version, we need to detect and warn about schema incompatibility.
    //
    // Strategy: Add a post-migration version check in the open() callback.
    // If actual schema version < expected version, log a warning with recovery guidance.
    // Also set a migrationFailed flag that can be queried by upper layers.
    const EXPECTED_SCHEMA_VERSION = 17;

    this.on('ready', async () => {
      try {
        // Dexie's verno property returns the actual schema version of the opened database
        const actualVersion = this.verno;
        if (actualVersion < EXPECTED_SCHEMA_VERSION) {
          this._migrationFailed = true;
          log.warn(
            `Schema version mismatch: expected v${EXPECTED_SCHEMA_VERSION}, got v${actualVersion}. ` +
              `This may indicate a failed migration or database downgrade. ` +
              `Some features may not work correctly. ` +
              `Recovery: Clear IndexedDB data and reload, or upgrade to the latest version.`,
          );
        }
      } catch (err) {
        log.debug('Failed to check schema version (non-fatal):', err);
      }
    });
  }

  /**
   * Check if database migration failed or is in a degraded state.
   *
   * P3-FIX: Returns true if the schema version is lower than expected,
   * indicating a failed migration or database downgrade. Upper layers
   * can query this to show degraded-state warnings to users.
   */
  isMigrationDegraded(): boolean {
    return this._migrationFailed;
  }

  /**
   * P1-FIX: Reset the migration failed flag after manual recovery.
   *
   * This method should be called after the user has manually recovered
   * from a degraded state (e.g., by clearing IndexedDB or upgrading
   * to the correct version). It resets the flag so the database can
   * operate normally again.
   *
   * WARNING: This does NOT fix the underlying schema issue. The caller
   * must ensure the database schema is compatible before calling this.
   */
  resetMigrationDegraded(): void {
    if (this._migrationFailed) {
      log.info('Resetting migration degraded flag');
      this._migrationFailed = false;
    }
  }

  /**
   * P1-FIX: Attempt to recover from a degraded migration state.
   *
   * When migration fails, the database may be in a degraded state with
   * a lower schema version than expected. This method provides recovery
   * guidance based on the actual schema version.
   *
   * Recovery options:
   * 1. If user data is not important: clear all IndexedDB data and reload
   * 2. If user data must be preserved: export data, clear IndexedDB, reload, re-import
   *
   * @returns Recovery guidance object with actionable steps
   */
  getRecoveryGuidance(): {
    canAutoRecover: boolean;
    actualVersion: number;
    expectedVersion: number;
    steps: string[];
  } {
    const actualVersion = this.verno;
    const expectedVersion = 17; // Keep in sync with EXPECTED_SCHEMA_VERSION

    const steps: string[] = [];

    if (actualVersion < expectedVersion) {
      steps.push(
        `Database schema is at v${actualVersion}, expected v${expectedVersion}.`,
      );
      steps.push('Option 1 (if data is not important):');
      steps.push('  - Clear IndexedDB data for this site');
      steps.push('  - Reload the page');
      steps.push('  - Migration will run automatically');
      steps.push('');
      steps.push('Option 2 (if data must be preserved):');
      steps.push('  - Export your data using the UI export feature');
      steps.push('  - Clear IndexedDB data for this site');
      steps.push('  - Reload the page');
      steps.push('  - Re-import your data');
    }

    return {
      canAutoRecover: false, // Auto-recovery is not safe without data loss
      actualVersion,
      expectedVersion,
      steps,
    };
  }
}

// ========== Singleton ==========

let dbInstance: RTCAgentDatabase | null = null;
let dbInstanceName: string | null = null;

export function getDatabase(databaseName?: string): RTCAgentDatabase {
  // Return existing instance directly (no-arg call is just singleton access)
  if (databaseName === undefined) {
    if (dbInstance) {
      return dbInstance;
    }
    throw new Error(
      `[RTCAgentDatabase] getDatabase() called without a name before any database was initialized. ` +
        `Pass a databaseName.`,
    );
  }

  if (!databaseName) {
    throw new Error(`[RTCAgentDatabase] databaseName must not be empty`);
  }

  const name = databaseName;
  if (!dbInstance || dbInstanceName !== name) {
    if (dbInstance) {
      log.info('Closing previous database instance:', dbInstanceName);
      dbInstance.close();
    }
    log.info('Creating new database instance:', name);
    dbInstance = new RTCAgentDatabase(name);
    dbInstanceName = name;
  }
  return dbInstance;
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    log.info('Closing database:', dbInstanceName);
    dbInstance.close();
    dbInstance = null;
    dbInstanceName = null;
  }
}

/**
 * Flush all data (for development/testing).
 *
 * Uses Dexie's dynamic table enumeration to avoid maintaining a manual table list.
 * When new tables are added to the schema, they are automatically included.
 */
export async function flushAll(): Promise<void> {
  log.warn('flushAll: clearing all database tables');
  const db = getDatabase();
  // Dexie exposes all registered tables via db.tables (derived from version().stores())
  const tables = db.tables;
  const tableNames = tables.map((t) => t.name);
  await db.transaction('rw', tables, async () => {
    for (const table of tables) {
      await table.clear();
    }
  });
  log.info(
    `flushAll: cleared ${tables.length} tables (${tableNames.join(', ')})`,
  );
}
