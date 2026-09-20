import type { UpdateEntity, UpdateAction } from '@rtc-agent/protocol';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('UIUpdateBus');

/**
 * UI update event: describes an actual field change on a persisted entity.
 */
export interface UIUpdateEvent {
  /** Entity type */
  entity: UpdateEntity;
  /** Action type (created / updated / deleted) */
  action: UpdateAction;
  /** Entity ID (server primary key) */
  entityId: string;
  /** Dot-notation path of the changed field, e.g. "title", "content.0.text" */
  field: string;
  /** Old field value (undefined on create) */
  oldValue: unknown;
  /** New field value (undefined on delete) */
  newValue: unknown;
}

/**
 * UI update subscriber callback.
 *
 * May return a Promise for async operations. Events for the same (entity, entityId)
 * are queued per listener, ensuring sequential processing and preventing race conditions.
 */
export type UIUpdateListener = (event: UIUpdateEvent) => void | Promise<void>;

/**
 * UIUpdateBus: singleton publish/subscribe bus for UI updates.
 *
 * - Supports per-entity filtered subscriptions
 * - Supports wildcard subscriptions (receive all entity events)
 * - Events for the same (entity, entityId) are queued per listener,
 *   ensuring sequential processing and preventing race conditions.
 */
export class UIUpdateBus {
  /** entity -> subscriber set */
  private entityListeners = new Map<UpdateEntity, Set<UIUpdateListener>>();
  /** Wildcard subscribers (receive all events) */
  private wildcardListeners = new Set<UIUpdateListener>();

  /**
   * Per-(entity, entityId, listener) promise chains for sequential processing.
   * Key format: "${entity}:${entityId}:${listenerId}"
   *
   * When a listener returns a Promise, subsequent events for the same
   * (entity, entityId) wait for it to complete before processing.
   * This prevents race conditions where async DB reads return stale data.
   */
  private _processingChains = new Map<string, Promise<void>>();

  /** Counter for generating unique listener IDs */
  private _listenerCounter = 0;

  /** Map from listener function to its unique ID (WeakMap for auto-cleanup) */
  private _listenerIds = new WeakMap<UIUpdateListener, number>();

  /**
   * Get or create a unique ID for a listener.
   * Uses WeakMap so IDs are auto-cleaned when listener is garbage collected.
   */
  private _getListenerId(listener: UIUpdateListener): number {
    let id = this._listenerIds.get(listener);
    if (id === undefined) {
      id = ++this._listenerCounter;
      this._listenerIds.set(listener, id);
    }
    return id;
  }

  /**
   * Build a chain key for a specific (entity, entityId, listener) combination.
   */
  private _getChainKey(entity: string, entityId: string, listener: UIUpdateListener): string {
    return `${entity}:${entityId}:${this._getListenerId(listener)}`;
  }

  /**
   * Dispatch an event to a single listener, with queuing for async listeners.
   *
   * If the listener returns a Promise, subsequent events for the same
   * (entity, entityId) will wait for it to complete before processing.
   *
   * Error handling: Both sync and async errors are caught by .catch() to
   * prevent the Promise chain from breaking. A broken chain would cause
   * all subsequent events for this (entity, entityId, listener) to be dropped.
   */
  private _dispatchToListener(listener: UIUpdateListener, event: UIUpdateEvent): void {
    const key = this._getChainKey(event.entity, event.entityId, listener);
    const prev = this._processingChains.get(key) ?? Promise.resolve();

    // Use .catch() at the end to handle both sync and async errors.
    // try-catch alone cannot catch rejected Promises returned by the listener.
    const next = prev
      .then(() => listener(event))
      .catch(err => {
        log.error('listener error:', err);
      });

    // Store the chain for subsequent events
    this._processingChains.set(key, next);

    // Clean up after the chain completes to prevent memory leaks
    next.finally(() => {
      if (this._processingChains.get(key) === next) {
        this._processingChains.delete(key);
      }
    });
  }

  /**
   * Subscribe to all UI update events.
   */
  subscribe(listener: UIUpdateListener): () => void;
  /**
   * Subscribe to UI update events for a specific entity.
   */
  subscribe(entity: UpdateEntity, listener: UIUpdateListener): () => void;
  subscribe(
    entityOrListener: UpdateEntity | UIUpdateListener,
    maybeListener?: UIUpdateListener
  ): () => void {
    if (typeof entityOrListener === 'function') {
      this.wildcardListeners.add(entityOrListener);
      return () => {
        this.wildcardListeners.delete(entityOrListener);
      };
    }
    const entity = entityOrListener;
    const listener = maybeListener!;
    let set = this.entityListeners.get(entity);
    if (!set) {
      set = new Set();
      this.entityListeners.set(entity, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.entityListeners.delete(entity);
      }
    };
  }

  /**
   * Publish a UI update event (called internally by persistence layer only).
   *
   * Events for the same (entity, entityId) are queued per listener,
   * ensuring sequential processing and preventing race conditions.
   */
  publish(event: UIUpdateEvent): void {
    // Wildcard subscribers
    for (const listener of this.wildcardListeners) {
      this._dispatchToListener(listener, event);
    }
    // Per-entity subscribers
    const set = this.entityListeners.get(event.entity);
    if (set) {
      for (const listener of set) {
        this._dispatchToListener(listener, event);
      }
    }
  }

  /**
   * Clear all subscriptions and processing chains (used for testing / shutdown).
   */
  clear(): void {
    this.entityListeners.clear();
    this.wildcardListeners.clear();
    this._processingChains.clear();
    // Note: _listenerIds is a WeakMap, entries auto-clean when listeners are GC'd
  }
}

// ========== Singleton ==========

let instance: UIUpdateBus | null = null;

export function getUIUpdateBus(): UIUpdateBus {
  if (!instance) {
    instance = new UIUpdateBus();
  }
  return instance;
}

/**
 * Shut down and release the singleton (used for testing / process exit).
 */
export function closeUIUpdateBus(): void {
  if (instance) {
    instance.clear();
    instance = null;
  }
}
