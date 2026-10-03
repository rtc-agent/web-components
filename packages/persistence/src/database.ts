import Dexie, { type Table } from 'dexie';
import type { Session, Turn, Message, Rtc } from '@rtc-agent/protocol';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('Database');

/** Default database name prefix. Custom prefixes are allowed via database-name attribute. */
export const DB_NAME_PREFIX = 'rtc-agent-';

// ========== Sync status ==========

export type SyncStatus = 'pending' | 'synced' | 'failed';

// ========== Local entities (client_id as primary key, server_id as server UUID) ==========

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

  constructor(databaseName: string) {
    if (!databaseName) {
      throw new Error(
        `[RTCAgentDatabase] databaseName must not be empty`
      );
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
      messages: 'id, &client_id, sync_status, session_id, turn_id, global_offset',
      rtcs: 'id, &client_id, sync_status, session_id, turn_id, status',
      offsets: 'channel',
    });

    // v2: Migrate to client_id as primary key, add server_id field
    this.version(2)
      .stores({
        // Primary key: client_id; indexes: server_id, sync_status, etc.
        sessions: 'client_id, server_id, sync_status, owner_ref_id, status',
        turns: 'client_id, server_id, sync_status, session_client_id, status',
        messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset',
        rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
        offsets: 'channel',
      })
      .upgrade(async (tx) => {
        log.info('Migrating database from v1 to v2: switching to client_id as primary key');
        // Data migration: v1 PK was id (server UUID), v2 PK is client_id.
        // Since update(key, changes) looks up by the new PK, old records may lack client_id,
        // causing update to find no target row and silently fail. Use clear + add instead.

        // 1. Migrate sessions table first, building server_id -> client_id mapping
        //    (other tables need to reference session by client_id)
        const sessionsTable = tx.table('sessions');
        const allSessions = await sessionsTable.toArray();
        await sessionsTable.clear();

        const sessionIdMap = new Map<string, string>(); // server_id -> client_id

        for (const row of allSessions) {
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
        }

        // 2. Migrate other tables (turns/messages/rtcs)
        for (const name of ['turns', 'messages', 'rtcs'] as const) {
          const table = tx.table(name);
          const allRows = await table.toArray();
          await table.clear();

          for (const row of allRows) {
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
          }
        }
      });

    // v3: Add updated_at index for sorting
    this.version(3).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
      offsets: 'channel',
    });

    // v4: Add created_at index for message ordering
    this.version(4).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
      offsets: 'channel',
    });

    // v5: Add offset index for RTC ordering
    this.version(5).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset',
      offsets: 'channel',
    });

    // v6: Add virtual file system fileSystemEntries table
    this.version(6).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset',
      offsets: 'channel',
      // fileSystemEntries: primary key path; indexes: type / metadata.group / metadata.tags
      // *metadata.tags is a multi-valued index, supporting array field queries
      fileSystemEntries: 'path, type, metadata.group, *metadata.tags',
    });

    // v7: Add device_id index for RTC Device ID filtering
    this.version(7).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at, device_id',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset',
      offsets: 'channel',
      fileSystemEntries: 'path, type, metadata.group, *metadata.tags',
    });

    // v8: Add session_device_id index for RTC execution-time filtering.
    // Move Device ID filtering from write-time to execution-time.
    // Backfill existing RTC records: look up session.device_id via session_client_id.
    this.version(8).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at, device_id',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset, session_device_id',
      offsets: 'channel',
      fileSystemEntries: 'path, type, metadata.group, *metadata.tags',
    }).upgrade(async (tx) => {
      // Backfill session_device_id for existing RTC records
      const rtcs = await tx.table('rtcs').toArray();
      for (const rtc of rtcs) {
        if (rtc.session_client_id && !rtc.session_device_id) {
          const session = await tx.table('sessions').get(rtc.session_client_id);
          if (session?.device_id) {
            await tx.table('rtcs').update(rtc.client_id, { session_device_id: session.device_id });
          }
        }
      }
    });

    // v9: Add debugHistory table for function debugger history persistence
    this.version(9).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at, device_id',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
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
    this.version(12).stores({
      fileCache: '[md5+ext], expiresAt, syncStatus',
    }).upgrade(async (tx) => {
      // Smooth migration: treat existing cached files as already synced
      await tx.table('fileCache').toCollection().modify((entry: Record<string, unknown>) => {
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
      fileCache: '[md5+ext], expiresAt, syncStatus, lastAccessedAt',  // added lastAccessedAt index
    });
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
      `Pass a databaseName.`
    );
  }

  if (!databaseName) {
    throw new Error(
      `[RTCAgentDatabase] databaseName must not be empty`
    );
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
 */
export async function flushAll(): Promise<void> {
  log.warn('flushAll: clearing all database tables');
  const db = getDatabase();
  const tables = [
    db.sessions,
    db.turns,
    db.messages,
    db.rtcs,
    db.offsets,
    db.fileSystemEntries,
    db.debugHistory,
    db.ui_updates,
    db.fileCache,
    db.uploadParts,  // P2-3 fix: clear multipart upload progress records
  ];
  await db.transaction('rw', tables, async () => {
    await db.sessions.clear();
    await db.turns.clear();
    await db.messages.clear();
    await db.rtcs.clear();
    await db.offsets.clear();
    await db.fileSystemEntries.clear();
    await db.debugHistory.clear();
    await db.ui_updates.clear();
    await db.fileCache.clear();
    await db.uploadParts.clear();  // P2-3 fix
  });
  log.info(`flushAll: cleared ${tables.length} tables`);
}
