import Dexie, { type Table } from 'dexie';
import type { Session, Turn, Message, Rtc } from '@rtc-agent/protocol';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('Database');

/** Database names must start with this prefix to ensure per-user isolation */
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
}

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

// ========== Database definition ==========

export class RTCAgentDatabase extends Dexie {
  sessions!: Table<LocalSession, string>;
  turns!: Table<LocalTurn, string>;
  messages!: Table<LocalMessage, string>;
  rtcs!: Table<LocalRtc, string>;
  offsets!: Table<OffsetRecord, string>;
  fileSystemEntries!: Table<FileSystemEntry, string>;

  constructor(databaseName: string) {
    if (!databaseName.startsWith(DB_NAME_PREFIX)) {
      throw new Error(
        `[RTCAgentDatabase] databaseName must start with "${DB_NAME_PREFIX}", got "${databaseName}"`
      );
    }
    log.info('Initializing database:', databaseName);
    super(databaseName);

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
      `Pass a databaseName starting with "${DB_NAME_PREFIX}".`
    );
  }

  if (!databaseName.startsWith(DB_NAME_PREFIX)) {
    throw new Error(
      `[RTCAgentDatabase] databaseName must start with "${DB_NAME_PREFIX}", got "${databaseName}"`
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
  const tables = [db.sessions, db.turns, db.messages, db.rtcs, db.offsets, db.fileSystemEntries];
  await db.transaction('rw', tables, async () => {
    await db.sessions.clear();
    await db.turns.clear();
    await db.messages.clear();
    await db.rtcs.clear();
    await db.offsets.clear();
    await db.fileSystemEntries.clear();
  });
}
