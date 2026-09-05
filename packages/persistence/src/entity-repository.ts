import { getDatabase, type LocalSession, type LocalTurn, type LocalMessage, type LocalRtc, type SyncStatus } from './database.js';
import { getUIUpdateBus } from './ui-update-bus.js';
import { nowRFC3339 } from './time-utils.js';
import type { Session, Turn, Message, Rtc, Update, UpdateItem, UpdateEntity, UpdateAction } from '@rtc-agent/protocol';
import diff from 'microdiff';

/**
 * upsert 选项
 */
export interface UpsertOptions {
  /** 为 true 时不向 UIUpdateBus 发布更新事件 */
  silent?: boolean;
}

/**
 * upsert 结果：包含写入前（before）和写入后（after）的快照，
 * 用于在 UIUpdateBus 中发布字段级差异事件。
 */
export interface UpsertResult<T> {
  before: T | undefined;
  after: T;
}

/**
 * 将 microdiff 的 path 数组拼成点号分隔的字段路径字符串。
 * 数组下标也会被当作路径段，例如 ['content', 0, 'text'] -> 'content.0.text'。
 */
function formatField(path: (string | number)[]): string {
  return path.join('.');
}

/**
 * 基于 before / after 快照，向 UIUpdateBus 发布字段级更新事件。
 * 如果 before 为 undefined，视为整条实体新增；否则按 microdiff 的差异逐字段发布。
 */
function emitUIUpdates(
  entity: UpdateEntity,
  action: UpdateAction,
  entityId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>
): void {
  const bus = getUIUpdateBus();

  if (!before) {
    // 新增：把 after 中每个顶层字段都发一条 CREATE 事件
    for (const [field, newValue] of Object.entries(after)) {
      bus.publish({
        entity,
        action,
        entityId,
        field,
        oldValue: undefined,
        newValue,
      });
    }
    return;
  }

  // 已存在：按 microdiff 差异逐字段发布
  const changes = diff(before, after);
  for (const change of changes) {
    bus.publish({
      entity,
      action,
      entityId,
      field: formatField(change.path),
      oldValue: (change as { oldValue?: unknown }).oldValue,
      newValue: (change as { value?: unknown }).value,
    });
  }
}

/**
 * 实体仓储：负责实体的 CRUD 和同步状态管理
 */
export class EntityRepository {
  // ========== Session ==========

  async upsertSession(
    session: Partial<LocalSession>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions
  ): Promise<UpsertResult<LocalSession>> {
    const db = getDatabase();
    const now = nowRFC3339();

    // 通过 client_id 查找
    let existing: LocalSession | undefined;
    if (session.client_id) {
      existing = await db.sessions.where('client_id').equals(session.client_id).first();
    }

    let result: UpsertResult<LocalSession>;
    let action: UpdateAction;
    if (existing) {
      const before: LocalSession = { ...existing };
      const updated: LocalSession = {
        ...existing,
        ...session,
        sync_status: syncStatus,
        server_id: session.server_id || existing.server_id,
      };
      await db.sessions.put(updated);
      result = { before, after: updated };
      action = 'updated';
    } else {
      const newSession: LocalSession = {
        client_id: session.client_id || '',
        server_id: session.server_id,
        owner_kind: session.owner_kind || '',
        owner_ref_id: session.owner_ref_id || '',
        title: session.title,
        status: session.status || 'active',
        created_at: session.created_at || now,
        updated_at: session.updated_at || now,
        sync_status: syncStatus,
        pending_turn_count: 0,
        running_turn_count: 0,
      };
      await db.sessions.put(newSession);
      result = { before: undefined, after: newSession };
      action = 'created';
    }

    if (!options?.silent) {
      emitUIUpdates('session', action, result.after.client_id, result.before as unknown as Record<string, unknown> | undefined, result.after as unknown as Record<string, unknown>);
    }
    return result;
  }

  async getClientSession(clientId: string): Promise<LocalSession | undefined> {
    const db = getDatabase();
    return db.sessions.get(clientId);
  }

  /** @deprecated Use getClientSession instead */
  async getSessionByClientId(clientId: string): Promise<LocalSession | undefined> {
    return this.getClientSession(clientId);
  }

  async getSessionByServerId(serverId: string): Promise<LocalSession | undefined> {
    const db = getDatabase();
    return db.sessions.where('server_id').equals(serverId).first();
  }

