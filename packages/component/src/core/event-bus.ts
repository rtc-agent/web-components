/**
 * Event Bus
 *
 * Simple event bus for decoupling FunctionRegistry and UI.
 *
 * Usage scenarios:
 * - FunctionRegistry emits function:start/success/error/progress events
 * - UI layer listens to events and displays toast/confirm/progress
 * - Host applications (Flutter) listen to events and forward via postMessage
 */

import {createLogger} from '@rtc-agent/client';

const log = createLogger('EventBus');

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

/**
 * MD8: Event map interface - provides type safety for event names
 *
 * Usage:
 * ```ts
 * interface MyEvents {
 *   'user:login': { userId: string };
 *   'user:logout': void;
 * }
 * const bus = createEventBus<MyEvents>();
 * bus.on('user:login', (event) => { ... }); // event type is { userId: string }
 * ```
 */
export interface DefaultEventMap {
  [event: string]: unknown;
}

/**
 * Event bus
 *
 * @typeParam TEventMap - Mapping from event names to data types (MD8)
 */
export class EventBus<TEventMap extends DefaultEventMap = DefaultEventMap> {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * Subscribe to event
   *
   * @returns Unsubscribe function
   */
  on<K extends keyof TEventMap & string>(
    event: K,
    handler: EventHandler<TEventMap[K]>
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(event)?.delete(handler as EventHandler);
    };
  }

  /**
   * Subscribe to one-time event
   *
   * @returns Unsubscribe function. If not used and the event is never triggered,
   *          the handler will remain in memory until the EventBus is cleared.
   *          For events that may never fire, consider using a timeout or explicit cleanup.
   *
   * @example
   * ```ts
   * const unsub = bus.once('user:login', handleLogin);
   * // Later, if needed:
   * unsub(); // Cancel the one-time subscription
   * ```
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
   * Unsubscribe
   */
  off<K extends keyof TEventMap & string>(
    event: K,
    handler: EventHandler<TEventMap[K]>
  ): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  /**
   * Emit event (synchronous)
   *
   * M8: Snapshot handlers (Array.from) before iteration to avoid concurrent modification when handler calls off
   */
  emit<K extends keyof TEventMap & string>(event: K, data: TEventMap[K]): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    // M8: Snapshot to prevent Set modification during iteration
    const snapshot = Array.from(handlers);
    for (const handler of snapshot) {
      try {
        handler(data);
      } catch (err) {
        log.error(`Handler error for event '${event}':`, err);
      }
    }
  }

  /**
   * Emit event (async, wait for all handlers to complete)
   *
   * M9: Note: this method always resolves; errors in handlers are caught and output via log.error.
   * If error propagation is needed (handler errors cause emitAsync to reject), use emitAsyncStrict.
   */
  async emitAsync<K extends keyof TEventMap & string>(
    event: K,
    data: TEventMap[K]
  ): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    // M8: Snapshot to prevent Set modification during iteration
    const snapshot = Array.from(handlers);
    const promises: Promise<void>[] = [];
    for (const handler of snapshot) {
      promises.push(
        Promise.resolve(handler(data)).catch(err => {
          log.error(`Async handler error for event '${event}':`, err);
        })
      );
    }
    await Promise.all(promises);
  }

  /**
   * M9: Strict async event emit - handler errors cause Promise rejection
   *
   * Unlike emitAsync, this method does not swallow errors from handlers.
   * If any handler throws, the returned Promise will reject.
   *
   * **Important**: All handlers are executed even if one rejects. The returned Promise
   * rejects as soon as any handler rejects (via Promise.all), but other handlers continue
   * to run to completion. This is useful when you need to know if any handler failed,
   * but don't want to abort other handlers' execution.
   *
   * If you need to wait for all handlers regardless of errors, use emitAsync instead.
   *
   * @example
   * ```ts
   * try {
   *   await bus.emitAsyncStrict('user:login', userData);
   * } catch (err) {
   *   // At least one handler failed, but others may still be running
   *   log.error('Login handler failed:', err);
   * }
   * ```
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
   * m6: Clear all handlers for all events (renamed to clearAll for symmetry with clearEvent)
   */
  clearAll(): void {
    this.handlers.clear();
  }

  /**
   * Clear all handlers for a specific event
   */
  clearEvent(event: string): void {
    this.handlers.delete(event);
  }
}

/**
 * Function execution related events
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
 * MD8: Event map used by FunctionRegistry
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
 * MD7: Event bus factory function
 *
 * Uses factory function to create new event bus instances, avoiding global singleton issues.
 * The global instance `defaultEventBus` is just the default export; applications can create their own instances.
 */
export function createEventBus<TEventMap extends DefaultEventMap = DefaultEventMap>(): EventBus<TEventMap> {
  return new EventBus<TEventMap>();
}

/**
 * Global default event bus instance (MD7: only as default export; recommended to use createEventBus() to create independent instances)
 */
export const eventBus = createEventBus<FunctionRegistryEventMap>();
