/**
 * Entity Repository
 *
 * Central CRUD layer for all RTC Agent entities (sessions, turns, messages, RTCs)
 * backed by IndexedDB via Dexie. Handles upsert operations, batch updates,
 * parent-child relationship resolution (pending parent server IDs), sync status
 * tracking, and UIUpdateBus emission for reactive UI updates.
 *
 * This file is intentionally large (1700+ lines) because it manages the complete
 * lifecycle of all entities with their interdependencies. Session/turn/message/RTC
 * operations share common patterns (sync status, parent resolution, UI bus emission)
 * that are tightly coupled. Splitting by entity type would duplicate the shared
 * infrastructure and obscure the cross-entity consistency guarantees.
 *
 * ## Conflict Resolution Strategy
 *
 * When the same entity is modified concurrently (e.g., on multiple devices before sync),
 * the current strategy is **last-write-wins**: the most recent write (by wall-clock time)
 * overwrites earlier writes. This is a deliberate simplification given the single-user,
 * multi-device architecture where concurrent edits to the same entity are rare.
 *
 * Sync status tracking ('synced' | 'pending' | 'error') helps detect and resolve conflicts
 * at the application layer during server sync. For critical data (e.g., turn/message ordering),
 * server-side conflict resolution provides the source of truth.
 *
 * Future enhancements may include vector clocks or CRDTs if concurrent edit frequency increases.
 */
import {
  getDatabase,
  type LocalSession,
  type LocalTurn,
  type LocalMessage,
  type LocalRtc,
  type SyncStatus,
} from './database.js';
import { getUIUpdateBus } from './ui-update-bus.js';
import { nowRFC3339 } from './time-utils.js';
import type {
  Update,
  UpdateItem,
  UpdateEntity,
  UpdateAction,
} from '@rtc-agent/protocol';
import {
  isValidSession,
  isValidTurn,
  isValidMessage,
  isValidRtc,
  extractClientId,
  extractStringField,
} from '@rtc-agent/protocol';
import Dexie, { type Table } from 'dexie';
import diff from 'microdiff';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('EntityRepository');

/**
 * Extended message type with temporary field for parent message ID resolution.
 * Used during batch upsert to store pending server IDs before resolution.
 */
interface MessageWithPendingParent extends Partial<LocalMessage> {
  _pending_parent_server_id?: string;
}

/**
 * Upsert options.
 */