  async getMessageByServerId(serverId: string): Promise<LocalMessage | undefined> {
    const db = getDatabase();
    return db.messages.where('server_id').equals(serverId).first();
  }

  async listSessions(_cursor?: string, limit: number = 50): Promise<LocalSession[]> {
    const db = getDatabase();
    const query = db.sessions.orderBy('updated_at').reverse();
    // TODO: 实现游标分页（cursor 为上一页最后一条的 client_id）
    return query.limit(limit).toArray();
  }

  // ========== Turn ==========

  async upsertTurn(
    turn: Partial<LocalTurn>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions
  ): Promise<UpsertResult<LocalTurn>> {
    const db = getDatabase();
    const now = nowRFC3339();

    let existing: LocalTurn | undefined;
    if (turn.client_id) {
      existing = await db.turns.where('client_id').equals(turn.client_id).first();
    }

    let result: UpsertResult<LocalTurn>;
    let action: UpdateAction;
    if (existing) {
      const before: LocalTurn = { ...existing };
      const updated: LocalTurn = {
        ...existing,
        ...turn,
        sync_status: syncStatus,
        server_id: turn.server_id || existing.server_id,
      };
      await db.turns.put(updated);
      result = { before, after: updated };
      action = 'updated';
    } else {
      const newTurn: LocalTurn = {
        client_id: turn.client_id || '',
        server_id: turn.server_id,
        session_client_id: turn.session_client_id || '',
        status: turn.status || 'pending',
        created_at: turn.created_at || now,
        sync_status: syncStatus,
      };
      await db.turns.put(newTurn);
      result = { before: undefined, after: newTurn };
      action = 'created';
    }

    if (!options?.silent) {
      emitUIUpdates('turn', action, result.after.client_id, result.before as unknown as Record<string, unknown> | undefined, result.after as unknown as Record<string, unknown>);
    }
    return result;
  }

  async getClientTurn(clientId: string): Promise<LocalTurn | undefined> {
    const db = getDatabase();
    return db.turns.get(clientId);
  }

  /**
   * 一次性统计某 session 下 pending / running 的 turn 数量。
   * 用于写时聚合：在 turn 行的写操作完成后把计数回写到 session 行。
   */
  async countActiveTurns(sessionClientId: string): Promise<{ pending: number; running: number }> {
    const db = getDatabase();
    const base = db.turns.where('session_client_id').equals(sessionClientId);
    // Dexie 不支持同一条查询链上多个 where()，分别计数后合并。
    const [pending, running] = await Promise.all([
      base.filter(t => t.status === 'pending').count(),
      db.turns.where('session_client_id').equals(sessionClientId).filter(t => t.status === 'running').count(),
    ]);
    return { pending, running };
  }

  // ========== Message ==========

  async upsertMessage(
    message: Partial<LocalMessage>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions
  ): Promise<UpsertResult<LocalMessage>> {
    const db = getDatabase();
    const now = nowRFC3339();

    let existing: LocalMessage | undefined;
    if (message.client_id) {
      existing = await db.messages.where('client_id').equals(message.client_id).first();
    }

    let result: UpsertResult<LocalMessage>;
    let action: UpdateAction;
    if (existing) {
      const before: LocalMessage = { ...existing };
      const updated: LocalMessage = {
        ...existing,
        ...message,
        sync_status: syncStatus,
        server_id: message.server_id || existing.server_id,
      };
      await db.messages.put(updated);
      result = { before, after: updated };
      action = 'updated';
    } else {
      const newMessage: LocalMessage = {
        client_id: message.client_id || '',
        server_id: message.server_id,
        session_client_id: message.session_client_id || '',
        turn_id: message.turn_id,
        global_offset: message.global_offset || 0,
        turn_offset: message.turn_offset,
        role: message.role || 'user',
        content: message.content,
        streaming_status: message.streaming_status || 'pending',
        creator_kind: message.creator_kind || 'user',
        creator_ref_id: message.creator_ref_id || '',
        created_at: message.created_at || now,
        updated_at: message.updated_at || now,
        sync_status: syncStatus,
        parent_client_id: message.parent_client_id,
      };
      await db.messages.put(newMessage);
      result = { before: undefined, after: newMessage };
      action = 'created';
    }

    if (!options?.silent) {
      emitUIUpdates('message', action, result.after.client_id, result.before as unknown as Record<string, unknown> | undefined, result.after as unknown as Record<string, unknown>);
    }
    return result;
  }

