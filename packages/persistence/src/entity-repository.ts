import { getDatabase, type LocalSession, type LocalTurn, type LocalMessage, type LocalRtc, type SyncStatus } from './database.js';
import { getUIUpdateBus } from './ui-update-bus.js';
import { nowRFC3339 } from './time-utils.js';
import type { Session, Turn, Message, Rtc, Update, UpdateItem, UpdateEntity, UpdateAction } from '@rtc-agent/protocol';
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
  /** Current device ID, used to filter non-local-device RTCs on write */
  private deviceId: string;

  constructor(deviceId: string) {
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

    log.debug('upsertSession]', existing ? 'UPDATE' : 'CREATE', 'client_id:', session.client_id, 'title:', session.title);

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
      log.debug('upsertSession] After update - title:', updated.title);
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
        agent_prompt: session.agent_prompt || '',
      };
      await db.sessions.put(newSession);
      result = { before: undefined, after: newSession };
      action = 'created';
      log.debug('upsertSession] After create - title:', newSession.title);
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

  async listSessions(cursor?: string, limit: number = 50): Promise<LocalSession[]> {
    const db = getDatabase();
    const query = db.sessions.orderBy('updated_at').reverse();
    const all = await query.toArray();
    log.debug(`listSessions] total=${all.length}, with deleted_at=${all.filter(s => s.deleted_at).length}`);
    // Filter soft-deleted items (deleted_at non-empty means deleted)
    const active = all.filter(s => !s.deleted_at);
    log.debug(`listSessions] after filter=${active.length}`);
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
    log.debug(`softDeleteSession] setting deleted_at=${now} for ${clientId}`);
    const result = await this.upsertSession(
      {
        client_id: clientId,
        deleted_at: now,
        updated_at: now,
      },
      'pending',
    );
    log.debug(`softDeleteSession] after upsert, deleted_at=${result.after.deleted_at}`);
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
   * Get the next RTC to process.
   * Priority: sync_status='failed' (retry) > status='pending' (awaiting execution).
   * Ordering: ascending by offset.
   *
   * Note: status='pending' means the tool has not been executed yet, regardless of sync_status.
   *
   * @param sessionClientId Optional session filter
   */
  async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
    const db = getDatabase();

    // Non-local-device RTCs are already filtered at write time; here we only filter by session
    const matchesSession = (rtc: LocalRtc): boolean => {
      if (!sessionClientId) return true;
      return rtc.session_client_id === sessionClientId;
    };

    // 1. First look for sync_status = 'failed' (need retry submission)
    const failed = await db.rtcs
      .where('sync_status')
      .equals('failed')
      .sortBy('offset');

    const matchFailed = failed.find(r => matchesSession(r));
    if (matchFailed) {
      return matchFailed;
    }

    // 2. Then look for status = 'pending' (new tasks awaiting execution)
    // Regardless of sync_status, status='pending' means not yet executed
    const allPending = await db.rtcs
      .filter(r => r.status === 'pending')
      .sortBy('offset');

    return allPending.find(r => matchesSession(r));
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
    for (let i = 0; i < update.items.length; i++) {
      const item = update.items[i];
      const data = update.data_list?.[i];

      if (!data) continue;

      await this.applyUpdateItem(item, data);
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
    log.warn(` ${entityType} ${entityId} references unknown session ${serverSessionId}`);
    return serverSessionId;
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
            log.warn(` Message ${raw.client_id || raw.id} references unknown parent ${raw.parent_message_id}`);
          }
        }
        delete (mapped as Record<string, unknown>)['parent_message_id'];
        await this.upsertMessage(mapped, 'synced');
        break;
      }
      case 'rtc': {
        const raw = data as Rtc;
        // session_id -> session_client_id: resolve session's client_id
        let sessionClientId: string | undefined;
        if (raw.session_id) {
          const session = await this.getSessionByServerId(raw.session_id);
          if (session) {
            // Write-time filter: skip RTCs whose session belongs to a different device
            if (session.device_id && session.device_id !== this.deviceId) {
              log.debug(`Skipping RTC ${raw.client_id || raw.id} - session belongs to different device`);
              return;
            }
            sessionClientId = session.client_id;
          } else {
            log.warn(` Rtc ${raw.client_id || raw.id} references unknown session ${raw.session_id}`);
            sessionClientId = raw.session_id;
          }
        }

        const mapped: Partial<LocalRtc> = {
          ...raw,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
          session_client_id: sessionClientId || '',
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
 * The Device ID is used to filter non-local-device RTCs on write.
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
