import { createLogger } from '@rtc-agent/client';

const log = createLogger('SyncTaskTracker');

/**
 * SyncTaskTracker — 统一的异步任务追踪器
 *
 * 用于追踪 fire-and-forget 的异步任务（如 background sync），
 * 确保 close() 能等待所有任务完成或超时后再关闭资源。
 *
 * 特性：
 * - 任务完成后自动从追踪集合中移除（防止内存泄漏）
 * - 关闭中（drain 调用后）拒绝新任务（防止关闭期间启动新操作）
 * - drain 带超时，避免无限等待
 */
export class SyncTaskTracker {
  private _tasks = new Set<{ promise: Promise<void>; label: string; startedAt: number }>();
  private _closing = false;

  /**
   * 追踪异步任务，完成后自动移除。
   *
   * 如果 tracker 正在关闭（drain 已调用），新任务会被拒绝并记录警告日志。
   *
   * @param task 要追踪的 Promise<void>
   * @param label 任务标签（用于日志诊断）
   */
  track(task: Promise<void>, label: string): void {
    if (this._closing) {
      log.warn(`SyncTaskTracker: rejecting new task "${label}", tracker is closing`);
      return;
    }
    const entry = { promise: task, label, startedAt: Date.now() };
    this._tasks.add(entry);
    task.finally(() => this._tasks.delete(entry));
  }

  /**
   * Wait for all tracked tasks to complete (with timeout).
   *
   * After calling, tracker enters closing state and rejects new tasks.
   * Timeout resolves (not rejects) — caller decides whether to continue.
   *
   * @param timeoutMs Maximum wait time (milliseconds), default 5000
   * @returns Object with `completed` boolean and `remainingTasks` array of labels
   */
  async drain(timeoutMs: number = 5000): Promise<{ completed: boolean; remainingTasks: string[] }> {
    this._closing = true;
    if (this._tasks.size === 0) {
      return { completed: true, remainingTasks: [] };
    }

    log.debug(`SyncTaskTracker: draining ${this._tasks.size} tasks`);
    const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), timeoutMs));
    const result = await Promise.race([
      Promise.allSettled(Array.from(this._tasks).map(t => t.promise)).then(() => 'completed' as const),
      timeout,
    ]);

    if (result === 'completed') {
      return { completed: true, remainingTasks: [] };
    }

    // Timeout: collect remaining task labels
    const remainingTasks = Array.from(this._tasks).map(t => t.label);
    log.warn(`SyncTaskTracker: drain timed out, ${remainingTasks.length} tasks remaining:`, remainingTasks);
    return { completed: false, remainingTasks };
  }

  /** Number of currently executing tasks */
  get pendingCount(): number {
    return this._tasks.size;
  }

  /**
   * 重置关闭状态，允许接受新任务。
   *
   * 用于测试或重新初始化场景。
   */
  reset(): void {
    this._closing = false;
  }
}