  async getClientMessage(clientId: string): Promise<LocalMessage | undefined> {
    const db = getDatabase();
    return db.messages.get(clientId);
  }

  async listMessagesBySession(sessionClientId: string, _cursor?: number, limit: number = 50): Promise<LocalMessage[]> {
    const db = getDatabase();
    const query = db.messages.where('session_client_id').equals(sessionClientId);
    // TODO: 实现基于 global_offset 的游标分页（cursor 为上一页最后一条的 global_offset）
    // 按 created_at 升序排序，确保消息按时间顺序显示
    const messages = await query.sortBy('created_at');
    return messages.slice(0, limit);
  }

  // ========== Rtc ==========

  async upsertRtc(
    rtc: Partial<LocalRtc>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions
  ): Promise<UpsertResult<LocalRtc>> {
    const db = getDatabase();
    const now = nowRFC3339();

    let existing: LocalRtc | undefined;
    if (rtc.client_id) {
      existing = await db.rtcs.where('client_id').equals(rtc.client_id).first();
    }

    let result: UpsertResult<LocalRtc>;
    let action: UpdateAction;
    if (existing) {
      const before: LocalRtc = { ...existing };
      const updated: LocalRtc = {
        ...existing,
        ...rtc,
        sync_status: syncStatus,
        server_id: rtc.server_id || existing.server_id,
      };
      await db.rtcs.put(updated);
      result = { before, after: updated };
      action = 'updated';
    } else {
      const newRtc: LocalRtc = {
        client_id: rtc.client_id || '',
        server_id: rtc.server_id,
        session_client_id: rtc.session_client_id || '',
        turn_id: rtc.turn_id || '',
        offset: rtc.offset || 0,
        tool_name: rtc.tool_name || '',
        parameters: rtc.parameters,
        status: rtc.status || 'pending',
        result: rtc.result,
        error_message: rtc.error_message,
        created_at: rtc.created_at || now,
        updated_at: rtc.updated_at || now,
        sync_status: syncStatus,
      };
      await db.rtcs.put(newRtc);
      result = { before: undefined, after: newRtc };
      action = 'created';
    }

    if (!options?.silent) {
      emitUIUpdates('rtc', action, result.after.client_id, result.before as unknown as Record<string, unknown> | undefined, result.after as unknown as Record<string, unknown>);
    }
    return result;
  }

  async getClientRtc(clientId: string): Promise<LocalRtc | undefined> {
    const db = getDatabase();
    return db.rtcs.get(clientId);
  }

  /**
   * 获取下一个需要处理的 RTC
   * 优先级：sync_status='failed'（重试）> status='pending'（待执行）
   * 排序：按 offset 正序
   *
   * 注意：status='pending' 表示工具尚未执行，无论 sync_status 是什么
   */
  async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
    const db = getDatabase();

    // 1. 先查 sync_status = 'failed' 的（需要重试上报）
    const failed = await db.rtcs
      .where('sync_status')
      .equals('failed')
      .sortBy('offset');

    const filteredFailed = sessionClientId
      ? failed.filter(r => r.session_client_id === sessionClientId)
      : failed;

    if (filteredFailed.length > 0) {
      return filteredFailed[0];
    }

    // 2. 再查 status = 'pending' 的（待执行的新任务）
    // 无论 sync_status 是什么，只要 status='pending' 就说明还没执行
    const allPending = await db.rtcs
      .filter(r => r.status === 'pending')
      .sortBy('offset');

