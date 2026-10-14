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
 * field-level diffs are computed via microdiff and published as a single batch event.
 *
 * PERFORMANCE OPTIMIZATION: Uses batch event emission to reduce event bus congestion.
 * Instead of emitting N events for N field changes (each requiring IndexedDB write + dispatch),
 * emits 1 event with all changes. This reduces overhead by up to 90% for entities with
 * many fields (e.g., Session with 10+ fields).
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
  // PERFORMANCE: safeClone now uses size threshold - large objects use shallow clone to reduce GC pressure.
  const cloneableAfter = safeClone(after);
  const cloneableBefore = before ? safeClone(before) : undefined;

  // Collect all field changes into a single batch event
  const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

  if (!cloneableBefore) {
    // Create: emit a CREATE event with all top-level fields as changes
    for (const [field, newValue] of Object.entries(cloneableAfter)) {
      changes.push({ field, oldValue: undefined, newValue });
    }
  } else {
    // P1-FIX: Short-circuit optimization - skip deep comparison if references are identical
    // If before and after are the same object reference, there are no changes
    if (cloneableBefore === cloneableAfter) {
      return; // No changes, exit early
    }

    // Update: compute per-field diffs via microdiff and collect into changes array
    // PERFORMANCE: microdiff performs deep comparison, but we've already cloned the objects
    // so reference equality check above is the fast path for unchanged data
    const diffs = diff(cloneableBefore, cloneableAfter);
    for (const change of diffs) {
      changes.push({
        field: formatField(change.path),
        oldValue: (change as { oldValue?: unknown }).oldValue,
        newValue: (change as { value?: unknown }).value,
      });
    }
  }

  // Publish as a single batch event (if there are any changes)
  if (changes.length > 0) {
    await bus.publish({
      entity,
      action,
      entityId,
      changes, // Batch changes array
      // Also set legacy fields for backward compatibility with consumers
      // that haven't migrated to the batch format yet
      field: changes[0].field,
      oldValue: changes[0].oldValue,
      newValue: changes[0].newValue,
    });
  }
}

/**
 * Estimate the size of an object without JSON.stringify overhead.
 *
 * Provides a fast, approximate size calculation by recursively traversing the object
 * and summing up the sizes of primitive values and structural overhead.
 *
 * Performance: ~0.1-0.5ms for typical objects (vs 5-15ms for JSON.stringify on large objects).
 *
 * Size estimates:
 * - string: length * 2 (UTF-16)
 * - number: 8 bytes
 * - boolean: 4 bytes
 * - null/undefined: 0 bytes
 * - array: 8 bytes overhead + sum of elements
 * - object: 8 bytes overhead + sum of keys (length * 2) + sum of values
 *
 * P1-FIX: Added maxDepth parameter to prevent stack overflow on deeply nested objects.
 * When depth limit is reached, returns a conservative estimate instead of recursing further.
 *
 * @param obj - The object to estimate size for
 * @param maxDepth - Maximum recursion depth (default: 10). Prevents stack overflow on deeply nested objects.
 * @param currentDepth - Current depth (internal use for recursion)
 * @returns Approximate size in bytes
 */
function estimateSize(obj: unknown, maxDepth: number = 10, currentDepth: number = 0): number {
  // P1-FIX: Prevent stack overflow on deeply nested objects
  if (currentDepth >= maxDepth) {
    // Return conservative estimate for remaining nested structure
    return 1024; // Assume 1KB for any deeply nested structure
  }

  if (obj === null || obj === undefined) return 0;
  if (typeof obj === 'string') return obj.length * 2;
  if (typeof obj === 'number') return 8;
  if (typeof obj === 'boolean') return 4;
  if (Array.isArray(obj)) {
    return obj.reduce((sum, item) => sum + estimateSize(item, maxDepth, currentDepth + 1), 8);
  }
  if (typeof obj === 'object') {
    return Object.entries(obj).reduce(
      (sum, [k, v]) => sum + k.length * 2 + estimateSize(v, maxDepth, currentDepth + 1),
      8
    );
  }
  return 8;
}

/**
 * Safely clone an object to ensure it is serializable via the structured clone algorithm.
 *
 * Uses `structuredClone()` when available (preferred for performance and correctness),
 * falling back to JSON serialize/deserialize for environments that don't support it.
 * JSON fallback strips non-cloneable objects (functions, DOM elements, etc.).
 *
 * P1-FIX (Issue #3): Always use deep clone to ensure microdiff can detect nested field changes.
 * Previously, objects > 10KB used shallow clone, which caused microdiff to miss nested updates
 * due to shared references. Now all objects use deep clone regardless of size.
 *
 * P1-FIX (Issue #4): Added performance monitoring for large object cloning.
 * Logs warning when cloning takes > 10ms to help identify performance bottlenecks
 * in SharedWorker context where blocking affects other tabs.
 *
 * Returns an empty object if serialization fails to avoid DataCloneError.
 *
 * Returns Record<string, unknown> since both methods produce plain objects.
 *
 * @param obj - The object to clone
 */
