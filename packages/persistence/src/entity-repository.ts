import { getDatabase, type LocalSession, type LocalTurn, type LocalMessage, type LocalRtc, type SyncStatus } from './database.js';
import { getUIUpdateBus } from './ui-update-bus.js';
import { nowRFC3339 } from './time-utils.js';
import type { Session, Turn, Message, Rtc, Update, UpdateItem, UpdateEntity, UpdateAction } from '@rtc-agent/protocol';
import type { Table } from 'dexie';
import diff from 'microdiff';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('EntityRepository');

/**
 * Upsert options.
 */
export interface UpsertOptions {
  /** When true, does not publish update events to UIUpdateBus */
  silent?: boolean;
}

/**
 * Upsert result: contains before/after snapshots for field-level diff emission via UIUpdateBus.
 */
export interface UpsertResult<T> {
  before: T | undefined;
  after: T;
}

/**
 * Upsert item: single data item with its metadata.
 */
interface UpsertItem {
  item: UpdateItem;
  data: unknown;
}

/**
 * 批量操作按实体类型分组后的结果。
 */
interface BatchEntities {
  sessions: Partial<LocalSession>[];
  turns: Partial<LocalTurn>[];
  messages: Partial<LocalMessage>[];
  rtcs: Partial<LocalRtc>[];
}

/**
 * 批量删除操作的 client_id 集合（按实体类型分组）。
 *
 * `_pendingDeleteServerIds` 暂存尚未从 server_id 解析为 client_id 的待处理项，
 * 由 `resolveDeleteClientIds` 解析后清空。
 */
interface BatchDeletes {
  sessions: string[];
  turns: string[];
  messages: string[];
  rtcs: string[];
  _pendingDeleteServerIds: Map<UpdateEntity, string[]>;
}

/**
 * bulkGet 的结果：按实体类型组织的 Map<client_id, record>。
 *
 * 仅在事务内使用（由 `bulkGetExisting` 返回）。
 */
interface ExistingData {
  sessions: Map<string, LocalSession>;
  turns: Map<string, LocalTurn>;
  messages: Map<string, LocalMessage>;
  rtcs: Map<string, LocalRtc>;
}

/**
 * Join microdiff's path array into a dot-separated field path string.
 * Array indices are treated as path segments, e.g. ['content', 0, 'text'] -> 'content.0.text'.
 */
function formatField(path: (string | number)[]): string {
  return path.join('.');
}

/**
 * Emit field-level update events to UIUpdateBus based on before/after snapshots.
 * If before is undefined, the entire entity is treated as newly created; otherwise
 * field-level diffs are computed via microdiff and published per-field.
 */
