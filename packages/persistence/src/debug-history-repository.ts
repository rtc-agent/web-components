import Dexie from 'dexie';
import { getDatabase, type DebugHistoryItem, type LocalDebugHistoryItem, type LogEntry } from './database.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('DebugHistoryRepository');

/**
 * Paged query result
 */
export interface PagedResult<T> {
  /** Items in this page */
  items: T[];
  /** Cursor for next page (timestamp|id format), undefined if no more pages */
  nextCursor?: string;
  /** Total record count (for computing totalPages) */
  total: number;
}

// ========== Conversion helpers ==========

function toLocal(item: DebugHistoryItem): LocalDebugHistoryItem {
  return {
    id: item.id,
    function_name: item.functionName,
    params: item.params,
    success: item.success,
    duration_ms: item.durationMs,
    timestamp: item.timestamp,
    logs: JSON.stringify(item.logs),
    error_message: item.errorMessage,
    result: item.result !== undefined ? JSON.stringify(item.result) : undefined,
  };
}

export function fromLocal(local: LocalDebugHistoryItem): DebugHistoryItem {
  let logs: LogEntry[] = [];
  try {
    logs = JSON.parse(local.logs);
  } catch (err) {
    log.warn('Failed to parse logs JSON for item', local.id, err);
  }

  let result: unknown = undefined;
  if (local.result !== undefined) {
    try {
      result = JSON.parse(local.result);
    } catch (err) {
      log.warn('Failed to parse result JSON for item', local.id, err);
      result = local.result;
    }
  }

  return {
    id: local.id,
    functionName: local.function_name,
    params: local.params,
    success: local.success,
    durationMs: local.duration_ms,
    timestamp: local.timestamp,
    logs,
    errorMessage: local.error_message,
    result,
  };
}

// ========== Repository ==========

let repoInstance: DebugHistoryRepository | null = null;

/**
 * Repository for debug history persistence.
 *
 * Pure local data (no sync_status, no UIUpdateBus).
 */
export class DebugHistoryRepository {
  /**
   * Add a new history item.
   */
  async add(item: DebugHistoryItem): Promise<void> {
    const db = getDatabase();
    log.debug('Adding debug history item:', item.id, item.functionName);
    await db.debugHistory.add(toLocal(item));
  }

  /**
   * Query history with optional function name filter and cursor pagination.
   *
   * Uses index-based range queries instead of .filter() to avoid full table scan.
   *
   * @param functionName Filter by function name (optional)
   * @param cursor Pagination cursor in "${timestamp}|${id}" format
   * @param limit Page size (default 20)
   */
  async query(
    functionName?: string,
    cursor?: string,
    limit: number = 20
  ): Promise<PagedResult<DebugHistoryItem>> {
    const db = getDatabase();
    const table = db.debugHistory;

    log.debug('Query debug history:', { functionName, cursor, limit });

    // Get total count
    const total = functionName
      ? await table.where('function_name').equals(functionName).count()
      : await table.count();

    // Build collection with cursor applied
    let items: LocalDebugHistoryItem[];

    if (functionName) {
      // Use compound index [function_name+timestamp] for native ordering
      // Range: [fn, 0] to [fn, maxTimestamp] gives all items for this function, ordered by timestamp asc
      // .reverse() flips to timestamp descending
      const range = cursor
        ? (() => {
            const [tsStr] = cursor.split('|');
            const ts = parseInt(tsStr, 10);
            // Get items with timestamp <= cursor timestamp
            return table
              .where('[function_name+timestamp]')
              .between([functionName, Dexie.minKey], [functionName, ts], true, true)
              .reverse();
          })()
        : table
            .where('[function_name+timestamp]')
            .between([functionName, Dexie.minKey], [functionName, Dexie.maxKey], true, true)
            .reverse();

      const candidates = await range.toArray();

      // Apply cursor tiebreaker: for same-timestamp items, only include those with id < cursor id
      if (cursor) {
        const [tsStr, id] = cursor.split('|');
        const ts = parseInt(tsStr, 10);
        items = candidates
          .filter(item => {
            if (item.timestamp < ts) return true;
            if (item.timestamp === ts && item.id < id) return true;
            return false;
          })
          .slice(0, limit);
      } else {
        items = candidates.slice(0, limit);
      }
    } else {
      // No functionName filter: use timestamp index directly
      if (cursor) {
        const [tsStr, id] = cursor.split('|');
        const ts = parseInt(tsStr, 10);

        items = await table
          .where('timestamp')
          .below(ts)
          .reverse()
          .limit(limit * 2)
          .toArray();

        // Apply id tiebreaker for same-timestamp items
        items = items
          .filter(item => {
            if (item.timestamp < ts) return true;
            if (item.timestamp === ts && item.id < id) return true;
            return false;
          })
          .slice(0, limit);
      } else {
        items = await table
          .orderBy('timestamp')
          .reverse()
          .limit(limit)
          .toArray();
      }
    }

    // Build next cursor
    let nextCursor: string | undefined;
    if (items.length === limit) {
      const last = items[items.length - 1];
      nextCursor = `${last.timestamp}|${last.id}`;
    }

    // Convert to application-level type
    const convertedItems = items.map(fromLocal);

    return { items: convertedItems, nextCursor, total };
  }

  /**
   * Count history items, optionally filtered by function name.
   */
  async count(functionName?: string): Promise<number> {
    const db = getDatabase();
    const table = db.debugHistory;

    if (functionName) {
      return table.where('function_name').equals(functionName).count();
    }
    return table.count();
  }

  /**
   * Batch delete history items by IDs.
   */
  async batchDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = getDatabase();
    log.debug('Batch deleting debug history items:', ids.length);
    await db.debugHistory.bulkDelete(ids);
  }

  /**
   * Clear all history items.
   */
  async clear(): Promise<void> {
    const db = getDatabase();
    log.debug('Clearing all debug history');
    await db.debugHistory.clear();
  }
}

// ========== Singleton ==========

export function initDebugHistoryRepository(): DebugHistoryRepository {
  if (!repoInstance) {
    repoInstance = new DebugHistoryRepository();
  }
  return repoInstance;
}

export function getDebugHistoryRepository(): DebugHistoryRepository {
  if (!repoInstance) {
    throw new Error(
      '[DebugHistoryRepository] not initialized. Call initDebugHistoryRepository() first.'
    );
  }
  return repoInstance;
}