export interface UpsertOptions {
  /** When true, does not publish update events to UIUpdateBus */
  silent?: boolean;
  /** When true, does not modify sync_status (for aggregation updates like turn counts) */
  preserveSyncStatus?: boolean;
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
 * Result of batch operations grouped by entity type.
 */
interface BatchEntities {
  sessions: Partial<LocalSession>[];
  turns: Partial<LocalTurn>[];
  messages: Partial<LocalMessage>[];
  rtcs: Partial<LocalRtc>[];
}

/**
 * P0-FIX: Structured conflict resolution record for debugging and auditing.
 * Provides detailed information about how conflicts were resolved.
 */
interface ConflictResolution {
  /** The entity's client_id */
  entityId: string;
  /** Entity type (session, turn, message, rtc) */
  entityType: string;
  /** Resolution strategy: 'local-wins' or 'server-wins' */
  strategy: 'local-wins' | 'server-wins';
  /** Reason for the resolution decision */
  reason: string;
  /** Which version won: 'existing' (local) or 'incoming' (server) */
  winner: 'existing' | 'incoming';
  /** Existing entity's timestamp */
  existingTimestamp: string;
  /** Incoming entity's timestamp */
  incomingTimestamp: string;
  /** Existing entity's sync status */
  existingSyncStatus?: string;
  /** When the conflict was resolved */
  resolvedAt: string;
}

/**
 * client_id collection for batch delete operations (grouped by entity type).
 *
 * `_pendingDeleteServerIds` temporarily stores items that have not yet been resolved from server_id to client_id,
 * resolved and cleared by `resolveDeleteClientIds`.
 */
interface BatchDeletes {
  sessions: string[];
  turns: string[];
  messages: string[];
  rtcs: string[];
  _pendingDeleteServerIds: Map<UpdateEntity, string[]>;
}

/**
 * Result of bulkGet: Map<client_id, record> organized by entity type.
 *
 * Only used within transactions (returned by `bulkGetExisting`).
 */
interface ExistingData {
  sessions: Map<string, LocalSession>;
  turns: Map<string, LocalTurn>;
  messages: Map<string, LocalMessage>;
  rtcs: Map<string, LocalRtc>;
}

/**
 * Entity record type for before-snapshots in UI update emission.
 * Represents any entity type that has a client_id field.
 */
type EntityRecord = Record<string, unknown>;

/**
 * Check whether applying an incoming message's streaming_status would
 * cause a state regression.
 *
 * The streaming_status lifecycle is one-directional:
 *   pending → streaming → completed / failed
 *
 * Once a message reaches a terminal state (completed / failed),
 * it must not revert to an earlier state (streaming / pending).
 * This prevents live-channel streaming updates from overwriting
 * the final completed content received via the topic channel.
 *
 * P1-FIX: Also detect streaming -> pending regression to prevent
 * out-of-order updates from reverting in-progress streaming content.
 *
 * Same-state updates are always allowed:
 * - streaming → streaming (newer streaming content replaces older)
 * - completed → completed (idempotent)
 */
function isStreamingStatusRegression(
  existingStatus: string | undefined,
  incomingStatus: string | undefined,
): boolean {
  if (!existingStatus || !incomingStatus) return false;
  if (existingStatus === incomingStatus) return false; // Same state: always OK

  // Terminal states must not regress to non-terminal states
  if (existingStatus === 'completed' || existingStatus === 'failed') {
    return incomingStatus === 'streaming' || incomingStatus === 'pending';
  }

  // P1-FIX: streaming -> pending is also a regression
  // This prevents out-of-order updates from reverting streaming progress
  if (existingStatus === 'streaming' && incomingStatus === 'pending') {
    return true;
  }

  return false;
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
async function emitUIUpdates(
  entity: UpdateEntity,
  action: UpdateAction,
  entityId: string,
  before: object | undefined,
  after: object,
): Promise<void> {
  const bus = getUIUpdateBus();

  // Deep clone to ensure data is structurally cloneable (for Comlink postMessage transport).
  // Avoids DataCloneError from non-cloneable objects (circular references, DOM elements, functions, etc.)
  const cloneableAfter = safeClone(after);
  const cloneableBefore = before ? safeClone(before) : undefined;

  if (!cloneableBefore) {
    // Create: emit a CREATE event for each top-level field in after
    for (const [field, newValue] of Object.entries(cloneableAfter)) {
      await bus.publish({
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
    await bus.publish({
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
 * Uses `structuredClone()` when available (preferred for performance and correctness),
 * falling back to JSON serialize/deserialize for environments that don't support it.
 * JSON fallback strips non-cloneable objects (functions, DOM elements, etc.).
 *
 * Returns an empty object if serialization fails to avoid DataCloneError.
 *
 * Returns Record<string, unknown> since both methods produce plain objects.
 */
function safeClone(obj: object): Record<string, unknown> {
  try {
    // Prefer structuredClone for performance and to preserve more data types
    if (typeof structuredClone === 'function') {
      return structuredClone(obj) as Record<string, unknown>;
    }
  } catch {
    // structuredClone failed (e.g., non-cloneable object), fall through to JSON
  }

  try {
    // Fallback to JSON for environments without structuredClone or when it fails
    return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  } catch {
    // JSON serialization also failed (e.g. circular reference); return empty object
    log.warn('safeClone: failed to clone object, returning empty object');
    return {};
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
      throw new Error(
        '[EntityRepository] deviceId is required, got empty value',
      );
    }
    this.deviceId = deviceId;
  }

  // ========== Session ==========

  async upsertSession(
    session: Partial<LocalSession>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions,
  ): Promise<UpsertResult<LocalSession>> {
    const db = getDatabase();
    const now = nowRFC3339();

    // Wrap read-modify-write in transaction for atomicity.
    // Dexie supports transaction nesting: if already inside a transaction, reuses parent.
    return db.transaction('rw', db.sessions, db.ui_updates, async () => {
      // Look up by client_id (inside transaction)
      let existing: LocalSession | undefined;
      if (session.client_id) {
        existing = await db.sessions
          .where('client_id')
          .equals(session.client_id)
          .first();
      }

      log.debug(
        'upsertSession:',
        existing ? 'UPDATE' : 'CREATE',
        'client_id:',
        session.client_id,
        'title:',
        session.title,
      );

      let result: UpsertResult<LocalSession>;
      let action: UpdateAction;
      if (existing) {
        const before: LocalSession = { ...existing };
        const updated: LocalSession = {
          ...existing,
          ...session,
          // preserveSyncStatus: keep existing sync_status for aggregation updates (e.g. turn counts)
          sync_status: options?.preserveSyncStatus
            ? existing.sync_status
            : syncStatus,
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
        await emitUIUpdates(
          'session',
          action,
          result.after.client_id,
          result.before,
          result.after,
        );
      }
      return result;
    });
  }

  async getClientSession(clientId: string): Promise<LocalSession | undefined> {
    const db = getDatabase();
    return db.sessions.get(clientId);
  }

  async getSessionByServerId(
    serverId: string,
  ): Promise<LocalSession | undefined> {
    const db = getDatabase();
    return db.sessions.where('server_id').equals(serverId).first();
  }

  async getMessageByServerId(
    serverId: string,
  ): Promise<LocalMessage | undefined> {
    const db = getDatabase();
    return db.messages.where('server_id').equals(serverId).first();
  }

  /**
   * List all active sessions, ordered by updated_at descending.
   *
   * @param cursor - Optional cursor for pagination (client_id of the last item on the previous page).
   *                 When omitted, returns all active sessions.
   * @param limit - Maximum number of sessions to return. Defaults to 10000 (effectively unlimited).
   *                Pass a smaller value for pagination scenarios.
   *
   * Performance notes:
   * - This method loads ALL sessions from IndexedDB into memory, then filters (soft-delete) and
   *   sorts in JavaScript. The `updated_at` index is defined in the schema but is NOT used here
   *   because Dexie cannot combine index-based sorting with in-memory filtering on `deleted_at`.
   * - For typical use cases (< 1000 sessions), performance is acceptable.
   * - For larger datasets, consider: (a) adding a compound index on [deleted_at+updated_at],
   *   (b) using a separate "active sessions" view/table, or (c) implementing true cursor-based
   *   pagination at the database level.
   * - UI layer (session-tree) does not use virtual scrolling yet; rendering > 1000 sessions may
   *   cause lag.
   *
   * @returns Array of active (non-deleted) sessions, ordered by updated_at descending.
   */
  async listSessions(
    cursor?: string,
    limit: number = 10000,
  ): Promise<LocalSession[]> {
    const db = getDatabase();

    // PERFORMANCE: Use compound index [deleted_at+updated_at] (added in v16) for DB-level
    // cursor pagination. For active sessions, deleted_at is undefined/falsy. We filter after
    // querying to handle all falsy cases (undefined, null, 0).
    //
    // Cursor pagination: find cursor session's updated_at, then query sessions with
    // updated_at < cursor.updated_at (for backward pagination through time).
    //
    // Note: If deleted_at is consistently 0 for active sessions (not undefined), we could
    // use where('[deleted_at+updated_at]').between([0, -Infinity], [0, cursorUpdatedAt])
    // for even better performance. Current implementation handles all falsy deleted_at values.

    let cursorUpdatedAt: number | null = null;
    if (cursor) {
      const cursorSession = await db.sessions.get(cursor);
      if (!cursorSession) {
        log.warn(
          `listSessions: cursor ${cursor} not found, returning from start`,
        );
      } else if (cursorSession.updated_at) {
        cursorUpdatedAt = new Date(cursorSession.updated_at).getTime();
      }
    }

    // Query sessions ordered by updated_at descending
    let query = db.sessions.orderBy('updated_at').reverse();

    // If cursor provided, start from sessions older than cursor
    if (cursorUpdatedAt !== null) {
      query = db.sessions
        .where('updated_at')
        .below(new Date(cursorUpdatedAt).toISOString())
        .reverse();
    }

    // Filter for active sessions (not deleted)
    const active = await query
      .filter((s) => !s.deleted_at)
      .limit(limit)
      .toArray();

    if (active.length > 1000) {
      log.warn(
        `listSessions: ${active.length} active sessions loaded. ` +
          `Consider implementing virtual scrolling in the UI layer if performance degrades.`,
      );
    }

    return active;
  }

  /**
   * Soft-delete a session: sets deleted_at + updated_at, marks sync_status='pending'.
   *
   * Does not directly delete the IndexedDB row; data is preserved for sync purposes.
   * listSessions automatically filters out records with non-empty deleted_at.
   *
   * Wrapped in a transaction to prevent TOCTOU race where concurrent modifications
   * could see inconsistent state between the existence check and the write.
   *
   * NOTE: This method calls upsertSession() which also opens a transaction.
   * Dexie supports nested transactions: when called within an existing transaction,
   * upsertSession() reuses the parent transaction rather than creating a new one.
   * This ensures atomicity while keeping the code modular.
   */
  async softDeleteSession(
    clientId: string,
  ): Promise<UpsertResult<LocalSession>> {
    const db = getDatabase();
    const now = nowRFC3339();
    log.debug(`softDeleteSession: setting deleted_at=${now} for ${clientId}`);

    // Perform existence check and upsert within the same transaction
    return db.transaction('rw', db.sessions, db.ui_updates, async () => {
      const existing = await db.sessions.get(clientId);
      if (!existing) {
        throw new Error(
          `[EntityRepository] softDeleteSession: session not found: ${clientId}`,
        );
      }
      // upsertSession() will detect the outer transaction and reuse it (Dexie nested transaction)
      return this.upsertSession(
        {
          client_id: clientId,
          deleted_at: now,
          updated_at: now,
        },
        'pending',
      );
    });
  }

  // ========== Turn ==========

  async upsertTurn(
    turn: Partial<LocalTurn>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions,
  ): Promise<UpsertResult<LocalTurn>> {
    const db = getDatabase();
    const now = nowRFC3339();

    // Wrap read-modify-write in transaction for atomicity
    return db.transaction('rw', db.turns, db.ui_updates, async () => {
      let existing: LocalTurn | undefined;
      if (turn.client_id) {
        existing = await db.turns
          .where('client_id')
          .equals(turn.client_id)
          .first();
      }

      let result: UpsertResult<LocalTurn>;
      let action: UpdateAction;
      if (existing) {
        const before: LocalTurn = { ...existing };
        const updated: LocalTurn = {
          ...existing,
          ...turn,
          sync_status: options?.preserveSyncStatus
            ? existing.sync_status
            : syncStatus,
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
        log.debug(
          '[EntityRepository] Emitting turn UI update:',
          action,
          result.after.client_id,
          'session:',
          result.after.session_client_id,
        );
        await emitUIUpdates(
          'turn',
          action,
          result.after.client_id,
          result.before,
          result.after,
        );
      }
      return result;
    });
  }

  async getClientTurn(clientId: string): Promise<LocalTurn | undefined> {
    const db = getDatabase();
    return db.turns.get(clientId);
  }

  /**
   * Count pending/running turns for a session in a single pass.
   * Used for write-time aggregation: after writing turn rows, the counts are written
   * back to the session row.
   *
   * IMPORTANT: The two queries are run sequentially (not in parallel) to ensure
   * consistent counts when called within a transaction. Running them in parallel
   * with Promise.all could interleave with other concurrent transactions (e.g.,
   * from another tab via Dexie's observability), causing the two counts to see
   * different snapshots of the turns table.
   *
   * Indexed queries (v15+): uses [session_client_id+status] compound index,
   * directly matching both session and status without in-memory filtering.
   * Prior implementation used where('session_client_id').filter(status===...),
   * which required a full scan of the session's turns.
   */
  async countActiveTurns(
    sessionClientId: string,
  ): Promise<{ pending: number; running: number }> {
    const db = getDatabase();
    // Sequential queries for transaction consistency (see docstring above).
    // Each query uses the [session_client_id+status] compound index for exact match.
    const pending = await db.turns
      .where('[session_client_id+status]')
      .equals([sessionClientId, 'pending'])
      .count();
    const running = await db.turns
      .where('[session_client_id+status]')
      .equals([sessionClientId, 'running'])
      .count();
    return { pending, running };
  }

  // ========== Message ==========

  async upsertMessage(
    message: Partial<LocalMessage>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions,
  ): Promise<UpsertResult<LocalMessage>> {
    const db = getDatabase();
    const now = nowRFC3339();

    // Wrap read-modify-write in transaction for atomicity
    return db.transaction('rw', db.messages, db.ui_updates, async () => {
      let existing: LocalMessage | undefined;
      if (message.client_id) {
        existing = await db.messages
          .where('client_id')
          .equals(message.client_id)
          .first();
      }

      let result: UpsertResult<LocalMessage>;
      let action: UpdateAction;
      if (existing) {
        const before: LocalMessage = { ...existing };

        // ── Streaming status monotonic guard (Issue 236) ──
        // Prevent live-channel streaming updates from overwriting
        // topic-channel completed/final state.
        if (
          isStreamingStatusRegression(
            existing.streaming_status,
            message.streaming_status,
          )
        ) {
          log.debug(
            'upsertMessage: skip streaming regression',
            'client_id:',
            message.client_id,
            'existing:',
            existing.streaming_status,
            'incoming:',
            message.streaming_status,
          );
          // Return existing state unchanged — the update is a no-op.
          return { before, after: existing };
        }

        const updated: LocalMessage = {
          ...existing,
          ...message,
          sync_status: options?.preserveSyncStatus
            ? existing.sync_status
            : syncStatus,
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
        await emitUIUpdates(
          'message',
          action,
          result.after.client_id,
          result.before,
          result.after,
        );
      }
      return result;
    });
  }

  async getClientMessage(clientId: string): Promise<LocalMessage | undefined> {
    const db = getDatabase();
    return db.messages.get(clientId);
  }

  async listMessagesBySession(
    sessionClientId: string,
    cursor?: string,
    limit: number = 50,
    direction: 'backward' | 'forward' = 'backward',
  ): Promise<LocalMessage[]> {
    const db = getDatabase();

    // PERFORMANCE: Use compound index [session_client_id+created_at] for DB-level sorting.
    // This avoids loading all messages into memory and sorting in JavaScript.
    // The compound index allows us to query by session_client_id and get results
    // already sorted by created_at, enabling efficient cursor-based pagination.
    //
    // Cursor format: "${timestamp}|${clientId}" for deterministic ordering.
    // Dexie compound index [session_client_id+created_at] enables range queries within a session.

    const MAX_SESSION_MESSAGES = 10000;

    if (cursor) {
      // Parse cursor: format is "${timestamp}|${clientId}"
      const parts = cursor.split('|');
      if (parts.length !== 2) {
        log.warn(
          `Invalid cursor format: ${cursor}, expected "timestamp|clientId"`,
        );
      } else {
        const cursorTs = parseInt(parts[0], 10);
        const cursorClientId = parts[1];
        const cursorDate = new Date(cursorTs).toISOString();

        if (direction === 'backward') {
          // Backward: get messages with created_at < cursor timestamp
          const messages = await db.messages
            .where('[session_client_id+created_at]')
            .between(
              [sessionClientId, ''],
              [sessionClientId, cursorDate],
              false, // exclude lower bound
              false, // exclude upper bound (cursorDate)
            )
            .reverse()
            .limit(limit * 2)
            .toArray();

          // Filter strictly less than cursor (handle ties with client_id)
          const filtered = messages.filter((m) => {
            const ts = new Date(m.created_at).getTime();
            return (
              ts < cursorTs || (ts === cursorTs && m.client_id < cursorClientId)
            );
          });

          // Sort in ascending order (oldest first) before returning
          return filtered.slice(0, limit).sort((a, b) => {
            const tsA = new Date(a.created_at).getTime();
            const tsB = new Date(b.created_at).getTime();
            if (tsA !== tsB) return tsA - tsB;
            return a.client_id.localeCompare(b.client_id);
          });
        } else {
          // Forward: get messages with created_at > cursor timestamp
          const messages = await db.messages
            .where('[session_client_id+created_at]')
            .between(
              [sessionClientId, cursorDate],
              [sessionClientId, '￿'],
              false, // exclude lower bound (cursorDate)
              true, // include upper bound
            )
            .limit(limit * 2)
            .toArray();

          // Filter strictly greater than cursor
          const filtered = messages.filter((m) => {
            const ts = new Date(m.created_at).getTime();
            return (
              ts > cursorTs || (ts === cursorTs && m.client_id > cursorClientId)
            );
          });

          // Sort in ascending order (oldest first) before returning
          return filtered.slice(0, limit).sort((a, b) => {
            const tsA = new Date(a.created_at).getTime();
            const tsB = new Date(b.created_at).getTime();
            if (tsA !== tsB) return tsA - tsB;
            return a.client_id.localeCompare(b.client_id);
          });
        }
      }
    }

    // No cursor: get first page
    // PERFORMANCE: Use compound index [session_client_id+created_at] for DB-level sorting.
    // This avoids in-memory sorting and leverages IndexedDB's native ordering.
    // The compound index was added in v15 schema migration.
    const allMessages = await db.messages
      .where('[session_client_id+created_at]')
      .between(
        [sessionClientId, Dexie.minKey],
        [sessionClientId, Dexie.maxKey],
      )
      .limit(MAX_SESSION_MESSAGES)
      .toArray();

    if (allMessages.length >= MAX_SESSION_MESSAGES) {
      log.warn(
        `listMessagesBySession: session ${sessionClientId} has >= ${MAX_SESSION_MESSAGES} messages, ` +
          `results may be truncated.`,
      );
    }

    // Messages are already sorted by created_at via compound index.
    // For ties in created_at, sort by client_id (secondary sort key).
    allMessages.sort((a, b) => {
      const tsA = new Date(a.created_at).getTime();
      const tsB = new Date(b.created_at).getTime();
      if (tsA !== tsB) return tsA - tsB;
      return a.client_id.localeCompare(b.client_id);
    });

    if (direction === 'backward') {
      // Backward from now: get most recent messages
      return allMessages.slice(-limit);
    } else {
      // Forward from start: get oldest messages
      return allMessages.slice(0, limit);
    }
  }

  // ========== Rtc ==========

  async upsertRtc(
    rtc: Partial<LocalRtc>,
    syncStatus: SyncStatus = 'synced',
    options?: UpsertOptions,
  ): Promise<UpsertResult<LocalRtc>> {
    const db = getDatabase();
    const now = nowRFC3339();

    // Wrap read-modify-write in transaction for atomicity
    return db.transaction('rw', db.rtcs, db.ui_updates, async () => {
      let existing: LocalRtc | undefined;
      if (rtc.client_id) {
        existing = await db.rtcs
          .where('client_id')
          .equals(rtc.client_id)
          .first();
      }

      let result: UpsertResult<LocalRtc>;
      let action: UpdateAction;
      if (existing) {
        const before: LocalRtc = { ...existing };
        const updated: LocalRtc = {
          ...existing,
          ...rtc,
          sync_status: options?.preserveSyncStatus
            ? existing.sync_status
            : syncStatus,
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
        await emitUIUpdates(
          'rtc',
          action,
          result.after.client_id,
          result.before,
          result.after,
        );
      }
      return result;
    });
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
  async getNextRtcToProcess(
    sessionClientId?: string,
  ): Promise<LocalRtc | undefined> {
    const db = getDatabase();

    // Filter by session (optional)
    const matchesSession = (rtc: LocalRtc): boolean => {
      if (!sessionClientId) return true;
      return rtc.session_client_id === sessionClientId;
    };

    // Filter by device ID (execution-time filtering).
    //
    // SECURITY: This is the critical security boundary that prevents cross-device script execution.
    // Only RTCs whose session_device_id matches the local Device ID are executed on this device.
    //
    // LENIENT MODE: RTCs with empty/undefined session_device_id are allowed. This is for backward
    // compatibility with older RTCs that may not have device_id set. In production environments,
    // all RTCs should have device_id set by the server. Consider strict mode (reject empty device_id)
    // for high-security deployments.
    //
    // CROSS-TAB SAFETY: Device ID is stored in localStorage and shared across Tabs. If localStorage
    // is unavailable, each Tab generates a different ephemeral UUID, which may cause RTC filtering
    // to fail (scripts silently don't execute). Ensure localStorage is available in production.
    const matchesDevice = (rtc: LocalRtc): boolean => {
      if (!rtc.session_device_id) return true; // Lenient mode: allow empty device_id
      return rtc.session_device_id === this.deviceId;
    };

    // 1. First look for sync_status = 'failed' (need retry submission)
    // PERFORMANCE: Use compound index [sync_status+offset] for DB-level sorting by offset.
    // Dexie.minKey and Dexie.maxKey are special values that represent the minimum and maximum
    // possible values for any type, enabling range queries across all offset values.
    const Dexie = (await import('dexie')).default;
    const failed = await db.rtcs
      .where('[sync_status+offset]')
      .between(['failed', Dexie.minKey], ['failed', Dexie.maxKey])
      .toArray();

    const matchFailed = failed.find(
      (r) => matchesSession(r) && matchesDevice(r),
    );
    if (matchFailed) {
      return matchFailed;
    }

    // 2. Then look for status = 'pending' (new tasks awaiting execution)
    // Regardless of sync_status, status='pending' means not yet executed
    // PERFORMANCE: Use compound index [status+offset] for DB-level sorting by offset.
    const allPending = await db.rtcs
      .where('[status+offset]')
      .between(['pending', Dexie.minKey], ['pending', Dexie.maxKey])
      .toArray();

    return allPending.find((r) => matchesSession(r) && matchesDevice(r));
  }

  /**
   * List RTCs for a session (ascending by offset).
   *
   * PERFORMANCE: Uses compound index [session_client_id+offset] for DB-level sorting.
   * This avoids loading all RTCs for the session into memory before sorting.
   * The compound index allows querying by session_client_id and getting results
   * already sorted by offset, enabling efficient cursor-based pagination.
   *
   * NOTE: Device ID filtering is NOT applied here — this method returns all RTCs for
   * the session regardless of device. Device filtering is only applied in
   * getNextRtcToProcess() at execution time.
   */
  async listRtcBySession(
    sessionClientId: string,
    cursor?: number,
    limit: number = 50,
  ): Promise<LocalRtc[]> {
    const db = getDatabase();
    const Dexie = (await import('dexie')).default;

    // Use compound index [session_client_id+offset] for DB-level cursor pagination.
    // Results are already sorted by offset from the index, eliminating the need for
    // in-memory sorting.
    const startOffset = cursor ?? 0;
    const items = await db.rtcs
      .where('[session_client_id+offset]')
      .between(
        [sessionClientId, startOffset],
        [sessionClientId, Dexie.maxKey],
        true, // include lower bound (startOffset)
        true, // include upper bound
      )
      .limit(limit)
      .toArray();

    return items;
  }

  // ========== Update processing ==========

  /**
   * Process an Update event (from Publication or RPC response).
   *
   * After each item is written to IndexedDB, field-level update events are
   * asynchronously published (awaited) to UIUpdateBus.
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

    log.info(
      `[applyUpdates] Processing ${updates.length} updates, ${totalItems} items`,
    );

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
    const beforeSnapshots = new Map<string, EntityRecord>();
    let merged: BatchEntities = {
      sessions: [],
      turns: [],
      messages: [],
      rtcs: [],
    };

    // C2-FIX: Split large transactions into smaller batches to prevent timeout.
    // Strategy: Keep read-merge atomic, split writes by entity type.
    // This maintains data consistency while reducing transaction scope.
    const BATCH_THRESHOLD = 100; // Split if total items exceed this
    const totalWriteItems =
      merged.sessions.length +
      merged.turns.length +
      merged.messages.length +
      merged.rtcs.length +
      deletes.sessions.length +
      deletes.turns.length +
      deletes.messages.length +
      deletes.rtcs.length;

    try {
      if (totalWriteItems <= BATCH_THRESHOLD) {
        // Small batch: use original single-transaction approach
        const txStartTime = performance.now();
        await db.transaction('rw', tablesToLock, async () => {
          // 7a. bulkGet existing records (within transaction)
          const existingData = await this.bulkGetExisting(prepared);

          // 7b. Collect before snapshots (original records before merge)
          this.collectBeforeSnapshots(beforeSnapshots, existingData);

          // 7c. Merge in memory: { ...existing, ...newData }
          merged = this.mergeWithExisting(prepared, existingData);

          // 7d. bulkPut writes
          if (merged.sessions.length > 0)
            await db.sessions.bulkPut(merged.sessions as LocalSession[]);
          if (merged.turns.length > 0)
            await db.turns.bulkPut(merged.turns as LocalTurn[]);
          if (merged.messages.length > 0)
            await db.messages.bulkPut(merged.messages as LocalMessage[]);
          if (merged.rtcs.length > 0)
            await db.rtcs.bulkPut(merged.rtcs as LocalRtc[]);

          // 7e. bulkDelete deletes
          if (deletes.sessions.length > 0)
            await db.sessions.bulkDelete(deletes.sessions);
          if (deletes.turns.length > 0) await db.turns.bulkDelete(deletes.turns);
          if (deletes.messages.length > 0)
            await db.messages.bulkDelete(deletes.messages);
          if (deletes.rtcs.length > 0) await db.rtcs.bulkDelete(deletes.rtcs);

          // 7f. Turn count writeback (within same transaction, re-read sessions from DB)
          await this.writebackTurnCountsInTx(merged.turns);
        });

        // P1-FIX: Monitor transaction duration for performance debugging
        const txElapsed = performance.now() - txStartTime;
        if (txElapsed > 5000) {
          log.warn(
            `[applyUpdates] Small batch transaction took ${txElapsed.toFixed(1)}ms ` +
            `(>${5000}ms threshold). Consider if batch size should be reduced. ` +
            `Items: ${totalWriteItems}`,
          );
        }
      } else {
        // C2-FIX: Large batch - split into multiple smaller transactions
        // Phase 1: Atomic read-merge (fast, no writes)
        const txStartTime = performance.now();
        await db.transaction('r', tablesToLock, async () => {
          const existingData = await this.bulkGetExisting(prepared);
          this.collectBeforeSnapshots(beforeSnapshots, existingData);
          merged = this.mergeWithExisting(prepared, existingData);
        });

        // P1-FIX: Monitor read-merge transaction duration
        const readMergeElapsed = performance.now() - txStartTime;
        if (readMergeElapsed > 5000) {
          log.warn(
            `[applyUpdates] Large batch read-merge took ${readMergeElapsed.toFixed(1)}ms ` +
            `(>${5000}ms threshold). Items: ${totalWriteItems}`,
          );
        }

        // Phase 2: Split writes by entity type (each in its own transaction)
        // This reduces transaction scope and timeout risk for large datasets
        if (merged.sessions.length > 0 || deletes.sessions.length > 0) {
          const txStart = performance.now();
          await db.transaction('rw', [db.sessions], async () => {
            if (merged.sessions.length > 0)
              await db.sessions.bulkPut(merged.sessions as LocalSession[]);
            if (deletes.sessions.length > 0)
              await db.sessions.bulkDelete(deletes.sessions);
          });
          const elapsed = performance.now() - txStart;
          if (elapsed > 5000) {
            log.warn(
              `[applyUpdates] Sessions write transaction took ${elapsed.toFixed(1)}ms ` +
              `(>${5000}ms threshold). Items: ${merged.sessions.length + deletes.sessions.length}`,
            );
          }
        }

        if (merged.turns.length > 0 || deletes.turns.length > 0) {
          const txStart = performance.now();
          await db.transaction('rw', [db.turns], async () => {
            if (merged.turns.length > 0)
              await db.turns.bulkPut(merged.turns as LocalTurn[]);
            if (deletes.turns.length > 0)
              await db.turns.bulkDelete(deletes.turns);
          });
          const elapsed = performance.now() - txStart;
          if (elapsed > 5000) {
            log.warn(
              `[applyUpdates] Turns write transaction took ${elapsed.toFixed(1)}ms ` +
              `(>${5000}ms threshold). Items: ${merged.turns.length + deletes.turns.length}`,
            );
          }
        }

        if (merged.messages.length > 0 || deletes.messages.length > 0) {
          const txStart = performance.now();
          await db.transaction('rw', [db.messages], async () => {
            if (merged.messages.length > 0)
              await db.messages.bulkPut(merged.messages as LocalMessage[]);
            if (deletes.messages.length > 0)
              await db.messages.bulkDelete(deletes.messages);
          });
          const elapsed = performance.now() - txStart;
          if (elapsed > 5000) {
            log.warn(
              `[applyUpdates] Messages write transaction took ${elapsed.toFixed(1)}ms ` +
              `(>${5000}ms threshold). Items: ${merged.messages.length + deletes.messages.length}`,
            );
          }
        }

        if (merged.rtcs.length > 0 || deletes.rtcs.length > 0) {
          const txStart = performance.now();
          await db.transaction('rw', [db.rtcs], async () => {
            if (merged.rtcs.length > 0)
              await db.rtcs.bulkPut(merged.rtcs as LocalRtc[]);
            if (deletes.rtcs.length > 0)
              await db.rtcs.bulkDelete(deletes.rtcs);
          });
          const elapsed = performance.now() - txStart;
          if (elapsed > 5000) {
            log.warn(
              `[applyUpdates] RTcs write transaction took ${elapsed.toFixed(1)}ms ` +
              `(>${5000}ms threshold). Items: ${merged.rtcs.length + deletes.rtcs.length}`,
            );
          }
        }

        // Phase 3: Turn count writeback (separate transaction)
        if (merged.turns.length > 0) {
          const txStart = performance.now();
          await db.transaction('rw', [db.sessions], async () => {
            await this.writebackTurnCountsInTx(merged.turns);
          });
          const elapsed = performance.now() - txStart;
          if (elapsed > 5000) {
            log.warn(
              `[applyUpdates] Turn count writeback took ${elapsed.toFixed(1)}ms ` +
              `(>${5000}ms threshold). Items: ${merged.turns.length}`,
            );
          }
        }
      }

      const elapsed = performance.now() - startTime;
      log.info(
        `[applyUpdates] Transaction completed in ${elapsed.toFixed(1)}ms: ` +
          `${merged.sessions.length} sessions, ${merged.turns.length} turns, ` +
          `${merged.messages.length} messages, ${merged.rtcs.length} rtcs, ` +
          `${deletes.sessions.length + deletes.turns.length + deletes.messages.length + deletes.rtcs.length} deletes`,
      );

      // 8. Emit batch UI updates (outside transaction)
      await this.emitBatchUIUpdates(beforeSnapshots, merged, deletes);
    } catch (err) {
      const elapsed = performance.now() - startTime;
      log.error(
        `[applyUpdates] Transaction failed after ${elapsed.toFixed(1)}ms:`,
        err,
      );
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
          const data = update.data_list?.[i] as
            | Record<string, unknown>
            | undefined;
          const clientId = data?.['client_id'] as string | undefined;

          if (clientId) {
            this.pushDelete(deletes, item.entity, clientId);
          } else {
            // entity_id is server_id, collect to pending list
            if (!deletes._pendingDeleteServerIds.has(item.entity)) {
              deletes._pendingDeleteServerIds.set(item.entity, []);
            }
            deletes._pendingDeleteServerIds
              .get(item.entity)!
              .push(item.entity_id);
          }
          continue;
        }

        const data = update.data_list?.[i] as
          | Record<string, unknown>
          | undefined;
        if (!data) continue;

        const clientId =
          (data['client_id'] as string) || (data['id'] as string);
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
    deletes: BatchDeletes,
  ): boolean {
    for (const items of upserts.values()) {
      if (items.length > 0) return false;
    }
    return (
      deletes.sessions.length === 0 &&
      deletes.turns.length === 0 &&
      deletes.messages.length === 0 &&
      deletes.rtcs.length === 0 &&
      deletes._pendingDeleteServerIds.size === 0
    );
  }

  /**
   * Push client_id to corresponding delete array by entity type.
   */
  private pushDelete(
    deletes: BatchDeletes,
    entity: UpdateEntity,
    clientId: string,
  ): void {
    switch (entity) {
      case 'session':
        deletes.sessions.push(clientId);
        break;
      case 'turn':
        deletes.turns.push(clientId);
        break;
      case 'message':
        deletes.messages.push(clientId);
        break;
      case 'rtc':
        deletes.rtcs.push(clientId);
        break;
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
    upserts: Map<UpdateEntity, UpsertItem[]>,
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
    const missingIds = [...sessionServerIds].filter((id) => !map.has(id));
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
    sessionMap: Map<string, LocalSession>,
  ): string {
    const session = sessionMap.get(serverId);
    if (!session) {
      log.warn(
        `Session ${serverId} not found in map, using server_id as client_id`,
      );
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
    sessionMap: Map<string, LocalSession>,
  ): BatchEntities {
    const result: BatchEntities = {
      sessions: [],
      turns: [],
      messages: [],
      rtcs: [],
    };

    const now = nowRFC3339();

    // Sessions
    for (const { data } of upserts.get('session') ?? []) {
      const raw = data as Record<string, unknown>;
      const serverId = raw['id'] as string;
      const clientId = (raw['client_id'] as string) || serverId;

      // Fill defaults first, then override with incoming data
      const { id: _id, ...rest } = raw as Partial<LocalSession> & {
        id?: string;
      };
      const mapped: Partial<LocalSession> = {
        owner_kind: '',
        owner_ref_id: '',
        status: 'active',
        created_at: now,
        updated_at: now,
        pending_turn_count: 0,
        running_turn_count: 0,
        agent_prompt: '',
        ...rest,
        // Force override incoming values
        server_id: serverId,
        client_id: clientId,
        sync_status: 'synced',
      };
      result.sessions.push(mapped);
    }

    // Turns
    for (const { data } of upserts.get('turn') ?? []) {
      const raw = data as Record<string, unknown>;
      const serverId = raw['id'] as string;
      const clientId = (raw['client_id'] as string) || serverId;
      const sessionId = raw['session_id'] as string | undefined;

      // Use destructuring to remove protocol-layer fields
      const {
        id: _id,
        session_id: _session_id,
        ...rest
      } = raw as Partial<LocalTurn> & { id?: string; session_id?: string };
      const mapped: Partial<LocalTurn> = {
        // Defaults
        session_client_id: '',
        status: 'pending',
        created_at: now,
        ...rest,
        // Force override
        server_id: serverId,
        client_id: clientId,
        sync_status: 'synced',
      } as Partial<LocalTurn>;

      // Field mapping: session_id → session_client_id
      if (sessionId) {
        mapped.session_client_id = this.resolveSessionClientId(
          sessionId,
          sessionMap,
        );
      }
      result.turns.push(mapped);
    }

    // Messages
    for (const { data } of upserts.get('message') ?? []) {
      const raw = data as Record<string, unknown>;
      const serverId = raw['id'] as string;
      const clientId = (raw['client_id'] as string) || serverId;
      const sessionId = raw['session_id'] as string | undefined;
      const parentMsgId = raw['parent_message_id'] as string | undefined;

      // Use destructuring to remove protocol-layer fields
      const {
        id: _id,
        session_id: _session_id,
        parent_message_id: _parent_message_id,
        ...rest
      } = raw as Partial<LocalMessage> & {
        id?: string;
        session_id?: string;
        parent_message_id?: string;
      };
      const mapped: MessageWithPendingParent = {
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
        ...rest,
        // Force override
        server_id: serverId,
        client_id: clientId,
        sync_status: 'synced',
      };

      // Field mapping: session_id → session_client_id
      if (sessionId) {
        mapped.session_client_id = this.resolveSessionClientId(
          sessionId,
          sessionMap,
        );
      }

      // Field mapping: parent_message_id → parent_client_id
      // Store as _pending_parent_server_id temporarily, resolve later in resolveParentMessageIds
      if (parentMsgId) {
        mapped._pending_parent_server_id = parentMsgId;
      }
      result.messages.push(mapped);
    }

    // Rtcs
    for (const { data } of upserts.get('rtc') ?? []) {
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

      // Use destructuring to remove protocol-layer fields
      const {
        id: _id,
        session_id: _session_id,
        ...rest
      } = raw as Partial<LocalRtc> & { id?: string; session_id?: string };
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
        ...rest,
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
    messages: MessageWithPendingParent[],
  ): Promise<void> {
    if (messages.length === 0) return;

    // Collect all pending parent server_ids
    const parentServerIds = new Set<string>();
    for (const msg of messages) {
      const pendingId = msg._pending_parent_server_id;
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
      (id) => !batchServerToClient.has(id),
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
      const pendingId = msg._pending_parent_server_id;
      if (pendingId) {
        const parentClientId = serverToClient.get(pendingId);
        if (parentClientId) {
          msg.parent_client_id = parentClientId;
        } else {
          log.warn(
            `[applyUpdates:message] parent message ${pendingId} not found in DB or current batch`,
          );
        }
        delete msg._pending_parent_server_id;
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
    sessionMap: Map<string, LocalSession>,
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
          const missing = serverIds.filter((sid) => !sessionMap.has(sid));
          if (missing.length > 0) {
            const sessions = await db.sessions
              .where('server_id')
              .anyOf(missing)
              .toArray();
            clientIds.push(...sessions.map((s) => s.client_id));
          }
          break;
        }
        case 'turn': {
          const turns = await db.turns
            .where('server_id')
            .anyOf(serverIds)
            .toArray();
          clientIds = turns.map((t) => t.client_id);
          break;
        }
        case 'message': {
          const msgs = await db.messages
            .where('server_id')
            .anyOf(serverIds)
            .toArray();
          clientIds = msgs.map((m) => m.client_id);
          break;
        }
        case 'rtc': {
          const rtcs = await db.rtcs
            .where('server_id')
            .anyOf(serverIds)
            .toArray();
          clientIds = rtcs.map((r) => r.client_id);
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
            `server_ids could not be resolved to client_ids (records not found in local DB, will be silently skipped)`,
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
    deletes: BatchDeletes,
  ): Table[] {
    const db = getDatabase();
    const tables: Table[] = [];

    if (
      (upserts.get('session')?.length ?? 0) > 0 ||
      deletes.sessions.length > 0
    ) {
      tables.push(db.sessions);
    }
    if ((upserts.get('turn')?.length ?? 0) > 0 || deletes.turns.length > 0) {
      tables.push(db.turns);
    }
    if (
      (upserts.get('message')?.length ?? 0) > 0 ||
      deletes.messages.length > 0
    ) {
      tables.push(db.messages);
    }
    if ((upserts.get('rtc')?.length ?? 0) > 0 || deletes.rtcs.length > 0) {
      tables.push(db.rtcs);
    }

    // Always include ui_updates table since emitUIUpdates may be called within this transaction
    tables.push(db.ui_updates);

    return tables;
  }

  /**
   * BulkGet existing records within transaction.
   *
   * Must be called within db.transaction('rw', ...) callback to ensure
   * read-modify-write atomicity.
   */
  private async bulkGetExisting(
    prepared: BatchEntities,
  ): Promise<ExistingData> {
    const db = getDatabase();

    // Build client_id arrays (for bulkGet by primary key)
    const sessionIds = prepared.sessions
      .map((s) => s.client_id!)
      .filter(Boolean);
    const turnIds = prepared.turns.map((t) => t.client_id!).filter(Boolean);
    const msgIds = prepared.messages.map((m) => m.client_id!).filter(Boolean);
    const rtcIds = prepared.rtcs.map((r) => r.client_id!).filter(Boolean);

    // Parallel bulkGet (parallel within transaction doesn't affect atomicity)
    const [existingSessions, existingTurns, existingMsgs, existingRtcs] =
      await Promise.all([
        sessionIds.length > 0 ? db.sessions.bulkGet(sessionIds) : [],
        turnIds.length > 0 ? db.turns.bulkGet(turnIds) : [],
        msgIds.length > 0 ? db.messages.bulkGet(msgIds) : [],
        rtcIds.length > 0 ? db.rtcs.bulkGet(rtcIds) : [],
      ]);

    // Build Maps for easy merge lookup
    const toMap = <T extends { client_id: string }>(
      ids: string[],
      records: (T | undefined)[],
    ): Map<string, T> => {
      const map = new Map<string, T>();
      records.forEach((r, i) => {
        if (r) map.set(ids[i], r);
      });
      return map;
    };

    return {
      sessions: toMap(
        sessionIds,
        existingSessions as (LocalSession | undefined)[],
      ),
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
    before: Map<string, EntityRecord>,
    existing: ExistingData,
  ): void {
    for (const [clientId, session] of existing.sessions) {
      before.set(`session:${clientId}`, session as unknown as EntityRecord);
    }
    for (const [clientId, turn] of existing.turns) {
      before.set(`turn:${clientId}`, turn as unknown as EntityRecord);
    }
    for (const [clientId, msg] of existing.messages) {
      before.set(`message:${clientId}`, msg as unknown as EntityRecord);
    }
    for (const [clientId, rtc] of existing.rtcs) {
      before.set(`rtc:${clientId}`, rtc as unknown as EntityRecord);
    }
  }

  /**
   * Merge in memory: { ...existing, ...newData } with timestamp-based conflict resolution.
   *
   * Pure synchronous operation, no DB calls. Must be called within transaction
   * (using bulkGetExisting result).
   *
   * Conflict Resolution Strategy:
   * - For entities with updated_at (Session, Message, Rtc): compare timestamps
   *   - incoming newer: use incoming (normal case)
   *   - existing newer AND has unsynced changes (sync_status='pending'): keep existing, log conflict
   *   - existing newer AND already synced: use incoming (server data wins)
   *   - timestamps equal: use incoming (idempotent)
   * - For entities without updated_at (Turn): use incoming (no conflict detection possible)
   */
  private mergeWithExisting(
    prepared: BatchEntities,
    existing: ExistingData,
  ): BatchEntities {
    /**
     * Compare RFC3339 timestamps and return the "winner" based on last-write-wins.
     * Returns { winner, isConflict, resolution } where isConflict indicates existing was newer
     * AND has unsynced local changes. Resolution provides detailed conflict resolution info.
     */
    const resolveByTimestamp = <
      T extends { updated_at?: string; sync_status?: string },
    >(
      incoming: T,
      existingEntity: T,
      entityName: string,
      clientId: string,
    ): { winner: T; isConflict: boolean; resolution?: ConflictResolution } => {
      const incomingTs = incoming.updated_at;
      const existingTs = existingEntity.updated_at;

      // If either lacks timestamp, fall back to incoming (no conflict detection)
      if (!incomingTs || !existingTs) {
        return { winner: incoming, isConflict: false };
      }

      // Compare timestamps (RFC3339 strings are lexicographically comparable)
      if (incomingTs > existingTs) {
        // Incoming is newer: normal case, use incoming
        return { winner: incoming, isConflict: false };
      } else if (existingTs > incomingTs) {
        // Existing is newer: potential conflict
        // P0-FIX: More precise sync_status check - only 'pending' indicates unsynced local changes
        // Other statuses ('synced', 'syncing', 'error') mean the data is already on server
        const hasUnsyncedChanges = existingEntity.sync_status === 'pending';

        if (hasUnsyncedChanges) {
          // P0-FIX: Structured conflict resolution with detailed logging
          const resolution: ConflictResolution = {
            entityId: clientId,
            entityType: entityName,
            strategy: 'local-wins',
            reason: 'existing-newer-with-unsynced-changes',
            winner: 'existing',
            existingTimestamp: existingTs,
            incomingTimestamp: incomingTs,
            existingSyncStatus: existingEntity.sync_status,
            resolvedAt: nowRFC3339(),
          };

          log.warn(
            `mergeWithExisting: conflict detected in ${entityName}`,
            JSON.stringify(resolution, null, 2),
          );

          return { winner: existingEntity, isConflict: true, resolution };
        } else {
          // Already synced or in other state: server data wins
          const resolution: ConflictResolution = {
            entityId: clientId,
            entityType: entityName,
            strategy: 'server-wins',
            reason: 'existing-newer-but-already-synced',
            winner: 'incoming',
            existingTimestamp: existingTs,
            incomingTimestamp: incomingTs,
            existingSyncStatus: existingEntity.sync_status,
            resolvedAt: nowRFC3339(),
          };

          log.debug(
            `mergeWithExisting: conflict resolved in ${entityName} (server wins)`,
            JSON.stringify(resolution, null, 2),
          );

          return { winner: incoming, isConflict: false, resolution };
        }
      } else {
        // Timestamps equal: use incoming for idempotency
        return { winner: incoming, isConflict: false };
      }
    };

    const merge = <
      T extends {
        client_id?: string;
        updated_at?: string;
        sync_status?: string;
      },
    >(
      items: T[],
      existingMap: Map<string, T>,
      entityName: string,
    ): T[] => {
      return items.map((item) => {
        const cid = item.client_id!;
        const prev = existingMap.get(cid);
        if (prev) {
          // If entity has updated_at, use timestamp-based conflict resolution
          if (item.updated_at && prev.updated_at) {
            const { isConflict } = resolveByTimestamp(item, prev, entityName, cid);
            if (isConflict) {
              // Conflict already logged by resolveByTimestamp with structured resolution
              // Return existing unchanged (not merged with incoming)
              return prev;
            }
          }
          // Normal case: merge with incoming overriding existing
          // Start with existing, overlay incoming fields
          return { ...prev, ...item } as T;
        }
        // New: prepared already contains defaults, use directly
        return item;
      });
    };

    // Message-specific merge with streaming status monotonic guard (Issue 236)
    // AND timestamp-based conflict resolution
    const mergeMessages = (
      items: Partial<LocalMessage>[],
      existingMap: Map<string, Partial<LocalMessage>>,
    ): Partial<LocalMessage>[] => {
      return items.map((item) => {
        const cid = item.client_id!;
        const prev = existingMap.get(cid);
        if (prev) {
          // First check: skip if applying this update would cause a streaming status regression
          // This check ALWAYS applies, regardless of timestamps
          if (
            isStreamingStatusRegression(
              prev.streaming_status,
              item.streaming_status,
            )
          ) {
            // P1-FIX: Upgrade log level to warn for streaming regression detection
            // This makes regression attempts more visible for debugging
            log.warn(
              'mergeMessages: blocked streaming status regression',
              'client_id:',
              cid,
              'existing:',
              prev.streaming_status,
              '->',
              'incoming:',
              item.streaming_status,
              '(keeping existing state)',
            );
            return prev; // Keep existing record unchanged
          }

          // Second check: timestamp-based conflict resolution
          // Only applies if both have updated_at
          if (item.updated_at && prev.updated_at) {
            const { isConflict } = resolveByTimestamp(item, prev, 'message', cid);
            if (isConflict) {
              // Conflict already logged by resolveByTimestamp with structured resolution
              // Return existing unchanged (not merged with incoming)
              return prev;
            }
          }

          // Normal case: merge with incoming overriding existing
          // For fields present in incoming, incoming wins
          // For fields not in incoming, keep existing values
          return { ...prev, ...item } as Partial<LocalMessage>;
        }
        return item;
      });
    };

    return {
      sessions: merge(prepared.sessions, existing.sessions, 'session'),
      turns: merge(prepared.turns, existing.turns, 'turn'),
      messages: mergeMessages(prepared.messages, existing.messages),
      rtcs: merge(prepared.rtcs, existing.rtcs, 'rtc'),
    };
  }

  /**
   * Writeback turn counts to session within transaction.
   *
   * Must be called after turn bulkPut (within same transaction).
   * Re-reads sessions from DB (not using stale sessionMap) to ensure sync_status etc. are correct.
   */
  private async writebackTurnCountsInTx(
    turns: Partial<LocalTurn>[],
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

    // Re-count and update turn counts for all affected sessions.
    //
    // NOTE: No per-session nested transaction needed — this method is called within
    // the outer db.transaction('rw', tablesToLock) in applyUpdates(), which already
    // holds write locks on db.sessions and db.turns. Dexie's transaction isolation
    // ensures atomicity; concurrent applyUpdates() calls are serialized by the
    // outer transaction scope.
    //
    // PERFORMANCE OPTIMIZATION: Parallelize read operations (countActiveTurns + sessions.get)
    // using Promise.all, but keep write operations sequential to avoid transaction conflicts.
    // Reads are safe to parallelize within the same transaction; writes must be sequential
    // to ensure deterministic behavior across IndexedDB implementations.
    const sessionIds = [...affectedSessionIds];

    // Phase 1: Parallel reads - count active turns and fetch current sessions
    const sessionData = await Promise.all(
      sessionIds.map(async (sessionId) => {
        const [{ pending, running }, session] = await Promise.all([
          this.countActiveTurns(sessionId),
          db.sessions.get(sessionId),
        ]);
        return { sessionId, pending, running, session };
      }),
    );

    // Phase 2: Sequential writes - update only when counts changed
    for (const { sessionId, pending, running, session } of sessionData) {
      if (!session) continue; // session doesn't exist (may have been deleted), skip

      // Only update when count actually changed (reduce unnecessary writes)
      if (
        session.pending_turn_count !== pending ||
        session.running_turn_count !== running
      ) {
        await db.sessions.update(sessionId, {
          pending_turn_count: pending,
          running_turn_count: running,
        });
      }
    }
  }

  /**
   * Emit batch UI update events.
   *
   * Called outside transaction (transaction only does DB operations).
   * Before snapshots collected within transaction via collectBeforeSnapshots.
   */
  private async emitBatchUIUpdates(
    before: Map<string, EntityRecord>,
    merged: BatchEntities,
    deletes: BatchDeletes,
  ): Promise<void> {
    const entityTypes = ['sessions', 'turns', 'messages', 'rtcs'] as const;
    const typeNames = ['session', 'turn', 'message', 'rtc'] as const;

    log.debug(
      '[EntityRepository] emitBatchUIUpdates: sessions:',
      merged.sessions.length,
      'turns:',
      merged.turns.length,
      'messages:',
      merged.messages.length,
      'rtcs:',
      merged.rtcs.length,
    );

    // 1. Emit upsert UI updates
    for (let idx = 0; idx < entityTypes.length; idx++) {
      const entities = merged[entityTypes[idx]];
      const typeName = typeNames[idx];

      for (const record of entities) {
        const recordObj = record as unknown as EntityRecord;
        const clientId = extractClientId(recordObj);
        const key = `${typeName}:${clientId}`;
        const oldRecord = before.get(key);
        const action = oldRecord ? 'updated' : 'created';
        if (typeName === 'turn') {
          const sessionClientId = extractStringField(
            recordObj,
            'session_client_id',
          );
          log.debug(
            '[EntityRepository] Emitting batch turn UI update:',
            action,
            clientId,
            'session:',
            sessionClientId,
          );
        }
        await emitUIUpdates(
          typeName,
          action,
          clientId,
          oldRecord as object | undefined,
          recordObj as object,
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
        await emitUIUpdates(
          typeName,
          'deleted',
          clientId,
          oldRecord as Record<string, unknown> | undefined,
          {} as Record<string, unknown>,
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
  private async _resolveSessionClientId(
    serverSessionId: string,
    entityType: string,
    entityId: string,
  ): Promise<string> {
    const session = await this.getSessionByServerId(serverSessionId);
    if (session) {
      return session.client_id;
    }
    log.warn(
      `${entityType} ${entityId} references unknown session ${serverSessionId}`,
    );
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

  private async applyUpdateItem(
    item: UpdateItem,
    data: unknown,
  ): Promise<void> {
    switch (item.entity) {
      case 'session': {
        if (!isValidSession(data)) {
          log.warn('[applyUpdateItem:session] Invalid session data, skipping');
          return;
        }
        const raw = data;
        // Use destructuring to remove protocol-layer id field
        const { id: _id, ...rest } = raw as {
          id?: string;
        } & Partial<LocalSession>;
        const mapped: Partial<LocalSession> = {
          ...rest,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
        };

        await this.upsertSession(mapped, 'synced');
        break;
      }
      case 'turn': {
        if (!isValidTurn(data)) {
          log.warn('[applyUpdateItem:turn] Invalid turn data, skipping');
          return;
        }
        const raw = data;
        // Use destructuring to remove protocol-layer fields
        const {
          id: _id,
          session_id: _session_id,
          ...rest
        } = raw as { id?: string; session_id?: string } & Partial<LocalTurn>;
        const mapped: Partial<LocalTurn> = {
          ...rest,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
        } as Partial<LocalTurn>;
        if (raw.session_id) {
          mapped.session_client_id = await this._resolveSessionClientId(
            raw.session_id,
            'Turn',
            raw.client_id || raw.id,
          );
        }
        await this.upsertTurn(mapped, 'synced');

        // Write-time aggregation: write pending/running turn counts back to the session row.
        // Uses preserveSyncStatus to avoid reading existing session first, preventing
        // both an extra DB query and a sync_status overwrite race.
        const sessionClientId = mapped.session_client_id;
        if (sessionClientId) {
          const { pending, running } =
            await this.countActiveTurns(sessionClientId);
          await this.upsertSession(
            {
              client_id: sessionClientId,
              pending_turn_count: pending,
              running_turn_count: running,
            },
            'synced', // default, ignored due to preserveSyncStatus
            {
              silent: true, // We'll emit turn count events manually below
              preserveSyncStatus: true, // don't overwrite sync_status with stale value
            },
          );

          // After turn count is persisted, emit session field events so UI layer
          // can refresh turn counts with the latest values (avoids stale reads).
          await emitUIUpdates(
            'session',
            'updated',
            sessionClientId,
            {},
            {
              pending_turn_count: pending,
              running_turn_count: running,
            },
          );
        }
        break;
      }
      case 'message': {
        if (!isValidMessage(data)) {
          log.warn('[applyUpdateItem:message] Invalid message data, skipping');
          return;
        }
        const raw = data;
        // Use destructuring to remove protocol-layer fields
        const {
          id: _id,
          session_id: _session_id,
          parent_message_id: _parent_message_id,
          ...rest
        } = raw as {
          id?: string;
          session_id?: string;
          parent_message_id?: string;
        } & Partial<LocalMessage>;
        const mapped: Partial<LocalMessage> = {
          ...rest,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
        } as Partial<LocalMessage>;
        if (raw.session_id) {
          mapped.session_client_id = await this._resolveSessionClientId(
            raw.session_id,
            'Message',
            raw.client_id || raw.id,
          );
        }
        // parent_message_id -> parent_client_id: resolve parent message's client_id
        if (raw.parent_message_id) {
          const parentMsg = await this.getMessageByServerId(
            raw.parent_message_id,
          );
          if (parentMsg) {
            mapped.parent_client_id = parentMsg.client_id;
          } else {
            log.warn(
              `[applyUpdateItem:message] Message ${raw.client_id || raw.id} references unknown parent ${raw.parent_message_id}`,
            );
          }
        }
        await this.upsertMessage(mapped, 'synced');
        break;
      }
      case 'rtc': {
        if (!isValidRtc(data)) {
          log.warn('[applyUpdateItem:rtc] Invalid RTC data, skipping');
          return;
        }
        const raw = data;
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
            log.warn(
              `RTC ${raw.client_id || raw.id} references unknown session ${raw.session_id}`,
            );
            sessionClientId = raw.session_id;
          }
        }

        // Use destructuring to remove protocol-layer fields
        const {
          id: _id,
          session_id: _session_id,
          ...rest
        } = raw as { id?: string; session_id?: string } & Partial<LocalRtc>;
        const mapped: Partial<LocalRtc> = {
          ...rest,
          server_id: raw.id,
          client_id: raw.client_id || raw.id,
          session_client_id: sessionClientId || '',
          session_device_id: sessionDeviceId,
        } as Partial<LocalRtc>;
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
    throw new Error(
      '[EntityRepository] Not initialized - call initEntityRepository(deviceId) first',
    );
  }
  return entityRepositoryInstance;
}
