/**
 * DebugHistoryManager — Debug history CRUD operations.
 *
 * Manages debug history items (tool calls, function invocations) for
 * troubleshooting and auditing purposes.
 *
 * This manager is a thin wrapper around DebugHistoryRepository that adds
 * lifecycle guard protection to all operations.
 */
import type { DebugHistoryItem } from './database.js';
import {
  getDebugHistoryRepository,
  type PagedResult,
} from './debug-history-repository.js';
import type { LifecycleGuard } from './lifecycle-guard.js';

/**
 * DebugHistoryManager — manages debug history items.
 */
export class DebugHistoryManager {
  private debugHistoryRepository;
  private _lifecycleGuard: LifecycleGuard;

  constructor(lifecycleGuard: LifecycleGuard) {
    this.debugHistoryRepository = getDebugHistoryRepository();
    this._lifecycleGuard = lifecycleGuard;
  }

  /**
   * Add a debug history item.
   */
  async addDebugHistoryItem(item: DebugHistoryItem): Promise<void> {
    return this._lifecycleGuard.run(async () => {
      return this.debugHistoryRepository.add(item);
    });
  }

  /**
   * Query debug history with pagination.
   */
  async queryDebugHistory(params: {
    functionName?: string;
    cursor?: string;
    limit?: number;
  }): Promise<PagedResult<DebugHistoryItem>> {
    const result = await this._lifecycleGuard.run(async () => {
      return this.debugHistoryRepository.query(
        params.functionName,
        params.cursor,
        params.limit,
      );
    });
    return result!;
  }

  /**
   * Count debug history items.
   */
  async countDebugHistory(functionName?: string): Promise<number> {
    const result = await this._lifecycleGuard.run(async () => {
      return this.debugHistoryRepository.count(functionName);
    });
    return result ?? 0;
  }

  /**
   * Clear all debug history.
   */
  async clearDebugHistory(): Promise<void> {
    return this._lifecycleGuard.run(async () => {
      return this.debugHistoryRepository.clear();
    });
  }

  /**
   * Batch delete debug history items by IDs.
   */
  async batchDeleteDebugHistory(ids: string[]): Promise<void> {
    return this._lifecycleGuard.run(async () => {
      return this.debugHistoryRepository.batchDelete(ids);
    });
  }
}
