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
 */
export type UIUpdateListener = (event: UIUpdateEvent) => void;

/**
 * UIUpdateBus: singleton publish/subscribe bus for UI updates.
 *
 * - Supports per-entity filtered subscriptions
 * - Supports wildcard subscriptions (receive all entity events)
 */
export class UIUpdateBus {
  /** entity -> subscriber set */
  private entityListeners = new Map<UpdateEntity, Set<UIUpdateListener>>();
  /** Wildcard subscribers (receive all events) */
  private wildcardListeners = new Set<UIUpdateListener>();

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
   */
  publish(event: UIUpdateEvent): void {
    // Wildcard subscribers
    for (const listener of this.wildcardListeners) {
      try {
        listener(event);
      } catch (err) {
        log.error('listener error:', err);
      }
    }
    // Per-entity subscribers
    const set = this.entityListeners.get(event.entity);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch (err) {
          log.error('listener error:', err);
        }
      }
    }
  }

  /**
   * Clear all subscriptions (used for testing / shutdown).
   */
  clear(): void {
    this.entityListeners.clear();
    this.wildcardListeners.clear();
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
