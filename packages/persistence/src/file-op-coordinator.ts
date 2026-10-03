// FileOpCoordinator — coordinates file operations, broadcasts state changes automatically

import type { FileCacheRepository, FileSyncStatus } from './file-cache-repository.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('FileOpCoordinator');

/**
 * 文件操作协调器 — 状态变更自动广播
 *
 * P2-NEW-3 fix: 解决 background sync 和 resumeInterruptedUploads 缺少 per-file 事件广播的问题。
 * 通过注入回调函数，在状态变更时自动通知所有监听者（如 WorkerCore）。
 *
 * 使用场景：
 * - background sync 状态变更
 * - resumeInterruptedUploads 状态变更
 * - 其他需要 per-file 状态广播的场景
 */
export class FileOpCoordinator {
  // P2-D fix: support multiple listeners
  private _listeners = new Set<(md5: string, ext: string, status: FileSyncStatus, errorMessage?: string) => void>();

  /**
   * Add a status change listener.
   *
   * @param fn Status change callback (md5, ext, newStatus, errorMessage?)
   * @returns A dispose function that removes the listener when called
   */
  onStatusChange(
    fn: (md5: string, ext: string, status: FileSyncStatus, errorMessage?: string) => void
  ): () => void {
    this._listeners.add(fn);
    log.debug(`FileOpCoordinator: listener added, total=${this._listeners.size}`);
    return () => {
      this._listeners.delete(fn);
      log.debug(`FileOpCoordinator: listener removed, total=${this._listeners.size}`);
    };
  }

  /**
   * Remove all status change listeners.
   */
  clearAllListeners(): void {
    this._listeners.clear();
    log.debug('FileOpCoordinator: all listeners cleared');
  }

  /**
   * 状态变更 + 自动广播
   *
   * 封装了 FileCacheRepository.transitionSyncStatus，在状态变更成功后自动调用回调。
   *
   * @param repo FileCacheRepository 实例
   * @param md5 文件 MD5 哈希
   * @param ext 文件扩展名
   * @param from 允许的当前状态（单个或数组）
   * @param to 目标状态
   * @param metadata 可选的元数据（errorMessage、syncedAt）
   * @returns 是否成功变更状态
   */
  async transitionAndNotify(
    repo: FileCacheRepository,
    md5: string,
    ext: string,
    from: FileSyncStatus | FileSyncStatus[],
    to: FileSyncStatus,
    metadata?: { errorMessage?: string; syncedAt?: number }
  ): Promise<boolean> {
    const result = await repo.transitionSyncStatus(md5, ext, from, to, metadata);
    if (result) {
      log.debug(`transitionAndNotify: ${md5}.${ext} -> ${to}, notifying listeners`);
      this._notifyAll(md5, ext, to, metadata?.errorMessage);
    } else {
      log.debug(`transitionAndNotify: ${md5}.${ext} transition skipped (precondition not met)`);
    }
    return result;
  }

  /**
   * 直接广播状态变更（不经过 repo）
   *
   * 用于已经在 repo 层面完成状态变更，只需要广播通知的场景。
   *
   * @param md5 文件 MD5 哈希
   * @param ext 文件扩展名
   * @param status 新的同步状态
   * @param errorMessage 可选的错误信息
   */
  notifyStatusChange(
    md5: string,
    ext: string,
    status: FileSyncStatus,
    errorMessage?: string
  ): void {
    log.debug(`notifyStatusChange: ${md5}.${ext} -> ${status}`);
    this._notifyAll(md5, ext, status, errorMessage);
  }

  /**
   * Broadcast status change to all registered listeners.
   * Catches and logs errors from individual listeners to prevent one bad listener from breaking others.
   */
  private _notifyAll(md5: string, ext: string, status: FileSyncStatus, errorMessage?: string): void {
    for (const listener of this._listeners) {
      try {
        listener(md5, ext, status, errorMessage);
      } catch (err) {
        log.warn('FileOpCoordinator: listener threw:', err);
      }
    }
  }
}

