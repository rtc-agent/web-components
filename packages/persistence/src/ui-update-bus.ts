import type { UpdateEntity, UpdateAction } from '@rtc-agent/protocol';

/**
 * UI 更新事件：描述持久化层中某条实体的某个字段的真实变化
 */
export interface UIUpdateEvent {
  /** 实体类型 */
  entity: UpdateEntity;
  /** 操作类型（created / updated / deleted） */
  action: UpdateAction;
  /** 实体 ID（服务端主键） */
  entityId: string;
  /** 变更字段的点号路径，例如 "title"、"content.0.text" */
  field: string;
  /** 字段旧值（新增时为 undefined） */
  oldValue: unknown;
  /** 字段新值（删除时为 undefined） */
  newValue: unknown;
}

/**
 * UI 更新订阅者
 */
export type UIUpdateListener = (event: UIUpdateEvent) => void;

/**
 * UIUpdateBus：单例发布 / 订阅总线
 *
 * - 支持按 entity 过滤订阅
 * - 支持通配订阅（接收所有 entity 的事件）
 */
export class UIUpdateBus {
  /** entity -> 订阅者集合 */
  private entityListeners = new Map<UpdateEntity, Set<UIUpdateListener>>();
  /** 通配订阅者（接收全部事件） */
  private wildcardListeners = new Set<UIUpdateListener>();

  /**
   * 订阅所有 UI 更新事件
   */
  subscribe(listener: UIUpdateListener): () => void;
  /**
   * 订阅指定 entity 的 UI 更新事件
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
   * 发布 UI 更新事件（仅由 persistence 内部调用）
   */
  publish(event: UIUpdateEvent): void {
    // 通配订阅者
    for (const listener of this.wildcardListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[UIUpdateBus] listener error:', err);
      }
    }
    // 按 entity 订阅者
    const set = this.entityListeners.get(event.entity);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch (err) {
          console.error('[UIUpdateBus] listener error:', err);
        }
      }
    }
  }

  /**
   * 清除所有订阅（用于测试 / 关闭）
   */
  clear(): void {
    this.entityListeners.clear();
    this.wildcardListeners.clear();
  }
}

// ========== 单例 ==========

let instance: UIUpdateBus | null = null;

export function getUIUpdateBus(): UIUpdateBus {
  if (!instance) {
    instance = new UIUpdateBus();
  }
  return instance;
}

/**
 * 关闭并释放单例（用于测试 / 进程退出）
 */
export function closeUIUpdateBus(): void {
  if (instance) {
    instance.clear();
    instance = null;
  }
}
