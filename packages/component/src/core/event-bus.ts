/**
 * Event Bus
 *
 * 简单的事件总线，用于解耦 FunctionRegistry 和 UI
 *
 * 使用场景：
 * - FunctionRegistry 发出 function:start/success/error/progress 事件
 * - UI 层监听事件并显示 toast/confirm/progress
 * - 宿主应用（Flutter）监听事件并通过 postMessage 转发
 */

/**
 * 事件处理器类型
 */
export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

/**
 * MD8: 事件映射接口 - 为事件名提供类型安全
 *
 * 使用方法：
 * ```ts
 * interface MyEvents {
 *   'user:login': { userId: string };
 *   'user:logout': void;
 * }
 * const bus = createEventBus<MyEvents>();
 * bus.on('user:login', (event) => { ... }); // event 类型为 { userId: string }
 * ```
 */
export interface DefaultEventMap {
  [event: string]: unknown;
}

/**
 * 事件总线
 *
 * @typeParam TEventMap - 事件名到数据类型的映射（MD8）
 */
export class EventBus<TEventMap extends DefaultEventMap = DefaultEventMap> {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * 订阅事件
   *
   * @returns 取消订阅的函数
   */
  on<K extends keyof TEventMap & string>(
    event: K,
    handler: EventHandler<TEventMap[K]>
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);

    // 返回取消订阅函数
    return () => {
      this.handlers.get(event)?.delete(handler as EventHandler);
    };
  }

  /**
   * 订阅一次性事件
   */
  once<K extends keyof TEventMap & string>(
    event: K,
    handler: EventHandler<TEventMap[K]>
  ): () => void {
    const wrapper: EventHandler = (e) => {
      this.off(event, wrapper as EventHandler<TEventMap[K]>);
      return handler(e as TEventMap[K]);
    };
    return this.on(event, wrapper as EventHandler<TEventMap[K]>);
  }

  /**
   * 取消订阅
   */
  off<K extends keyof TEventMap & string>(
    event: K,
    handler: EventHandler<TEventMap[K]>
  ): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  /**
   * 发出事件（同步）
   *
   * M8: 迭代前对 handlers 做快照（Array.from），避免 handler 内调用 off 导致并发修改
   */
  emit<K extends keyof TEventMap & string>(event: K, data: TEventMap[K]): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    // M8: 快照，防止迭代过程中 Set 被修改
    const snapshot = Array.from(handlers);
    for (const handler of snapshot) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[EventBus] Handler error for event '${event}':`, err);
      }
    }
  }

  /**
   * 发出事件（异步，等待所有 handler 完成）
   *
   * M9: 注意：此方法永远 resolve，handler 中的错误会被 catch 并输出到 console.error。
   * 如果需要错误传播（handler 错误导致 emitAsync reject），请使用 emitAsyncStrict。
   */
  async emitAsync<K extends keyof TEventMap & string>(
    event: K,
    data: TEventMap[K]
  ): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    // M8: 快照，防止迭代过程中 Set 被修改
    const snapshot = Array.from(handlers);
    const promises: Promise<void>[] = [];
    for (const handler of snapshot) {
      promises.push(
        Promise.resolve(handler(data)).catch(err => {
          console.error(`[EventBus] Async handler error for event '${event}':`, err);
        })
      );
    }
    await Promise.all(promises);
  }

  /**
   * M9: 严格版异步事件发出 - handler 错误会导致 Promise reject
   *
   * 与 emitAsync 不同，此方法不会吞掉 handler 中的错误。
   * 任一 handler 抛出错误，返回的 Promise 将 reject。
   */
  async emitAsyncStrict<K extends keyof TEventMap & string>(
    event: K,
    data: TEventMap[K]
  ): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    const snapshot = Array.from(handlers);
    const promises: Promise<void>[] = [];
    for (const handler of snapshot) {
      promises.push(Promise.resolve(handler(data)));
    }
    await Promise.all(promises);
  }

  /**
   * m6: 清除所有事件的所有处理器（改名为 clearAll 与 clearEvent 对称）
   */
  clearAll(): void {
    this.handlers.clear();
  }

  /**
   * 清除指定事件的所有处理器
   */
  clearEvent(event: string): void {
    this.handlers.delete(event);
  }
}

/**
 * Function 执行相关事件
 */
export interface FunctionStartEvent {
  path: string;
  params: Record<string, unknown>;
}

export interface FunctionSuccessEvent {
  path: string;
  result: unknown;
}

export interface FunctionErrorEvent {
  path: string;
  error: Error;
}

export interface FunctionProgressEvent {
  path: string;
  progress: number;
}

/**
 * MD8: FunctionRegistry 使用的事件映射
 */
export interface FunctionRegistryEventMap extends DefaultEventMap {
  'function:start': FunctionStartEvent;
  'function:success': FunctionSuccessEvent;
  'function:error': FunctionErrorEvent;
  'function:progress': FunctionProgressEvent;
  'ui:toast': { message: string; type: string };
  'ui:confirm-request': { requestId: string; path: string; message: string };
  'ui:confirm-response': { requestId: string; confirmed: boolean };
}

/**
 * MD7: 事件总线工厂函数
 *
 * 使用工厂函数创建新的事件总线实例，避免全局单例的问题。
 * 全局实例 `defaultEventBus` 只是默认导出，应用可以创建自己的实例。
 */
export function createEventBus<TEventMap extends DefaultEventMap = DefaultEventMap>(): EventBus<TEventMap> {
  return new EventBus<TEventMap>();
}

/**
 * 全局默认事件总线实例（MD7：仅作为默认导出，推荐使用 createEventBus() 创建独立实例）
 */
export const eventBus = createEventBus<FunctionRegistryEventMap>();