function emitUIUpdates(
  entity: UpdateEntity,
  action: UpdateAction,
  entityId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>
): void {
  const bus = getUIUpdateBus();

  // Deep clone to ensure data is structurally cloneable (for Comlink postMessage transport).
  // Avoids DataCloneError from non-cloneable objects (circular references, DOM elements, functions, etc.)
  const cloneableAfter = safeClone(after);
  const cloneableBefore = before ? safeClone(before) : undefined;

  if (!cloneableBefore) {
    // Create: emit a CREATE event for each top-level field in after
    for (const [field, newValue] of Object.entries(cloneableAfter)) {
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

  // Update: publish per-field diffs from microdiff
  const changes = diff(cloneableBefore, cloneableAfter);
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
 * Safely clone an object to ensure it is serializable via the structured clone algorithm.
 *
 * Uses JSON serialize/deserialize to strip non-cloneable objects (functions, DOM elements,
 * circular references, etc.). Returns an empty object if serialization fails to avoid
 * DataCloneError.
 */
function safeClone<T>(obj: T): T {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    // Serialization failed (e.g. circular reference); return empty object
    log.warn('safeClone: failed to clone object, returning empty object');
    return {} as T;
  }
}

/**
 * EntityRepository: handles entity CRUD and sync status management.
 */
export class EntityRepository {
  /** Current device ID, used to filter non-local-device RTCs at execution time */
  private deviceId: string;

  constructor(deviceId: string) {
    if (!deviceId) {
      throw new Error('[EntityRepository] deviceId is required, got empty value');
    }
    this.deviceId = deviceId;
  }

  // ========== Session ==========

  async upsertSession(
    session: Partial<LocalSession>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions
  ): Promise<UpsertResult<LocalSession>> {
    const db = getDatabase();
    const now = nowRFC3339();

    // Look up by client_id
    let existing: LocalSession | undefined;
    if (session.client_id) {
      existing = await db.sessions.where('client_id').equals(session.client_id).first();
    }

    log.debug('upsertSession:', existing ? 'UPDATE' : 'CREATE', 'client_id:', session.client_id, 'title:', session.title);

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
      log.debug('upsertSession: After update - title:', updated.title);
    } else {
      // Spread session first to preserve all optional fields (device_id, todo_list, token counters, etc.),
      // then override required fields with safe defaults when caller omits them.
      const newSession: LocalSession = {
        ...session,
        client_id: session.client_id || '',
        owner_kind: session.owner_kind || '',
        owner_ref_id: session.owner_ref_id || '',
        status: session.status || 'active',
        created_at: session.created_at || now,
        updated_at: session.updated_at || now,
        sync_status: session.sync_status || syncStatus,
        pending_turn_count: session.pending_turn_count ?? 0,
        running_turn_count: session.running_turn_count ?? 0,
        agent_prompt: session.agent_prompt || '',
      };
      await db.sessions.put(newSession);
      result = { before: undefined, after: newSession };
      action = 'created';
      log.debug('upsertSession: After create - title:', newSession.title);
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

  async getSessionByServerId(serverId: string): Promise<LocalSession | undefined> {
    const db = getDatabase();
    return db.sessions.where('server_id').equals(serverId).first();
  }

  async getMessageByServerId(serverId: string): Promise<LocalMessage | undefined> {
    const db = getDatabase();
    return db.messages.where('server_id').equals(serverId).first();
  }

  async listSessions(cursor?: string, limit: number = 50): Promise<LocalSession[]> {
    const db = getDatabase();
    const query = db.sessions.orderBy('updated_at').reverse();
    const all = await query.toArray();
    log.debug(`listSessions: total=${all.length}, with deleted_at=${all.filter(s => s.deleted_at).length}`);
    // Filter soft-deleted items (deleted_at non-empty means deleted)
    const active = all.filter(s => !s.deleted_at);
    log.debug(`listSessions: after filter=${active.length}`);
    // Cursor is the client_id of the last item on the previous page; return items after it
    if (cursor) {
      const startIdx = active.findIndex(s => s.client_id === cursor);
      if (startIdx === -1) return active.slice(0, limit);
      return active.slice(startIdx + 1, startIdx + 1 + limit);
    }
    return active.slice(0, limit);
  }

  /**
   * Soft-delete a session: sets deleted_at + updated_at, marks sync_status='pending'.
   *
   * Does not directly delete the IndexedDB row; data is preserved for sync purposes.
   * listSessions automatically filters out records with non-empty deleted_at.
   */
  async softDeleteSession(clientId: string): Promise<UpsertResult<LocalSession>> {
    const existing = await this.getClientSession(clientId);
    if (!existing) {
      throw new Error(`[EntityRepository] softDeleteSession: session not found: ${clientId}`);
    }
    const now = nowRFC3339();
    log.debug(`softDeleteSession: setting deleted_at=${now} for ${clientId}`);
    const result = await this.upsertSession(
      {
        client_id: clientId,
        deleted_at: now,
        updated_at: now,
      },
      'pending',
    );
    log.debug(`softDeleteSession: after upsert, deleted_at=${result.after.deleted_at}`);
    return result;
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
        sync_status: turn.sync_status || syncStatus,
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
   * Count pending/running turns for a session in a single pass.
   * Used for write-time aggregation: after writing turn rows, the counts are written
   * back to the session row.
   */
  async countActiveTurns(sessionClientId: string): Promise<{ pending: number; running: number }> {
    const db = getDatabase();
    const base = db.turns.where('session_client_id').equals(sessionClientId);
    // Dexie does not support multiple where() calls on the same query chain; count separately and merge
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
        sync_status: message.sync_status || syncStatus,
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

  async listMessagesBySession(
    sessionClientId: string,
    cursor?: string,
    limit: number = 50,
    direction: 'backward' | 'forward' = 'backward'
  ): Promise<LocalMessage[]> {
    const db = getDatabase();
    const query = db.messages.where('session_client_id').equals(sessionClientId);
    const allMessages = await query.toArray();

    // Sort strategy: first by created_at, then by client_id (client ID primary key) for ties.
    // This ensures deterministic ordering even when multiple messages are created at the same time.
    const sortKey = (m: LocalMessage) => {
      const ts = new Date(m.created_at).getTime();
      return `${ts}|${m.client_id}`;
    };

    allMessages.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    // Parse cursor: format is "${timestamp}|${clientId}"
    let cursorKey: string | null = null;
    if (cursor) {
      cursorKey = cursor;
    }

    if (direction === 'backward') {
      // Backward pagination: get messages older than the cursor
      let filtered = allMessages;
      if (cursorKey) {
        // Strictly less than cursor (open interval) to prevent duplicates
        filtered = allMessages.filter(m => sortKey(m) < cursorKey!);
      }
      // Take the last `limit` items (newest) and return in ascending order
      const sliced = filtered.slice(-limit);
      return sliced;
    }

    // Forward pagination: get messages newer than the cursor
    if (cursorKey) {
      // Strictly greater than cursor (open interval) to prevent duplicates
      const filtered = allMessages.filter(m => sortKey(m) > cursorKey!);
      return filtered.slice(0, limit);
    }
    return allMessages.slice(0, limit);
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
        session_device_id: rtc.session_device_id,
        turn_id: rtc.turn_id || '',
        offset: rtc.offset || 0,
        tool_name: rtc.tool_name || '',
        parameters: rtc.parameters,
        status: rtc.status || 'pending',
        result: rtc.result,
        error_message: rtc.error_message,
        created_at: rtc.created_at || now,
        updated_at: rtc.updated_at || now,
        sync_status: rtc.sync_status || syncStatus,
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
   * Get the next RTC to process.
   * Priority: sync_status='failed' (retry) > status='pending' (awaiting execution).
   * Ordering: ascending by offset.
   *
   * Note: status='pending' means the tool has not been executed yet, regardless of sync_status.
   *
   * Device ID filtering is done at execution time: only RTCs whose session_device_id matches
   * this.deviceId are returned. RTCs with empty session_device_id are allowed (lenient mode).
   *
   * @param sessionClientId Optional session filter
   */
  async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
    const db = getDatabase();

    // Filter by session (optional)
    const matchesSession = (rtc: LocalRtc): boolean => {
      if (!sessionClientId) return true;
      return rtc.session_client_id === sessionClientId;
    };

    // Filter by device ID (execution-time filtering).
    // Lenient mode: RTCs with empty/undefined session_device_id are allowed.
    const matchesDevice = (rtc: LocalRtc): boolean => {
      if (!rtc.session_device_id) return true;
      return rtc.session_device_id === this.deviceId;
    };

    // 1. First look for sync_status = 'failed' (need retry submission)
    const failed = await db.rtcs
      .where('sync_status')
      .equals('failed')
      .sortBy('offset');

    const matchFailed = failed.find(r => matchesSession(r) && matchesDevice(r));
    if (matchFailed) {
      return matchFailed;
    }

    // 2. Then look for status = 'pending' (new tasks awaiting execution)
    // Regardless of sync_status, status='pending' means not yet executed
    const allPending = await db.rtcs
      .filter(r => r.status === 'pending')
      .sortBy('offset');

    return allPending.find(r => matchesSession(r) && matchesDevice(r));
  }

  /**
   * List RTCs for a session (ascending by offset).
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

  // ========== Update processing ==========

  /**
   * Process an Update event (from Publication or RPC response).
   *
   * After each item is written to IndexedDB, field-level update events are
   * synchronously published to UIUpdateBus.
   */
  async applyUpdate(update: Update): Promise<void> {
    return this.applyUpdates([update]);
  }

  /**
   * Batch process multiple Update events (optimized for gap fill scenario).
   *
   * Uses bulkGet + merge + bulkPut within a single Dexie transaction to maintain
   * merge semantics while achieving batch performance. Expected to reduce DB operations
   * by 50-400x compared to per-item processing.
   *
   * @param updates Array of Update events to process in a single batch
   */
  async applyUpdates(updates: Update[]): Promise<void> {
    // Fast path: empty input
    if (!updates || updates.length === 0) return;

    // Fast path: single update, use original per-item logic
    if (updates.length === 1) {
      return this.applyUpdateOriginal(updates[0]);
    }

    const db = getDatabase();
    const startTime = performance.now();

    // Count total items for logging
    let totalItems = 0;
    for (const update of updates) {
      totalItems += update.items.length;
    }

    // 1. Extract all items, separate upserts and deletes
    const { upserts, deletes } = this.groupItemsByEntity(updates);

    // Fast path: no valid operations
    if (this.isBatchEmpty(upserts, deletes)) {
      log.debug(`[applyUpdates] Empty batch, skipping`);
      return;
    }

    log.info(`[applyUpdates] Processing ${updates.length} updates, ${totalItems} items`);

    // 2. Load required session mappings on-demand
    const sessionMap = await this.loadRequiredSessionMap(upserts);

    // 3. Prepare all entity data (field mapping + defaults)
    const prepared = this.prepareEntitiesForBatch(upserts, sessionMap);

    // 4. Batch resolve parent_message_id (server_id → client_id)
    await this.resolveParentMessageIds(prepared.messages);

    // 5. Resolve delete client_ids (server_id → client_id)
    await this.resolveDeleteClientIds(deletes, sessionMap);

    // 6. Dynamically determine tables to lock
    const tablesToLock = this.getTablesToLock(upserts, deletes);

    // 7. Atomic transaction: bulkGet → merge → bulkPut/bulkDelete
    const beforeSnapshots = new Map<string, any>();
    let merged: BatchEntities = { sessions: [], turns: [], messages: [], rtcs: [] };

    try {
      await db.transaction('rw', tablesToLock, async () => {
        // 7a. bulkGet existing records (within transaction)
        const existingData = await this.bulkGetExisting(prepared);

        // 7b. Collect before snapshots (original records before merge)
        this.collectBeforeSnapshots(beforeSnapshots, existingData);

        // 7c. Merge in memory: { ...existing, ...newData }
        merged = this.mergeWithExisting(prepared, existingData);

        // 7d. bulkPut writes
        if (merged.sessions.length > 0) await db.sessions.bulkPut(merged.sessions as LocalSession[]);
        if (merged.turns.length > 0) await db.turns.bulkPut(merged.turns as LocalTurn[]);
        if (merged.messages.length > 0) await db.messages.bulkPut(merged.messages as LocalMessage[]);
        if (merged.rtcs.length > 0) await db.rtcs.bulkPut(merged.rtcs as LocalRtc[]);

        // 7e. bulkDelete deletes
        if (deletes.sessions.length > 0) await db.sessions.bulkDelete(deletes.sessions);
        if (deletes.turns.length > 0) await db.turns.bulkDelete(deletes.turns);
        if (deletes.messages.length > 0) await db.messages.bulkDelete(deletes.messages);
        if (deletes.rtcs.length > 0) await db.rtcs.bulkDelete(deletes.rtcs);

        // 7f. Turn count writeback (within same transaction, re-read sessions from DB)
        await this.writebackTurnCountsInTx(merged.turns);
      });

      const elapsed = performance.now() - startTime;
      log.info(
        `[applyUpdates] Transaction completed in ${elapsed.toFixed(1)}ms: ` +
        `${merged.sessions.length} sessions, ${merged.turns.length} turns, ` +
        `${merged.messages.length} messages, ${merged.rtcs.length} rtcs, ` +
        `${deletes.sessions.length + deletes.turns.length + deletes.messages.length + deletes.rtcs.length} deletes`
      );

      // 8. Emit batch UI updates (outside transaction)
      this.emitBatchUIUpdates(beforeSnapshots, merged, deletes);
    } catch (err) {
      const elapsed = performance.now() - startTime;
      log.error(`[applyUpdates] Transaction failed after ${elapsed.toFixed(1)}ms:`, err);
      throw err;
    }
  }

  /**
   * Group items by entity type, separating upserts and deletes.
   *
   * Uses Map<client_id, UpsertItem> for automatic deduplication:
   * same client_id later occurrences override earlier ones (last wins).
   */
  private groupItemsByEntity(updates: Update[]): {
    upserts: Map<UpdateEntity, UpsertItem[]>;
    deletes: BatchDeletes;
  } {
    const upserts = new Map<UpdateEntity, Map<string, UpsertItem>>();
    const deletes: BatchDeletes = {
      sessions: [],
      turns: [],
      messages: [],
      rtcs: [],
      _pendingDeleteServerIds: new Map(),
    };

    for (const update of updates) {
      for (let i = 0; i < update.items.length; i++) {
        const item = update.items[i];

        if (item.action === 'deleted') {
          // Deleted action: prefer client_id from data_list
          const data = update.data_list?.[i] as Record<string, unknown> | undefined;
          const clientId = data?.['client_id'] as string | undefined;

          if (clientId) {
            this.pushDelete(deletes, item.entity, clientId);
          } else {
            // entity_id is server_id, collect to pending list
            if (!deletes._pendingDeleteServerIds.has(item.entity)) {
              deletes._pendingDeleteServerIds.set(item.entity, []);
            }
            deletes._pendingDeleteServerIds.get(item.entity)!.push(item.entity_id);
          }
          continue;
        }

        const data = update.data_list?.[i];
        if (!data) continue;

        const raw = data as Record<string, unknown>;
        const clientId = (raw['client_id'] as string) || (raw['id'] as string);
        if (!clientId) continue; // Invalid data without client_id, skip

        if (!upserts.has(item.entity)) {
          upserts.set(item.entity, new Map());
        }
        // Last occurrence wins (same client_id multiple updates, take the last one)
        upserts.get(item.entity)!.set(clientId, { item, data });
      }
    }

    // Convert Map back to array
    const result = new Map<UpdateEntity, UpsertItem[]>();
    for (const [entity, map] of upserts) {
      result.set(entity, [...map.values()]);
    }

    return { upserts: result, deletes };
  }

  /**
   * Check if batch operation is empty (no valid operations).
   */
  private isBatchEmpty(
    upserts: Map<UpdateEntity, UpsertItem[]>,
    deletes: BatchDeletes
  ): boolean {
    for (const items of upserts.values()) {
      if (items.length > 0) return false;
    }
    return deletes.sessions.length === 0
      && deletes.turns.length === 0
      && deletes.messages.length === 0
      && deletes.rtcs.length === 0
      && deletes._pendingDeleteServerIds.size === 0;
  }

  /**
   * Push client_id to corresponding delete array by entity type.
   */
  private pushDelete(
    deletes: BatchDeletes,
    entity: UpdateEntity,
    clientId: string
  ): void {
    switch (entity) {
      case 'session': deletes.sessions.push(clientId); break;
      case 'turn':    deletes.turns.push(clientId); break;
      case 'message': deletes.messages.push(clientId); break;
      case 'rtc':     deletes.rtcs.push(clientId); break;
      default:
        log.info(`Unsupported entity type for batch delete: ${entity}`);
    }
  }

  /**
   * Load required session mappings on-demand.
   *
   * Collects all session_id (server_id) referenced by turn/message/rtc entities,
   * then batch queries sessions table. Also includes sessions from the same batch
   * (parent session may be created in the same batch as child entities).
   * Much more efficient than full table scan.
   */
  private async loadRequiredSessionMap(
    upserts: Map<UpdateEntity, UpsertItem[]>
  ): Promise<Map<string, LocalSession>> {
    const db = getDatabase();

    // 1. Collect all session server_ids from entities that need session resolution
    const sessionServerIds = new Set<string>();

    for (const entity of ['turn', 'message', 'rtc'] as const) {
      const items = upserts.get(entity) ?? [];
      for (const { data } of items) {
        const raw = data as { session_id?: string };
        if (raw.session_id) {
          sessionServerIds.add(raw.session_id);
        }
      }
    }

    // 2. Build mapping from same-batch sessions first (parent may be in same batch)
    const map = new Map<string, LocalSession>();
    const batchSessions = upserts.get('session') ?? [];
    for (const { data } of batchSessions) {
      const raw = data as Record<string, unknown>;
      const serverId = raw['id'] as string;
      const clientId = (raw['client_id'] as string) || serverId;

      // Build a partial session object for mapping
      const session: Partial<LocalSession> = {
        server_id: serverId,
        client_id: clientId,
        ...(raw as Partial<LocalSession>),
      };
      if (serverId) map.set(serverId, session as LocalSession);
      map.set(clientId, session as LocalSession);
    }

    // 3. Batch query DB for remaining sessions not in current batch
    const missingIds = [...sessionServerIds].filter(id => !map.has(id));
    if (missingIds.length > 0) {
      const sessions = await db.sessions
        .where('server_id')
        .anyOf(missingIds)
        .toArray();

      for (const s of sessions) {
        map.set(s.server_id!, s);
        map.set(s.client_id, s);
      }
    }

    return map;
  }

  /**
   * Resolve session_id to session_client_id using sessionMap.
   *
   * Returns the client_id if found, or falls back to the original server_id
   * (with a warning) if the session is not yet in the local database.
   */
  private resolveSessionClientId(
    serverId: string,
    sessionMap: Map<string, LocalSession>
  ): string {
    const session = sessionMap.get(serverId);
    if (!session) {
      log.warn(`Session ${serverId} not found in map, using server_id as client_id`);
      return serverId;
    }
    return session.client_id;
  }

  /**
   * Prepare entity data for batch processing.
   *
   * Handles field mapping (id → server_id, session_id → session_client_id, etc.),
   * fills in default values for required fields, and removes protocol-layer fields.
   */
  private prepareEntitiesForBatch(
    upserts: Map<UpdateEntity, UpsertItem[]>,
    sessionMap: Map<string, LocalSession>
  ): BatchEntities {
    const result: BatchEntities = {
      sessions: [],
      turns: [],
      messages: [],
      rtcs: [],
    };

    const now = nowRFC3339();

    // Sessions
    for (const { data } of (upserts.get('session') ?? [])) {
      const raw = data as Record<string, unknown>;
      const serverId = raw['id'] as string;
      const clientId = (raw['client_id'] as string) || serverId;

      // Fill defaults first, then override with incoming data
      const mapped: Partial<LocalSession> = {
        owner_kind: '',
        owner_ref_id: '',
        status: 'active',
        created_at: now,
        updated_at: now,
        pending_turn_count: 0,
        running_turn_count: 0,
        agent_prompt: '',
        ...(raw as Partial<LocalSession>),
        // Force override incoming values
        server_id: serverId,
        client_id: clientId,
        sync_status: 'synced',
      };
      delete (mapped as Record<string, unknown>)['id'];
      result.sessions.push(mapped);
    }

    // Turns
    for (const { data } of (upserts.get('turn') ?? [])) {
      const raw = data as Record<string, unknown>;
      const serverId = raw['id'] as string;
      const clientId = (raw['client_id'] as string) || serverId;
      const sessionId = raw['session_id'] as string | undefined;

      const mapped: Partial<LocalTurn> = {
        // Defaults
        session_client_id: '',
        status: 'pending',
        created_at: now,
        ...(raw as Partial<LocalTurn>),
        // Force override
        server_id: serverId,
        client_id: clientId,
        sync_status: 'synced',
      } as Partial<LocalTurn>;

      // Field mapping: session_id → session_client_id
      if (sessionId) {
        mapped.session_client_id = this.resolveSessionClientId(sessionId, sessionMap);
      }
      delete (mapped as Record<string, unknown>)['id'];
      delete (mapped as Record<string, unknown>)['session_id'];
      result.turns.push(mapped);
    }

    // Messages
    for (const { data } of (upserts.get('message') ?? [])) {
      const raw = data as Record<string, unknown>;
      const serverId = raw['id'] as string;
      const clientId = (raw['client_id'] as string) || serverId;
      const sessionId = raw['session_id'] as string | undefined;
      const parentMsgId = raw['parent_message_id'] as string | undefined;

      const mapped: Partial<LocalMessage> = {
        // Defaults
        session_client_id: '',
        role: 'user',
        content: '',
        turn_id: '',
        turn_offset: 0,
        streaming_status: 'pending',
        creator_kind: 'user',
        creator_ref_id: '',
        global_offset: 0,
        created_at: now,
        updated_at: now,
        ...(raw as Partial<LocalMessage>),
        // Force override
        server_id: serverId,
        client_id: clientId,
        sync_status: 'synced',
      } as Partial<LocalMessage>;

      // Field mapping: session_id → session_client_id
      if (sessionId) {
        mapped.session_client_id = this.resolveSessionClientId(sessionId, sessionMap);
      }
      delete (mapped as Record<string, unknown>)['id'];
      delete (mapped as Record<string, unknown>)['session_id'];

      // Field mapping: parent_message_id → parent_client_id
      // Store as _pending_parent_server_id temporarily, resolve later in resolveParentMessageIds
      if (parentMsgId) {
        (mapped as any)._pending_parent_server_id = parentMsgId;
      }
      delete (mapped as Record<string, unknown>)['parent_message_id'];
      result.messages.push(mapped);
    }

    // Rtcs
    for (const { data } of (upserts.get('rtc') ?? [])) {
      const raw = data as Record<string, unknown>;
      const serverId = raw['id'] as string;
      const clientId = (raw['client_id'] as string) || serverId;
      const sessionId = raw['session_id'] as string | undefined;

      let sessionClientId: string | undefined;
      let sessionDeviceId: string | undefined;
      if (sessionId) {
        const session = sessionMap.get(sessionId);
        if (session) {
          sessionClientId = session.client_id;
          sessionDeviceId = session.device_id;
        } else {
          log.warn(`RTC ${clientId} references unknown session ${sessionId}`);
          sessionClientId = sessionId; // fallback
        }
      }

      const mapped: Partial<LocalRtc> = {
        // Defaults
        session_client_id: '',
        turn_id: '',
        offset: 0,
        tool_name: '',
        status: 'pending',
        parameters: undefined,
        result: undefined,
        error_message: undefined,
        completed_at: undefined,
        created_at: now,
        updated_at: now,
        ...(raw as Partial<LocalRtc>),
        // Force override
        server_id: serverId,
        client_id: clientId,
        session_device_id: sessionDeviceId,
        // RTC special handling: sync_status should be 'pending'
        sync_status: 'pending',
      } as Partial<LocalRtc>;
      // Field mapping: session_id → session_client_id
      if (sessionClientId) {
        mapped.session_client_id = sessionClientId;
      }
      delete (mapped as Record<string, unknown>)['id'];
      delete (mapped as Record<string, unknown>)['session_id'];
      result.rtcs.push(mapped);
    }

    return result;
  }

  /**
   * Batch resolve parent_message_id (server_id → client_id).
   *
   * Priority: resolve from same batch first, then query DB.
   * Modifies messages in-place, setting parent_client_id and removing _pending_parent_server_id.
   */
  private async resolveParentMessageIds(
    messages: Partial<LocalMessage>[]
  ): Promise<void> {
    if (messages.length === 0) return;

    // Collect all pending parent server_ids
    const parentServerIds = new Set<string>();
    for (const msg of messages) {
      const pendingId = (msg as any)._pending_parent_server_id as string | undefined;
      if (pendingId) {
        parentServerIds.add(pendingId);
      }
    }
    if (parentServerIds.size === 0) return;

    // Prefer resolution from same batch (parent and child may be in same gap fill batch)
    const batchServerToClient = new Map<string, string>();
    for (const msg of messages) {
      const serverId = msg.server_id;
      const clientId = msg.client_id;
      if (serverId && clientId && parentServerIds.has(serverId)) {
        batchServerToClient.set(serverId, clientId);
      }
    }

    // Find unresolved server_ids, need to query DB
    const unresolvedServerIds = [...parentServerIds].filter(
      id => !batchServerToClient.has(id)
    );

    // Batch query messages table (by server_id index)
    const serverToClient = new Map(batchServerToClient);
    if (unresolvedServerIds.length > 0) {
      const db = getDatabase();
      const parentMessages = await db.messages
        .where('server_id')
        .anyOf(unresolvedServerIds)
        .toArray();

      for (const pm of parentMessages) {
        serverToClient.set(pm.server_id!, pm.client_id);
      }
    }

    // Fill back parent_client_id, delete temporary field
    for (const msg of messages) {
      const pendingId = (msg as any)._pending_parent_server_id as string | undefined;
      if (pendingId) {
        const parentClientId = serverToClient.get(pendingId);
        if (parentClientId) {
          msg.parent_client_id = parentClientId;
        } else {
          log.warn(`[applyUpdates:message] parent message ${pendingId} not found in DB or current batch`);
        }
        delete (msg as any)._pending_parent_server_id;
      }
    }
  }

  /**
   * Batch resolve delete client_ids (server_id → client_id).
   *
   * For delete operations where data_list was not available, resolve server_id to client_id
   * by querying the corresponding entity tables.
   */
  private async resolveDeleteClientIds(
    deletes: BatchDeletes,
    sessionMap: Map<string, any>
  ): Promise<void> {
    if (deletes._pendingDeleteServerIds.size === 0) return;

    const db = getDatabase();

    for (const [entity, serverIds] of deletes._pendingDeleteServerIds) {
      if (serverIds.length === 0) continue;

      let clientIds: string[] = [];

      switch (entity) {
        case 'session': {
          // Try sessionMap first (already loaded)
          for (const sid of serverIds) {
            const session = sessionMap.get(sid);
            if (session) {
              clientIds.push(session.client_id);
            }
          }
          // Query DB for missing ones
          const missing = serverIds.filter(sid => !sessionMap.has(sid));
          if (missing.length > 0) {
            const sessions = await db.sessions
              .where('server_id').anyOf(missing).toArray();
            clientIds.push(...sessions.map(s => s.client_id));
          }
          break;
        }
        case 'turn': {
          const turns = await db.turns.where('server_id').anyOf(serverIds).toArray();
          clientIds = turns.map(t => t.client_id);
          break;
        }
        case 'message': {
          const msgs = await db.messages.where('server_id').anyOf(serverIds).toArray();
          clientIds = msgs.map(m => m.client_id);
          break;
        }
        case 'rtc': {
          const rtcs = await db.rtcs.where('server_id').anyOf(serverIds).toArray();
          clientIds = rtcs.map(r => r.client_id);
          break;
        }
      }

      // Add resolved client_ids to delete lists
      for (const clientId of clientIds) {
        this.pushDelete(deletes, entity, clientId);
      }

      // Log unresolved server_ids
      if (clientIds.length < serverIds.length) {
        log.warn(
          `[applyUpdates:delete] ${entity}: ${serverIds.length - clientIds.length}/${serverIds.length} ` +
          `server_ids could not be resolved to client_ids (records not found in local DB, will be silently skipped)`
        );
      }
    }

    // Clear pending list
    deletes._pendingDeleteServerIds.clear();
  }

  /**
   * Dynamically determine tables to lock based on actual operations.
   *
   * Only locks tables that have actual operations, reducing transaction conflicts.
   */
  private getTablesToLock(
    upserts: Map<UpdateEntity, UpsertItem[]>,
    deletes: BatchDeletes
  ): Table<any, string>[] {
    const db = getDatabase();
    const tables: Table<any, string>[] = [];

    if ((upserts.get('session')?.length ?? 0) > 0 || deletes.sessions.length > 0) {
      tables.push(db.sessions);
    }
    if ((upserts.get('turn')?.length ?? 0) > 0 || deletes.turns.length > 0) {
      tables.push(db.turns);
    }
    if ((upserts.get('message')?.length ?? 0) > 0 || deletes.messages.length > 0) {
      tables.push(db.messages);
    }
    if ((upserts.get('rtc')?.length ?? 0) > 0 || deletes.rtcs.length > 0) {
      tables.push(db.rtcs);
    }

    return tables;
  }

  /**
   * BulkGet existing records within transaction.
   *
   * Must be called within db.transaction('rw', ...) callback to ensure
   * read-modify-write atomicity.
   */
  private async bulkGetExisting(
    prepared: BatchEntities
  ): Promise<ExistingData> {
    const db = getDatabase();

    // Build client_id arrays (for bulkGet by primary key)
    const sessionIds = prepared.sessions.map(s => s.client_id!).filter(Boolean);
    const turnIds = prepared.turns.map(t => t.client_id!).filter(Boolean);
    const msgIds = prepared.messages.map(m => m.client_id!).filter(Boolean);
    const rtcIds = prepared.rtcs.map(r => r.client_id!).filter(Boolean);

    // Parallel bulkGet (parallel within transaction doesn't affect atomicity)
    const [existingSessions, existingTurns, existingMsgs, existingRtcs] = await Promise.all([
      sessionIds.length > 0 ? db.sessions.bulkGet(sessionIds) : [],
      turnIds.length > 0 ? db.turns.bulkGet(turnIds) : [],
      msgIds.length > 0 ? db.messages.bulkGet(msgIds) : [],
      rtcIds.length > 0 ? db.rtcs.bulkGet(rtcIds) : [],
    ]);

    // Build Maps for easy merge lookup
    const toMap = <T extends { client_id: string }>(
      ids: string[], records: (T | undefined)[]
    ): Map<string, T> => {
      const map = new Map<string, T>();
      records.forEach((r, i) => { if (r) map.set(ids[i], r); });
      return map;
    };

    return {
      sessions: toMap(sessionIds, existingSessions as (LocalSession | undefined)[]),
      turns: toMap(turnIds, existingTurns as (LocalTurn | undefined)[]),
      messages: toMap(msgIds, existingMsgs as (LocalMessage | undefined)[]),
      rtcs: toMap(rtcIds, existingRtcs as (LocalRtc | undefined)[]),
    };
  }

  /**
   * Collect before snapshots (original records before merge, for UI update diff).
   *
   * Must be called after bulkGet but before merge.
   */
  private collectBeforeSnapshots(
    before: Map<string, any>,
    existing: ExistingData
  ): void {
    for (const [clientId, session] of existing.sessions) {
      before.set(`session:${clientId}`, session);
    }
    for (const [clientId, turn] of existing.turns) {
      before.set(`turn:${clientId}`, turn);
    }
    for (const [clientId, msg] of existing.messages) {
      before.set(`message:${clientId}`, msg);
    }
    for (const [clientId, rtc] of existing.rtcs) {
      before.set(`rtc:${clientId}`, rtc);
    }
  }

  /**
   * Merge in memory: { ...existing, ...newData }.
   *
   * Pure synchronous operation, no DB calls. Must be called within transaction
   * (using bulkGetExisting result).
   */
  private mergeWithExisting(
    prepared: BatchEntities,
    existing: ExistingData
  ): BatchEntities {
    const merge = <T extends { client_id?: string }>(
      items: T[], existingMap: Map<string, T>
    ): T[] => {
      return items.map(item => {
        const cid = item.client_id!;
        const prev = existingMap.get(cid);
        if (prev) {
          // Update: existing fields are complete, override with incoming
          return { ...prev, ...item } as T;
        }
        // New: prepared already contains defaults, use directly
        return item;
      });
    };

    return {
      sessions: merge(prepared.sessions, existing.sessions),
      turns: merge(prepared.turns, existing.turns),
      messages: merge(prepared.messages, existing.messages),
      rtcs: merge(prepared.rtcs, existing.rtcs),
    };
  }

  /**
   * Writeback turn counts to session within transaction.
   *
   * Must be called after turn bulkPut (within same transaction).
   * Re-reads sessions from DB (not using stale sessionMap) to ensure sync_status etc. are correct.
   */
  private async writebackTurnCountsInTx(
    turns: Partial<LocalTurn>[]
  ): Promise<void> {
    if (turns.length === 0) return;

    const db = getDatabase();

    // Collect all affected session_client_ids
    const affectedSessionIds = new Set<string>();
    for (const turn of turns) {
      if (turn.session_client_id) {
        affectedSessionIds.add(turn.session_client_id);
      }
    }
    if (affectedSessionIds.size === 0) return;

    // Re-read latest sessions from DB (within transaction, ensures consistency)
    const sessionIds = [...affectedSessionIds];
    const sessions = await db.sessions.bulkGet(sessionIds);

    // Parallel calculate turn counts for all affected sessions
    const countPromises = sessionIds.map(sessionId => this.countActiveTurns(sessionId));
    const counts = await Promise.all(countPromises);

    // Build update array
    const updates: LocalSession[] = [];
    for (let i = 0; i < sessionIds.length; i++) {
      const session = sessions[i];
      if (!session) continue; // session doesn't exist (may have been deleted), skip

      const { pending, running } = counts[i];

      // Only update when count actually changed (reduce unnecessary writes)
      if (session.pending_turn_count !== pending || session.running_turn_count !== running) {
        updates.push({
          ...session,
          pending_turn_count: pending,
          running_turn_count: running,
          // Note: don't modify sync_status, keep original value
        });
      }
    }

    if (updates.length > 0) {
      await db.sessions.bulkPut(updates);
    }
  }

  /**
   * Emit batch UI update events.
   *
   * Called outside transaction (transaction only does DB operations).
   * Before snapshots collected within transaction via collectBeforeSnapshots.
   */
  private emitBatchUIUpdates(
    before: Map<string, any>,
    merged: BatchEntities,
    deletes: BatchDeletes
  ): void {
    const entityTypes = ['sessions', 'turns', 'messages', 'rtcs'] as const;
    const typeNames = ['session', 'turn', 'message', 'rtc'] as const;

    // 1. Emit upsert UI updates
    for (let idx = 0; idx < entityTypes.length; idx++) {
      const entities = merged[entityTypes[idx]];
      const typeName = typeNames[idx];

      for (const record of entities) {
        const clientId = (record as any).client_id;
        const key = `${typeName}:${clientId}`;
        const oldRecord = before.get(key);
        const action = oldRecord ? 'updated' : 'created';
        emitUIUpdates(
          typeName,
          action,
          clientId,
          oldRecord as Record<string, unknown> | undefined,
          record as unknown as Record<string, unknown>
        );
      }
    }

    // 2. Emit delete UI updates
    for (let idx = 0; idx < entityTypes.length; idx++) {
      const ids = deletes[entityTypes[idx]];
      const typeName = typeNames[idx];

      for (const clientId of ids) {
        const key = `${typeName}:${clientId}`;
        const oldRecord = before.get(key);
        emitUIUpdates(
          typeName,
          'deleted',
          clientId,
          oldRecord as Record<string, unknown> | undefined,
          {} as Record<string, unknown>
        );
      }
    }
  }

  /**
   * Resolve a server session_id to the corresponding local client_id.
   *
   * Returns the client_id if found, or falls back to the original server_id
   * (with a warning) if the session is not yet in the local database.
   */
  private async _resolveSessionClientId(serverSessionId: string, entityType: string, entityId: string): Promise<string> {
    const session = await this.getSessionByServerId(serverSessionId);
    if (session) {
      return session.client_id;
    }
    log.warn(`${entityType} ${entityId} references unknown session ${serverSessionId}`);
    return serverSessionId;
  }

  private async applyUpdateOriginal(update: Update): Promise<void> {
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
        // Remove protocol-layer id field (Local types do not have id)
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
        if (raw.session_id) {
          mapped.session_client_id = await this._resolveSessionClientId(raw.session_id, 'Turn', raw.client_id || raw.id);
        }
        delete (mapped as Record<string, unknown>)['session_id'];
        await this.upsertTurn(mapped, 'synced');

        // Write-time aggregation: write pending/running turn counts back to the session row.
        // upsertSession's diff + emitUIUpdates will automatically publish session.updated events.
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
        if (raw.session_id) {
          mapped.session_client_id = await this._resolveSessionClientId(raw.session_id, 'Message', raw.client_id || raw.id);
        }
        delete (mapped as Record<string, unknown>)['session_id'];
        // parent_message_id -> parent_client_id: resolve parent message's client_id
        if (raw.parent_message_id) {
          const parentMsg = await this.getMessageByServerId(raw.parent_message_id);
          if (parentMsg) {
            mapped.parent_client_id = parentMsg.client_id;
          } else {
            log.warn(`[applyUpdateItem:message] Message ${raw.client_id || raw.id} references unknown parent ${raw.parent_message_id}`);
          }
        }
        delete (mapped as Record<string, unknown>)['parent_message_id'];
        await this.upsertMessage(mapped, 'synced');
        break;
      }
      case 'rtc': {
        const raw = data as Rtc;
        // session_id -> session_client_id: resolve session's client_id
        // Also extract session.device_id for redundant storage (used in execution-time filtering)
        let sessionClientId: string | undefined;
        let sessionDeviceId: string | undefined;
        if (raw.session_id) {
          const session = await this.getSessionByServerId(raw.session_id);
          if (session) {
            sessionClientId = session.client_id;
            sessionDeviceId = session.device_id;
          } else {
            // Lenient mode: session not found, still write RTC but log warning
            log.warn(`RTC ${raw.client_id || raw.id} references unknown session ${raw.session_id}`);
            sessionClientId = raw.session_id;
          }
        }

        const mapped: Partial<LocalRtc> = {
          ...raw,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
          session_client_id: sessionClientId || '',
          session_device_id: sessionDeviceId,
        } as Partial<LocalRtc>;
        delete (mapped as Record<string, unknown>)['id'];
        delete (mapped as Record<string, unknown>)['session_id'];
        // When RTC is pushed from the server, data is already synced, but the client must
        // execute it and report results. sync_status represents "whether the execution result
        // has been reported"; it should start as 'pending'.
        await this.upsertRtc(mapped, 'pending');
        break;
      }
    }
  }
}

// Singleton
let entityRepositoryInstance: EntityRepository | null = null;

/**
 * Initialize the EntityRepository singleton.
 *
 * Must be called once at application startup with the current device's Device ID.
 * The Device ID is used to filter non-local-device RTCs at execution time.
 */
export function initEntityRepository(deviceId: string): void {
  if (entityRepositoryInstance) {
    log.warn('Already initialized, ignoring re-init');
    return;
  }
  entityRepositoryInstance = new EntityRepository(deviceId);
}

/**
 * Get the EntityRepository singleton.
 *
 * initEntityRepository(deviceId) must be called first.
 */
export function getEntityRepository(): EntityRepository {
  if (!entityRepositoryInstance) {
    throw new Error('[EntityRepository] Not initialized - call initEntityRepository(deviceId) first');
  }
  return entityRepositoryInstance;
}
