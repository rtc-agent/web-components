import Dexie, { type Table } from 'dexie';
import type { Session, Turn, Message, Rtc } from '@rtc-agent/protocol';

// ========== 同步状态 ==========

export type SyncStatus = 'pending' | 'synced' | 'failed';

// ========== 本地实体（client_id 为主键，server_id 为服务端 UUID） ==========

export interface LocalSession extends Omit<Session, 'id'> {
  /** 主键：客户端生成的幂等 ID */
  client_id: string;
  /** 服务端 ID（UUID），服务端返回后填充 */
  server_id?: string;
  /** 同步状态 */
  sync_status: SyncStatus;
  /** 当前会话中 status='pending' 的 turn 数量（写时聚合） */
  pending_turn_count: number;
  /** 当前会话中 status='running' 的 turn 数量（写时聚合） */
  running_turn_count: number;
}

export interface LocalTurn extends Omit<Turn, 'id' | 'session_id'> {
  client_id: string;
  server_id?: string;
  /** 指向 session 的 client_id */
  session_client_id: string;
  sync_status: SyncStatus;
}

export interface LocalMessage extends Omit<Message, 'id' | 'session_id'> {
  client_id: string;
  server_id?: string;
  /** 指向 session 的 client_id */
  session_client_id: string;
  sync_status: SyncStatus;
  /**
   * 父消息的 client_id（由 parent_message_id 解析而来）。
   * toolcall_output 通过此字段指向对应的 toolcall_input。
   */
  parent_client_id?: string;
}

export interface LocalRtc extends Omit<Rtc, 'id' | 'session_id'> {
  client_id: string;
  server_id?: string;
  /** 指向 session 的 client_id */
  session_client_id: string;
  sync_status: SyncStatus;
}

// ========== Offset 持久化 ==========

export interface OffsetRecord {
  /** 主键：频道名称，如 'topic:u=xxx' */
  channel: string;
  /** 当前已处理的 offset */
  offset: number;
  /** 当前 epoch */
  epoch: string;
  /** 最后更新时间 */
  updatedAt: number;
}

// ========== 虚拟文件系统 ==========

export type FileSystemEntryType = 'function' | 'scenario' | 'script' | 'index';

export interface FileSystemEntryMetadata {
  /** 文件名（不含路径） */
  name: string;
  /** 文件描述 */
  description: string;
  /** 标签列表 */
  tags?: string[];
  /** 所属分组（仅 function 类型） */
  group?: string;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

export interface FileSystemEntry {
  /** 主键：文件路径，如 '/functions/user/register.md' */
  path: string;
  /** 文件类型 */
  type: FileSystemEntryType;
  /** 文件内容 */
  content: string;
  /** 元数据 */
  metadata: FileSystemEntryMetadata;
}

// ========== 数据库定义 ==========

export class RTCAgentDatabase extends Dexie {
  sessions!: Table<LocalSession, string>;
  turns!: Table<LocalTurn, string>;
  messages!: Table<LocalMessage, string>;
  rtcs!: Table<LocalRtc, string>;
  offsets!: Table<OffsetRecord, string>;
  fileSystemEntries!: Table<FileSystemEntry, string>;

  constructor(databaseName: string = 'rtc-agent') {
    super(databaseName);

    // v1: 旧 schema，以 id（服务端 UUID）为主键
    this.version(1).stores({
      sessions: 'id, &client_id, sync_status, owner_ref_id, status',
      turns: 'id, &client_id, sync_status, session_id, status',
      messages: 'id, &client_id, sync_status, session_id, turn_id, global_offset',
      rtcs: 'id, &client_id, sync_status, session_id, turn_id, status',
      offsets: 'channel',
    });

    // v2: 迁移到 client_id 为主键，新增 server_id 字段
    this.version(2)
      .stores({
        // 主键：client_id，索引：server_id, sync_status 等
        sessions: 'client_id, server_id, sync_status, owner_ref_id, status',
        turns: 'client_id, server_id, sync_status, session_client_id, status',
        messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset',
        rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
        offsets: 'channel',
      })
      .upgrade(async (tx) => {
        // 数据迁移：v1 PK 为 id（服务端 UUID），v2 PK 改为 client_id。
        // 由于 update(key, changes) 会按新 PK 查找，旧记录可能没有 client_id，
        // 导致 update 找不到目标行、迁移静默失败。改用 clear + add 模式。

        // 1. 先迁移 sessions 表，建立 server_id → client_id 映射
        //    （其他表需要按 session 的 client_id 关联）
        const sessionsTable = tx.table('sessions');
        const allSessions = await sessionsTable.toArray();
        await sessionsTable.clear();

        const sessionIdMap = new Map<string, string>(); // server_id → client_id

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

        // 2. 迁移其他表（turns/messages/rtcs）
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

            // client_id 优先沿用旧值，兜底用 crypto.randomUUID() 避免空 PK 冲突
            newRow['client_id'] = oldClientId || oldId || crypto.randomUUID();
            // server_id 保存旧的服务端 UUID
            newRow['server_id'] = oldId;
            delete newRow['id'];

            // session_id → session_client_id：通过映射查找 session 的 client_id
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

    // v3: 添加 updated_at 索引用于排序
    this.version(3).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
      offsets: 'channel',
    });

    // v4: 添加 created_at 索引用于消息排序
    this.version(4).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status',
      offsets: 'channel',
    });

    // v5: 添加 offset 索引用于 RTC 排序
    this.version(5).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset',
      offsets: 'channel',
    });

    // v6: 添加虚拟文件系统 fileSystemEntries 表
    this.version(6).stores({
      sessions: 'client_id, server_id, sync_status, owner_ref_id, status, updated_at',
      turns: 'client_id, server_id, sync_status, session_client_id, status',
      messages: 'client_id, server_id, sync_status, session_client_id, turn_id, global_offset, created_at',
      rtcs: 'client_id, server_id, sync_status, session_client_id, turn_id, status, offset',
      offsets: 'channel',
      // fileSystemEntries: 主键 path，索引 type/metadata.group/metadata.tags
      // *metadata.tags 是多值索引，支持数组字段的查询
      fileSystemEntries: 'path, type, metadata.group, *metadata.tags',
    });
  }
}

// ========== 单例 ==========

let dbInstance: RTCAgentDatabase | null = null;

export function getDatabase(databaseName?: string): RTCAgentDatabase {
  if (!dbInstance) {
    dbInstance = new RTCAgentDatabase(databaseName);
  }
  return dbInstance;
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * 清空所有数据（用于开发/测试）
 */
export async function flushAll(): Promise<void> {
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