    if (sessionClientId) {
      return allPending.find(r => r.session_client_id === sessionClientId);
    }
    return allPending[0];
  }

  /**
   * 列出某个 session 的 RTC（按 offset 正序）
   */
  async listRtcBySession(
    sessionClientId: string,
    cursor?: number,
    limit: number = 50
  ): Promise<LocalRtc[]> {
    const db = getDatabase();
    const items = await db.rtcs
      .where('session_client_id')
      .equals(sessionClientId)
      .toArray();

    const sorted = items.sort((a, b) => a.offset - b.offset);

    const start = cursor || 0;
    return sorted.slice(start, start + limit);
  }

  // ========== Update 处理 ==========

  /**
   * 处理 Update 事件（从 Publication 或 RPC 响应）
   *
   * 每个 item 写入 IndexedDB 后，会同步向 UIUpdateBus 发布字段级的更新事件。
   */
  async applyUpdate(update: Update): Promise<void> {
    for (let i = 0; i < update.items.length; i++) {
      const item = update.items[i];
      const data = update.data_list?.[i];

      if (!data) continue;

      await this.applyUpdateItem(item, data);
    }
  }

  private async applyUpdateItem(item: UpdateItem, data: unknown): Promise<void> {
    switch (item.entity) {
      case 'session': {
        const raw = data as Session;
        const mapped: Partial<LocalSession> = {
          ...raw,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
        };
        // 删除协议层的 id 字段（Local 类型没有 id）
        delete (mapped as Record<string, unknown>)['id'];
        await this.upsertSession(mapped, 'synced');
        break;
      }
      case 'turn': {
        const raw = data as Turn;
        const mapped: Partial<LocalTurn> = {
          ...raw,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
        } as Partial<LocalTurn>;
        delete (mapped as Record<string, unknown>)['id'];
        // session_id → session_client_id：查找 session 的 client_id
        if (raw.session_id) {
          const session = await this.getSessionByServerId(raw.session_id);
          if (session) {
            mapped.session_client_id = session.client_id;
          } else {
            console.warn(`[EntityRepository] Turn ${raw.client_id || raw.id} references unknown session ${raw.session_id}`);
            mapped.session_client_id = raw.session_id;
          }
        }
        delete (mapped as Record<string, unknown>)['session_id'];
        await this.upsertTurn(mapped, 'synced');

        // 写时聚合：把当前 session 的 pending/running turn 数量回写到 session 行。
        // upsertSession 的 diff + emitUIUpdates 会自动发布 session.updated 事件。
        const sessionClientId = mapped.session_client_id;
        if (sessionClientId) {
          const { pending, running } = await this.countActiveTurns(sessionClientId);
          const existingSession = await this.getClientSession(sessionClientId);
          if (existingSession) {
            await this.upsertSession(
              {
                client_id: sessionClientId,
                pending_turn_count: pending,
                running_turn_count: running,
              },
              existingSession.sync_status
            );
          }
        }
        break;
      }
      case 'message': {
        const raw = data as Message;
        const mapped: Partial<LocalMessage> = {
          ...raw,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
        } as Partial<LocalMessage>;
        delete (mapped as Record<string, unknown>)['id'];
        // session_id → session_client_id：查找 session 的 client_id
        if (raw.session_id) {
          const session = await this.getSessionByServerId(raw.session_id);
          if (session) {
            mapped.session_client_id = session.client_id;
          } else {
            console.warn(`[EntityRepository] Message ${raw.client_id || raw.id} references unknown session ${raw.session_id}`);
            mapped.session_client_id = raw.session_id;
          }
        }
        delete (mapped as Record<string, unknown>)['session_id'];
        // parent_message_id → parent_client_id：查找父消息的 client_id
        if (raw.parent_message_id) {
          const parentMsg = await this.getMessageByServerId(raw.parent_message_id);
          if (parentMsg) {
            mapped.parent_client_id = parentMsg.client_id;
          } else {
            console.warn(`[EntityRepository] Message ${raw.client_id || raw.id} references unknown parent ${raw.parent_message_id}`);
          }
        }
        delete (mapped as Record<string, unknown>)['parent_message_id'];
        await this.upsertMessage(mapped, 'synced');
        break;
      }
      case 'rtc': {
        const raw = data as Rtc;
        const mapped: Partial<LocalRtc> = {
          ...raw,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
        } as Partial<LocalRtc>;
        delete (mapped as Record<string, unknown>)['id'];
        // session_id → session_client_id：查找 session 的 client_id
        if (raw.session_id) {
          const session = await this.getSessionByServerId(raw.session_id);
          if (session) {
            mapped.session_client_id = session.client_id;
          } else {
            console.warn(`[EntityRepository] Rtc ${raw.client_id || raw.id} references unknown session ${raw.session_id}`);
            mapped.session_client_id = raw.session_id;
          }
        }
        delete (mapped as Record<string, unknown>)['session_id'];
        // RTC 从服务端推送来时，数据已同步（synced），但需要客户端执行后上报结果
        // sync_status 表示"执行结果是否已上报"，初始应为 pending
        await this.upsertRtc(mapped, 'pending');
        break;
      }
    }
  }
}

// 单例
let entityRepositoryInstance: EntityRepository | null = null;

export function getEntityRepository(): EntityRepository {
  if (!entityRepositoryInstance) {
    entityRepositoryInstance = new EntityRepository();
  }
  return entityRepositoryInstance;
}