function safeClone(obj: object): Record<string, unknown> {
  // P1-FIX: Performance monitoring for large object cloning
  const startTime = performance.now();

  try {
    // Prefer structuredClone for performance and to preserve more data types
    if (typeof structuredClone === 'function') {
      const result = structuredClone(obj) as Record<string, unknown>;

      // P1-FIX: Log performance warning for large object cloning
      const duration = performance.now() - startTime;
      if (duration > 10) {
        log.warn(
          `safeClone: slow structuredClone detected (${duration.toFixed(2)}ms, ` +
          `estimated size: ${estimateSize(obj)} bytes). ` +
          `Consider optimizing data structure or reducing update frequency.`,
        );
      }

      return result;
    }
  } catch {
    // structuredClone failed (e.g., non-cloneable object), fall through to JSON
  }

  try {
    // Fallback to JSON for environments without structuredClone or when it fails
    const result = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;

    // P1-FIX: Log performance warning for large object cloning
    const duration = performance.now() - startTime;
    if (duration > 10) {
      log.warn(
        `safeClone: slow JSON clone detected (${duration.toFixed(2)}ms, ` +
        `estimated size: ${estimateSize(obj)} bytes). ` +
        `Consider optimizing data structure or reducing update frequency.`,
      );
    }

    return result;
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
        // P0-FIX: Detect concurrent write conflict when existing record is newer than incoming.
        // This can happen when multiple Tabs update the same entity simultaneously.
        // Log at warn level for debugging and auditing purposes.
        if (
          existing.updated_at &&
          session.updated_at &&
          existing.updated_at > session.updated_at
        ) {
          log.warn(
            `upsertSession: concurrent write detected for ${session.client_id}, ` +
            `existing updated_at=${existing.updated_at}, incoming updated_at=${session.updated_at}`
          );
        }

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
   * @param limit - Maximum number of sessions to return. Defaults to 100 to avoid loading
   *                excessive data into memory. Pass a larger value only when necessary.
   *
   * Performance notes:
   * - Uses compound index [deleted_at+updated_at] (added in v16) for DB-level cursor pagination.
   *   Results are queried via `orderBy('updated_at').reverse()` with optional cursor-based
   *   filtering, then soft-deleted sessions are filtered out in-memory.
   * - Cursor pagination: when a cursor is provided, the method finds the cursor session's
   *   updated_at timestamp and queries sessions with older timestamps (backward pagination).
   * - For typical use cases (< 1000 sessions), performance is acceptable.
   * - For larger datasets (> 1000 active sessions), consider implementing virtual scrolling
   *   in the UI layer (session-tree) to avoid rendering lag.
   *
   * IMPORTANT: The default limit of 100 balances memory usage with typical UI needs.
   * The UI layer (session-tree component) should implement virtual scrolling or "load more"
   * pagination to avoid rendering thousands of DOM nodes. Cursor-based pagination is already
   * supported via the `cursor` parameter.
   *
   * @returns Array of active (non-deleted) sessions, ordered by updated_at descending.
   */
  async listSessions(
    cursor?: string,
    // PERFORMANCE: Default limit of 100 to avoid excessive memory usage. UI layer should
    // implement virtual scrolling or pagination for larger datasets.
    limit: number = 100,
  ): Promise<LocalSession[]> {
    const db = getDatabase();

    // PERFORMANCE: Use updated_at index for cursor pagination.
    // Filter out soft-deleted sessions in-memory (where deleted_at is truthy).
    //
    // NOTE: We previously used compound index [deleted_at+updated_at] with undefined values,
    // but that approach is not portable across all IndexedDB implementations (e.g., fake-indexeddb
    // used in tests does not support undefined in compound keys). The current approach uses
    // the simpler updated_at index and filters deleted_at in-memory, which is compatible with
    // all IndexedDB implementations and still performant for typical use cases.

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

    // Query sessions using updated_at index (descending order for pagination)
    let query = db.sessions.orderBy('updated_at').reverse();

    // If cursor provided, start from sessions older than cursor
    if (cursorUpdatedAt !== null) {
      // Use upperBound to get sessions with updated_at < cursor date
      query = db.sessions
        .where('updated_at')
        .below(new Date(cursorUpdatedAt).toISOString())
        .reverse();
    }

    // Filter out soft-deleted sessions in-memory
    // This is an O(n) filter but only runs on the already-fetched page of results
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
   *
   * ## P3-FIX: Turn Count Validation & Known Edge Cases
   *
   * ### Current Counting Strategy
   * Turn counts (pending_turn_count, running_turn_count) are maintained via
   * **write-time aggregation**: whenever turn records are modified, the counts
   * are re-computed from the turns table and written back to the session record.
   * This approach ensures counts are always consistent with the actual turn data
   * in IndexedDB, avoiding drift from event-based counting.
   *
   * ### Known Edge Cases (Counts May Be Temporarily Inaccurate)
   *
   * 1. **Concurrent Tab Writes**: When multiple tabs apply updates simultaneously,
   *    each tab's transaction may compute counts based on a stale snapshot. The
   *    sequential query design (see above) mitigates this within a single tab,
   *    but cross-tab consistency is eventually-consistent (last-write-wins).
   *
   * 2. **Writeback Failure**: If `writebackTurnCountsInTx()` fails after turns are
   *    committed (e.g., session record locked by another transaction), the session
   *    counts remain stale until the next successful batch write. This is a
   *    deliberate trade-off: we prioritize turn data durability over count accuracy.
   *    Users may briefly see incorrect counts (e.g., "2 pending" when there are 3),
   *    but counts self-heal on the next write.
   *
   * 3. **Orphaned Turns**: If a turn record exists but its session_client_id points
   *    to a deleted/missing session, the count is computed but never written back
   *    (session not found in writeback). This is correct behavior — orphaned turns
   *    are data inconsistencies that should be resolved by sync, not counted.
   *
   * 4. **Rapid UI Updates**: High-frequency turn creation (e.g., automated testing)
   *    may cause UI to display stale counts between writeback calls. The UI layer
   *    should subscribe to UIUpdateBus events to refresh counts after each turn event.
   *
   * ### Why No Runtime Validation?
   * Runtime validation (e.g., asserting `session.pending_turn_count === computedCount`)
   * would add ~5-10ms per write for re-counting, which is unacceptable for bulk operations.
   * The write-time aggregation strategy provides strong consistency without the overhead.
   * If counts diverge (detected via debugging logs), a full re-sync from the server
   * will correct them.
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

        // P0-FIX: Detect concurrent write conflict when existing record is newer than incoming.
        // This can happen when multiple Tabs update the same entity simultaneously.
        // Log at warn level for debugging and auditing purposes.
        if (
          existing.updated_at &&
          message.updated_at &&
          existing.updated_at > message.updated_at
        ) {
          log.warn(
            `upsertMessage: concurrent write detected for ${message.client_id}, ` +
            `existing updated_at=${existing.updated_at}, incoming updated_at=${message.updated_at}`
          );
        }

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
    //
    // HOT/COLD DATA PROTECTION: We limit to MAX_SESSION_MESSAGES to avoid loading
    // thousands of messages at once. The UI layer should implement virtual scrolling
    // or pagination to display large message histories. For long-term storage,
    // consider implementing a hot/cold data separation where older messages are
    // archived or loaded on-demand.
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

    // Messages are already sorted by created_at via compound index [session_client_id+created_at].
    // PERFORMANCE: Only perform tie-breaking sort when created_at values are equal.
    // The compound index guarantees created_at ordering, so JavaScript sort is only needed
    // for deterministic ordering of messages with identical timestamps (rare edge case).
    let needsTieBreak = false;
    for (let i = 1; i < allMessages.length; i++) {
      if (allMessages[i].created_at === allMessages[i - 1].created_at) {
        needsTieBreak = true;
        break;
      }
    }

    if (needsTieBreak) {
      allMessages.sort((a, b) => {
        const tsA = new Date(a.created_at).getTime();
        const tsB = new Date(b.created_at).getTime();
        if (tsA !== tsB) return tsA - tsB;
        return a.client_id.localeCompare(b.client_id);
      });
    }

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

        // P0-FIX: Detect concurrent write conflict when existing record is newer than incoming.
        // This can happen when multiple Tabs update the same entity simultaneously.
        // Log at warn level for debugging and auditing purposes.
        if (
          existing.updated_at &&
          rtc.updated_at &&
          existing.updated_at > rtc.updated_at
        ) {
          log.warn(
            `upsertRtc: concurrent write detected for ${rtc.client_id}, ` +
            `existing updated_at=${existing.updated_at}, incoming updated_at=${rtc.updated_at}`
          );
        }

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
    // Use .first() instead of .toArray() to avoid loading all failed RTCs into memory.
    // Dexie.minKey and Dexie.maxKey are special values that represent the minimum and maximum
    // possible values for any type, enabling range queries across all offset values.
    const matchFailed = await db.rtcs
      .where('[sync_status+offset]')
      .between(['failed', Dexie.minKey], ['failed', Dexie.maxKey])
      .filter((r) => matchesSession(r) && matchesDevice(r))
      .first();

    if (matchFailed) {
      return matchFailed;
    }

    // 2. Then look for status = 'pending' (new tasks awaiting execution)
    // Regardless of sync_status, status='pending' means not yet executed
    // PERFORMANCE: Use compound index [status+offset] for DB-level sorting by offset.
    // Use .first() instead of .toArray() to avoid loading all pending RTCs into memory.
    return await db.rtcs
      .where('[status+offset]')
      .between(['pending', Dexie.minKey], ['pending', Dexie.maxKey])
      .filter((r) => matchesSession(r) && matchesDevice(r))
      .first();
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

    // C2-FIX: Split large transactions into smaller batches to prevent timeout.
    // Strategy: Keep read-merge atomic, split writes by entity type.
    // This maintains data consistency while reducing transaction scope.
    // P0-FIX: Calculate total write items BEFORE entering transaction branches,
    // based on prepared data (upserts) and deletes, not on empty merged array.
    //
    // BATCH_THRESHOLD rationale (value: 200):
    // - Dexie/IndexedDB can handle larger batches efficiently on modern hardware.
    // - Each bulkPut/bulkDelete of 200 items takes ~10-40ms on modern hardware.
    // - 200 items keeps total write time well under the timeout even on slower devices,
    //   while reducing the overhead of split transactions (batch intent record,
    //   compensation rollback) for medium-sized batches.
    // - This value can be further tuned to 500 based on performance test results
    //   if profiling shows minimal impact on IndexedDB lock times.
    const BATCH_THRESHOLD = 200; // Split if total items exceed this
    const totalWriteItems =
      prepared.sessions.length +
      prepared.turns.length +
      prepared.messages.length +
      prepared.rtcs.length +
      deletes.sessions.length +
      deletes.turns.length +
      deletes.messages.length +
      deletes.rtcs.length;

    let merged: BatchEntities = {
      sessions: [],
      turns: [],
      messages: [],
      rtcs: [],
    };

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
          // P0-FIX: Validate data before bulkPut to prevent runtime errors
          if (merged.sessions.length > 0) {
            const validSessions = merged.sessions.filter(s => {
              if (!s.client_id) {
                log.warn('bulkPut: session missing client_id, skipping');
                return false;
              }
              return true;
            });
            if (validSessions.length > 0)
              await db.sessions.bulkPut(validSessions as LocalSession[]);
          }
          if (merged.turns.length > 0) {
            const validTurns = merged.turns.filter(t => {
              if (!t.client_id) {
                log.warn('bulkPut: turn missing client_id, skipping');
                return false;
              }
              return true;
            });
            if (validTurns.length > 0)
              await db.turns.bulkPut(validTurns as LocalTurn[]);
          }
          if (merged.messages.length > 0) {
            const validMessages = merged.messages.filter(m => {
              if (!m.client_id) {
                log.warn('bulkPut: message missing client_id, skipping');
                return false;
              }
              return true;
            });
            if (validMessages.length > 0)
              await db.messages.bulkPut(validMessages as LocalMessage[]);
          }
          if (merged.rtcs.length > 0) {
            const validRtcs = merged.rtcs.filter(r => {
              if (!r.client_id) {
                log.warn('bulkPut: rtc missing client_id, skipping');
                return false;
              }
              return true;
            });
            if (validRtcs.length > 0)
              await db.rtcs.bulkPut(validRtcs as LocalRtc[]);
          }

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
        // P0-1-FIX: Implement batch intent record for split transaction atomicity.
        // The batch intent record tracks the overall operation and enables proper
        // compensation rollback if any transaction fails.

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

        // P0-1-FIX: Create batch intent record before any writes.
        // This record tracks the batch operation and enables proper compensation.
        const batchId = crypto.randomUUID();
        const entityTypesInvolved = [
          merged.sessions.length > 0 || deletes.sessions.length > 0 ? 'sessions' : null,
          merged.turns.length > 0 || deletes.turns.length > 0 ? 'turns' : null,
          merged.messages.length > 0 || deletes.messages.length > 0 ? 'messages' : null,
          merged.rtcs.length > 0 || deletes.rtcs.length > 0 ? 'rtcs' : null,
        ].filter(Boolean) as string[];

        const batchIntent: import('./database.js').BatchIntentRecord = {
          batchId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'pending',
          entityTypes: JSON.stringify(entityTypesInvolved),
          totalOperations: totalWriteItems,
        };

        // Write batch intent in a separate transaction (must be durable before any data writes)
        await db.transaction('rw', [db.batchIntents], async () => {
          await db.batchIntents.add(batchIntent);
        });

        log.info(
          `[applyUpdates] Created batch intent ${batchId} for ${totalWriteItems} items ` +
          `across ${entityTypesInvolved.length} entity types`,
        );

        // P0-FIX: Track successfully written entity types for compensation on failure.
        // If a later transaction fails, we roll back earlier transactions by deleting
        // the records we just wrote. This provides "best-effort atomicity" across
        // multiple transactions when a single transaction would be too large.
        //
        // Compensation strategy: delete by primary key (client_id) for upserts,
        // and re-insert from beforeSnapshots for deletes (though delete rollback
        // is not attempted since deleted data is unrecoverable if the original
        // record no longer exists).
        const completedWrites: Array<{
          entityType: 'sessions' | 'turns' | 'messages' | 'rtcs';
          clientIds: string[];
          operation: 'upsert' | 'delete';
        }> = [];

        try {
          // Phase 2: Split writes by entity type (each in its own transaction)
          // This reduces transaction scope and timeout risk for large datasets
          if (merged.sessions.length > 0 || deletes.sessions.length > 0) {
            const txStart = performance.now();
            const sessionClientIds = merged.sessions.map((s) => s.client_id!).filter(Boolean);
            await db.transaction('rw', [db.sessions], async () => {
              if (merged.sessions.length > 0) {
                const validSessions = merged.sessions.filter(s => s.client_id);
                if (validSessions.length > 0)
                  await db.sessions.bulkPut(validSessions as LocalSession[]);
              }
              if (deletes.sessions.length > 0)
                await db.sessions.bulkDelete(deletes.sessions);
            });
            if (merged.sessions.length > 0) {
              completedWrites.push({ entityType: 'sessions', clientIds: sessionClientIds, operation: 'upsert' });
            }
            if (deletes.sessions.length > 0) {
              completedWrites.push({ entityType: 'sessions', clientIds: deletes.sessions, operation: 'delete' });
            }
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
            const turnClientIds = merged.turns.map((t) => t.client_id!).filter(Boolean);
            await db.transaction('rw', [db.turns], async () => {
              if (merged.turns.length > 0) {
                const validTurns = merged.turns.filter(t => t.client_id);
                if (validTurns.length > 0)
                  await db.turns.bulkPut(validTurns as LocalTurn[]);
              }
              if (deletes.turns.length > 0)
                await db.turns.bulkDelete(deletes.turns);
            });
            if (merged.turns.length > 0) {
              completedWrites.push({ entityType: 'turns', clientIds: turnClientIds, operation: 'upsert' });
            }
            if (deletes.turns.length > 0) {
              completedWrites.push({ entityType: 'turns', clientIds: deletes.turns, operation: 'delete' });
            }
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
            const messageClientIds = merged.messages.map((m) => m.client_id!).filter(Boolean);
            await db.transaction('rw', [db.messages], async () => {
              if (merged.messages.length > 0) {
                const validMessages = merged.messages.filter(m => m.client_id);
                if (validMessages.length > 0)
                  await db.messages.bulkPut(validMessages as LocalMessage[]);
              }
              if (deletes.messages.length > 0)
                await db.messages.bulkDelete(deletes.messages);
            });
            if (merged.messages.length > 0) {
              completedWrites.push({ entityType: 'messages', clientIds: messageClientIds, operation: 'upsert' });
            }
            if (deletes.messages.length > 0) {
              completedWrites.push({ entityType: 'messages', clientIds: deletes.messages, operation: 'delete' });
            }
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
            const rtcClientIds = merged.rtcs.map((r) => r.client_id!).filter(Boolean);
            await db.transaction('rw', [db.rtcs], async () => {
              if (merged.rtcs.length > 0) {
                const validRtcs = merged.rtcs.filter(r => r.client_id);
                if (validRtcs.length > 0)
                  await db.rtcs.bulkPut(validRtcs as LocalRtc[]);
              }
              if (deletes.rtcs.length > 0)
                await db.rtcs.bulkDelete(deletes.rtcs);
            });
            if (merged.rtcs.length > 0) {
              completedWrites.push({ entityType: 'rtcs', clientIds: rtcClientIds, operation: 'upsert' });
            }
            if (deletes.rtcs.length > 0) {
              completedWrites.push({ entityType: 'rtcs', clientIds: deletes.rtcs, operation: 'delete' });
            }
            const elapsed = performance.now() - txStart;
            if (elapsed > 5000) {
              log.warn(
                `[applyUpdates] RTcs write transaction took ${elapsed.toFixed(1)}ms ` +
                `(>${5000}ms threshold). Items: ${merged.rtcs.length + deletes.rtcs.length}`,
              );
            }
          }

          // Phase 3: Turn count writeback (separate transaction)
          // P1-FIX: Wrapped in try-catch to prevent writeback failure from triggering
          // full batch rollback. The turns themselves are already committed in Phase 2;
          // writeback is a secondary operation that updates session-level aggregates.
          // If writeback fails, session turn counts may be temporarily inconsistent,
          // but they will be corrected on the next successful batch write.
          if (merged.turns.length > 0) {
            const txStart = performance.now();
            try {
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
            } catch (writebackError) {
              // Writeback failure is non-fatal: turns are committed, session counts
              // will be eventually consistent after the next batch write.
              log.warn(
                `[applyUpdates] Turn count writeback failed (non-fatal, session counts may be stale until next batch):`,
                writebackError,
              );
            }
          }

          // P0-1-FIX: All transactions succeeded, update batch intent to 'completed'.
          // This marks the batch as successfully completed, preventing unnecessary
          // compensation if the intent record is later discovered.
          await db.transaction('rw', [db.batchIntents], async () => {
            await db.batchIntents.update(batchId, {
              status: 'completed',
              updatedAt: Date.now(),
              completedWrites: JSON.stringify(completedWrites),
            });
          });

          log.info(
            `[applyUpdates] Batch ${batchId} completed successfully ` +
            `(${completedWrites.length} entity types written)`,
          );

          // P0-1-FIX: Clean up batch intent record on successful completion.
          // This prevents accumulation of completed intent records.
          try {
            await db.batchIntents.delete(batchId);
            log.debug(
              `[applyUpdates] Batch ${batchId} intent record cleaned up after success`,
            );
          } catch (cleanupError) {
            // Cleanup failure is non-fatal but may leave stale records
            log.warn(
              `[applyUpdates] Failed to clean up batch intent record (batch ${batchId}):`,
              cleanupError,
            );
          }
        } catch (error) {
          // P0-FIX: Compensation - roll back completed writes in reverse order.
          // This is a best-effort rollback: we try to undo each completed write,
          // but if rollback itself fails, we log the error and continue.
          // The goal is to restore consistency, but some data loss may occur
          // for delete operations (cannot restore deleted data without the original record).
          log.error(
            `[applyUpdates] Large batch write failed, attempting compensation rollback:`,
            error,
          );

          // P0-1-FIX: Update batch intent to 'failed' status.
          // This marks the batch as failed and triggers compensation coordination.
          try {
            await db.transaction('rw', [db.batchIntents], async () => {
              await db.batchIntents.update(batchId, {
                status: 'failed',
                updatedAt: Date.now(),
                errorMessage: error instanceof Error ? error.message : String(error),
              });
            });
          } catch (intentUpdateError) {
            // Intent update failure is non-fatal, but indicates potential consistency issues
            log.error(
              `[applyUpdates] Failed to update batch intent status (batch ${batchId}):`,
              intentUpdateError,
            );
          }

          // Roll back in reverse order (last written entity first)
          for (let i = completedWrites.length - 1; i >= 0; i--) {
            const write = completedWrites[i];

            // P2-FIX: Retry mechanism for compensation operations.
            // If rollback fails, retry up to 2 times with 100ms intervals.
            // This handles transient failures (e.g., temporary IndexedDB locks).
            const MAX_COMPENSATION_RETRIES = 2;
            const COMPENSATION_RETRY_DELAY_MS = 100;

            let lastError: unknown;
            for (let retryAttempt = 0; retryAttempt <= MAX_COMPENSATION_RETRIES; retryAttempt++) {
              try {
                if (retryAttempt > 0) {
                  log.info(
                    `[applyUpdates] Compensation retry attempt ${retryAttempt}/${MAX_COMPENSATION_RETRIES} for ${write.entityType}`,
                  );
                  await new Promise(resolve => setTimeout(resolve, COMPENSATION_RETRY_DELAY_MS));
                }

                if (write.operation === 'upsert') {
                  // P0-2-FIX: Distinguish between new records and updated records.
                  // For updated records, restore the before snapshot instead of deleting.
                  // For new records, delete them to undo the creation.
                  const table = db[write.entityType] as Table;
                  const beforeRecords: unknown[] = [];
                  const newClientIds: string[] = [];

                  for (const clientId of write.clientIds) {
                    const key = `${write.entityType.slice(0, -1)}:${clientId}`; // e.g., "session:s1"
                    const before = beforeSnapshots.get(key);
                    if (before) {
                      beforeRecords.push(before);
                    } else {
                      newClientIds.push(clientId);
                    }
                  }

                  // Restore pre-existing records to their before state
                  if (beforeRecords.length > 0) {
                    // `beforeRecords` is typed as unknown[] because it holds heterogeneous entity snapshots
                    // from `beforeSnapshots: Map<string, EntityRecord>`. The table is dynamically selected
                    // (sessions/turns/messages/rtcs) via `db[write.entityType] as Table`, so the compiler
                    // cannot prove the element type matches the table's row type. The cast is safe because
                    // each snapshot was originally read from the same table during bulkGetExisting().
                    await table.bulkPut(beforeRecords as any[]);
                    log.info(
                      `[applyUpdates] Compensation: restored ${beforeRecords.length} ` +
                      `${write.entityType} updates from snapshots`,
                    );
                  }

                  // Delete newly created records
                  if (newClientIds.length > 0) {
                    await table.bulkDelete(newClientIds);
                    log.info(
                      `[applyUpdates] Compensation: deleted ${newClientIds.length} ` +
                      `new ${write.entityType} creates`,
                    );
                  }
                } else {
                  // Roll back delete by re-inserting from beforeSnapshots
                  // Note: Only works if we have the before snapshot; otherwise data is lost
                  const table = db[write.entityType] as Table;
                  const recordsToRestore: unknown[] = [];
                  for (const clientId of write.clientIds) {
                    const key = `${write.entityType.slice(0, -1)}:${clientId}`; // e.g., "session:s1"
                    const before = beforeSnapshots.get(key);
                    if (before) {
                      recordsToRestore.push(before);
                    } else {
                      log.warn(
                        `[applyUpdates] Compensation: cannot restore deleted ${write.entityType} ` +
                        `record ${clientId} (no before snapshot available)`,
                      );
                    }
                  }
                  if (recordsToRestore.length > 0) {
                    // `recordsToRestore` is typed as unknown[] because it holds heterogeneous entity snapshots
                    // from `beforeSnapshots: Map<string, EntityRecord>`. The table is dynamically selected
                    // (sessions/turns/messages/rtcs) via `db[write.entityType] as Table`, so the compiler
                    // cannot prove the element type matches the table's row type. The cast is safe because
                    // each snapshot was originally read from the same table during bulkGetExisting().
                    await table.bulkAdd(recordsToRestore as any[]);
                    log.info(
                      `[applyUpdates] Compensation: restored ${recordsToRestore.length} ` +
                      `${write.entityType} deletes from snapshots`,
                    );
                  }
                }

                // Success: clear lastError and break retry loop
                lastError = undefined;
                break;
              } catch (rollbackError) {
                lastError = rollbackError;
                // Log error at error level for visibility
                log.error(
                  `[applyUpdates] Compensation rollback failed for ${write.entityType}` +
                  (retryAttempt < MAX_COMPENSATION_RETRIES ? `, will retry` : `, no more retries`),
                  rollbackError,
                );
              }
            }

            // If all retries failed, log final error but continue with other rollbacks
            if (lastError !== undefined) {
              log.error(
                `[applyUpdates] Compensation rollback exhausted all retries for ${write.entityType}. ` +
                `Data may be in inconsistent state.`,
                lastError,
              );
            }
          }

          // P0-1-FIX: Clean up batch intent record after compensation.
          // This prevents accumulation of stale intent records.
          try {
            await db.batchIntents.delete(batchId);
            log.info(
              `[applyUpdates] Batch ${batchId} intent record cleaned up after compensation`,
            );
          } catch (cleanupError) {
            // Cleanup failure is non-fatal but may leave stale records
            log.warn(
              `[applyUpdates] Failed to clean up batch intent record (batch ${batchId}):`,
              cleanupError,
            );
          }

          // Re-throw the original error so caller knows the operation failed
          throw error;
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
   * Merge in memory: { ...existing, ...newData } with unified conflict resolution strategy.
   *
   * Pure synchronous operation, no DB calls. Must be called within transaction
   * (using bulkGetExisting result).
   *
   * ## Unified Conflict Resolution Strategy
   *
   * The conflict resolution strategy is based on timestamp comparison and sync_status tracking.
   * The goal is to preserve the most recent data while protecting unsynced local changes.
   *
   * ### General Rules (for Session, Turn, Message, Rtc):
   *
   * 1. **incoming.timestamp > existing.timestamp**:
   *    - Use incoming (server data is newer, normal case)
   *    - No conflict
   *
   * 2. **incoming.timestamp === existing.timestamp**:
   *    - Use incoming (idempotent, same data)
   *    - No conflict
   *
   * 3. **incoming.timestamp < existing.timestamp**:
   *    - Check existing.sync_status:
   *      a. If existing.sync_status === 'pending' or 'syncing' (has unsynced local changes):
   *         - Use existing (local-wins, protect user's unsaved work)
   *         - Log conflict with structured resolution
   *      b. Otherwise (existing.sync_status === 'synced' or 'error', already synced):
   *         - Use incoming (server-wins, server data is authoritative)
   *         - No conflict (server data is always correct when local is synced)
   *
   * 4. **Either lacks timestamp**:
   *    - Use incoming (no conflict detection possible, trust server)
   *    - No conflict
   *
   * ### Special Case: Message streaming_status regression detection
   *
   * For Message entities, there is an additional check BEFORE timestamp comparison:
   * - If applying incoming.streaming_status would cause a state regression,
   *   block the update and keep existing (regardless of timestamps).
   * - Streaming status lifecycle is one-directional:
   *   pending → streaming → completed / failed
   * - Once a message reaches a terminal state (completed/failed), it must not
   *   revert to an earlier state (streaming/pending).
   * - This prevents out-of-order updates from live-channel overwriting
   *   final state received via topic-channel.
   *
   * ### Turn Entities (no timestamp-based conflict detection):
   *
   * Turn entities do not have updated_at field, so conflict detection is not possible.
   * Always use incoming (last-write-wins by default).
   *
   * @param prepared - Incoming entity data (from server or local creation)
   * @param existing - Current entity data in IndexedDB
   * @returns Merged entity data with conflicts resolved
   */
  private mergeWithExisting(
    prepared: BatchEntities,
    existing: ExistingData,
  ): BatchEntities {
    /**
     * Compare RFC3339 timestamps and return the "winner" based on unified conflict resolution.
     *
     * Resolution strategy (see mergeWithExisting docstring for full rules):
     * - incoming newer: use incoming (normal case)
     * - timestamps equal: use incoming (idempotent)
     * - existing newer + unsynced changes (sync_status='pending' or 'syncing'): use existing (local-wins)
     * - existing newer + already synced: use incoming (server-wins)
     * - missing timestamp: use incoming (no conflict detection)
     *
     * @returns { winner, isConflict, resolution }
     *   - winner: The entity data that should be used
     *   - isConflict: True if existing was newer AND had unsynced changes (local-wins case)
     *   - resolution: Detailed conflict resolution record (for debugging/auditing)
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

      // Rule 4: If either lacks timestamp, fall back to incoming (no conflict detection)
      if (!incomingTs || !existingTs) {
        return { winner: incoming, isConflict: false };
      }

      // Compare timestamps (RFC3339 strings are lexicographically comparable)
      if (incomingTs > existingTs) {
        // Rule 1: Incoming is newer - normal case, use incoming
        return { winner: incoming, isConflict: false };
      } else if (existingTs > incomingTs) {
        // Rule 3: Existing is newer - check sync_status for conflict
        // P1-FIX: Both 'pending' and 'syncing' indicate unsynced local changes
        // - 'pending': local changes not yet uploaded
        // - 'syncing': local changes currently being uploaded
        // Both must be protected to prevent server old data from overwriting local modifications
        const hasUnsyncedChanges =
          existingEntity.sync_status === 'pending' ||
          existingEntity.sync_status === 'syncing';

        if (hasUnsyncedChanges) {
          // Rule 3a: Existing is newer AND has unsynced changes - local-wins
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
          // Rule 3b: Existing is newer but already synced - server-wins
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
            () =>
              `mergeWithExisting: conflict resolved in ${entityName} (server wins)\n${JSON.stringify(resolution, null, 2)}`,
          );

          return { winner: incoming, isConflict: false, resolution };
        }
      } else {
        // Rule 2: Timestamps equal - use incoming for idempotency
        return { winner: incoming, isConflict: false };
      }
    };

    /**
     * Merge a list of entities with existing data using unified conflict resolution.
     *
     * For each entity:
     * - If no existing record: use incoming (new entity)
     * - If existing record exists and entity has updated_at: use resolveByTimestamp
     * - If conflict detected (local-wins): return existing unchanged
     * - Otherwise: merge { ...existing, ...incoming } (incoming overrides existing)
     */
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

   /**
     * Message-specific merge with TWO checks in strict priority order:
     *
     * ## Conflict Resolution Priority (highest to lowest)
     *
     * 1. **Streaming status regression detection** (ALWAYS applies, regardless of timestamps)
     *    - If incoming would cause a state regression, return existing unchanged
     *    - This is the HIGHEST priority check — it overrides timestamp comparison
     *    - Rationale: Prevents UI flicker and data corruption when out-of-order updates
     *      arrive from different channels (live-channel vs topic-channel)
     *    - See isStreamingStatusRegression() for lifecycle rules:
     *      pending → streaming → completed/failed (one-directional, no regression allowed)
     *
     * 2. **Timestamp-based conflict resolution** (only if regression check passes)
     *    - Uses same strategy as other entities (see resolveByTimestamp above)
     *    - If conflict detected (local-wins), return existing unchanged
     *    - Rationale: Standard last-write-wins with protection for unsynced local changes
     *
     * ## Interaction Between Checks
     *
     * The streaming regression check is evaluated FIRST, before any timestamp comparison.
     * This means:
     * - Even if incoming has a NEWER timestamp, it will be rejected if it causes regression
     * - Even if existing has sync_status='pending' (would normally trigger local-wins),
     *       the streaming check still runs first
     * - The two checks are independent: regression detection looks at streaming_status,
     *       timestamp comparison looks at updated_at and sync_status
     *
     * ## Example Scenarios
     *
     * Scenario A: Streaming regression blocked despite newer timestamp
     *   existing: { streaming_status: 'completed', updated_at: '10:00:00' }
     *   incoming: { streaming_status: 'streaming', updated_at: '10:00:05' }
     *   Result: KEEP existing (regression blocked, timestamp ignored)
     *
     * Scenario B: Timestamp conflict resolved after regression check passes
     *   existing: { streaming_status: 'streaming', updated_at: '10:00:05', sync_status: 'pending' }
     *   incoming: { streaming_status: 'completed', updated_at: '10:00:00', sync_status: 'synced' }
     *   Result: KEEP existing (no regression, but local-wins due to newer timestamp + pending sync)
     *
     * If both checks pass, merge { ...existing, ...incoming } (incoming overrides existing).
     */
    const mergeMessages = (
      items: Partial<LocalMessage>[],
      existingMap: Map<string, Partial<LocalMessage>>,
    ): Partial<LocalMessage>[] => {
      return items.map((item) => {
        const cid = item.client_id!;
        const prev = existingMap.get(cid);
        if (prev) {
          // Check 1 (HIGHEST PRIORITY): Skip if applying this update would cause a streaming status regression
          // This check ALWAYS applies, regardless of timestamps or sync_status
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

          // Check 2 (LOWER PRIORITY): Timestamp-based conflict resolution
          // Only applies if both have updated_at
          // Only reached if Check 1 passed (no streaming regression)
          if (item.updated_at && prev.updated_at) {
            const { isConflict } = resolveByTimestamp(item, prev, 'message', cid);
            if (isConflict) {
              // Conflict already logged by resolveByTimestamp with structured resolution
              // Return existing unchanged (not merged with incoming)
              return prev;
            }
          }

          // Both checks passed: merge with incoming overriding existing
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
   *
   * PERFORMANCE OPTIMIZATION: Uses batch operations instead of N+1 queries.
   * - bulkGet for parallel session reads (single IndexedDB transaction)
   * - Parallel countActiveTurns queries (all sessions at once)
   * - bulkPut for batch session updates (single write operation)
   * This reduces DB round-trips from O(N) to O(1) for typical cases. (P2-FIX)
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

    const sessionIds = [...affectedSessionIds];

    // Phase 1: Batch read sessions using bulkGet (single IndexedDB operation)
    // P2-FIX: Replaces N individual db.sessions.get() calls
    const sessions = await db.sessions.bulkGet(sessionIds);

    // Phase 2: Parallel count active turns for all sessions
    // All countActiveTurns queries run in parallel (they are read-only within the same transaction)
    const countResults = await Promise.all(
      sessionIds.map((sessionId) => this.countActiveTurns(sessionId)),
    );

    // Phase 3: Build batch update array - only include sessions where counts changed
    const sessionsToUpdate: LocalSession[] = [];
    for (let i = 0; i < sessionIds.length; i++) {
      const session = sessions[i];
      if (!session) continue; // session doesn't exist, skip

      const { pending, running } = countResults[i];

      // Only update when count actually changed (reduce unnecessary writes)
      if (
        session.pending_turn_count !== pending ||
        session.running_turn_count !== running
      ) {
        sessionsToUpdate.push({
          ...session,
          pending_turn_count: pending,
          running_turn_count: running,
        });
      }
    }

    // Phase 4: Batch write using bulkPut (single IndexedDB operation)
    // P2-FIX: Replaces N individual db.sessions.update() calls
    if (sessionsToUpdate.length > 0) {
      await db.sessions.bulkPut(sessionsToUpdate);
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
