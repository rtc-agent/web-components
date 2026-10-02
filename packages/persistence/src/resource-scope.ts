// Resource Scope — 自动管理 timer、listener 等资源的生命周期

import { createLogger } from '@rtc-agent/client';

const log = createLogger('ResourceScope');

/**
 * Resource Scope: 自动管理 timer、event listener 等资源的生命周期。
 *
 * 解决的问题：
 * - P1-NEW-A: withSyncLock 中 setTimeout 未清理
 * - P2-NEW-A: runWithConcurrency 中 abort listener 未清理
 *
 * 使用方式：
 * 1. 创建 scope 实例
 * 2. 使用 scope.setTimeout() 替代 setTimeout()
 * 3. 使用 scope.addEventListener() 替代 addEventListener()
 * 4. 在操作完成后调用 scope.dispose() 清理所有资源
 *
 * @example
 * ```typescript
 * const scope = new ResourceScope();
 * try {
 *   const timer = scope.setTimeout(() => doSomething(), 1000);
 *   scope.addEventListener(signal, 'abort', () => cleanup());
 *   await operation();
 * } finally {
 *   scope.dispose(); // 清理所有 timer 和 listener
 * }
 * ```
 */
export class ResourceScope {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private listeners = new Array<{
    target: EventTarget;
    type: string;
    listener: EventListener;
  }>();
  private disposed = false;

  /**
   * 创建一个受管理的 setTimeout。
   *
   * 作用域关闭时自动清理未触发的 timer。
   * timer 触发后自动从作用域中移除。
   *
   * @param callback 超时回调
   * @param delay 延迟时间（毫秒）
   * @returns Timer ID（可用于手动 clearTimeout）
   */
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    if (this.disposed) {
      // P2-004 fix: throw instead of silently returning fake timer — fail fast to expose bugs
      throw new Error('ResourceScope.setTimeout called after dispose');
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      try {
        callback();
      } catch (err) {
        log.error('ResourceScope.setTimeout callback failed:', err);
      }
    }, delay);

    this.timers.add(timer);
    return timer;
  }

  /**
   * 创建一个受管理的 event listener。
   *
   * 作用域关闭时自动移除未触发的 listener。
   * 如果使用了 { once: true }，listener 触发后自动从作用域中移除。
   *
   * @param target 事件目标
   * @param type 事件类型
   * @param listener 事件处理器
   * @param options 事件选项
   */
  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions
  ): void {
    if (this.disposed) {
      log.warn('ResourceScope.addEventListener called after dispose, listener not added');
      return;
    }

    const wrappedListener = (event: Event) => {
      // 如果是 once listener，自动从作用域中移除
      if (options?.once) {
        const idx = this.listeners.findIndex(l =>
          l.target === target && l.type === type && l.listener === listener
        );
        if (idx !== -1) {
          this.listeners.splice(idx, 1);
        }
      }
      try {
        listener(event);
      } catch (err) {
        log.error('ResourceScope.addEventListener listener failed:', err);
      }
    };

    target.addEventListener(type, wrappedListener, options);
    this.listeners.push({ target, type, listener: wrappedListener });
  }

  /**
   * 手动清理特定的 timer。
   *
   * 通常不需要手动调用，dispose() 会自动清理所有 timer。
   * 但如果需要提前清理某个 timer，可以使用此方法。
   *
   * @param timer Timer ID
   */
  clearTimeout(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  /**
   * 手动移除特定的 listener。
   *
   * 通常不需要手动调用，dispose() 会自动清理所有 listener。
   * 但如果需要提前移除某个 listener，可以使用此方法。
   *
   * @param target 事件目标
   * @param type 事件类型
   * @param listener 事件处理器（必须与添加时相同）
   */
  removeEventListener(
    target: EventTarget,
    type: string,
    listener: EventListener
  ): void {
    const idx = this.listeners.findIndex(l =>
      l.target === target && l.type === type && l.listener === listener
    );
    if (idx !== -1) {
      const entry = this.listeners[idx];
      target.removeEventListener(type, entry.listener);
      this.listeners.splice(idx, 1);
    }
  }

  /**
   * 清理所有资源。
   *
   * 清除所有未触发的 timer，移除所有未触发的 listener。
   * 调用后，后续的 setTimeout/addEventListener 调用将被忽略。
   *
   * 幂等操作：多次调用安全。
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    // 清理所有 timer
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    const timerCount = this.timers.size;
    this.timers.clear();

    // 移除所有 listener
    for (const { target, type, listener } of this.listeners) {
      target.removeEventListener(type, listener);
    }
    const listenerCount = this.listeners.length;
    this.listeners.length = 0;

    if (timerCount > 0 || listenerCount > 0) {
      log.debug(
        `ResourceScope disposed: cleared ${timerCount} timers, removed ${listenerCount} listeners`
      );
    }
  }

  /**
   * 当前作用域是否已关闭。
   */
  get isDisposed(): boolean {
    return this.disposed;
  }
}
