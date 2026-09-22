/**
 * Visibility Manager - 可见性状态机
 *
 * 管理虚拟滚动的可见性状态，确保在不可见时暂停操作，
 * 恢复到可见时同步重建状态。
 *
 * 解决的问题：
 * - Tab 切换（visibility: hidden）时虚拟滚动仍在执行操作
 * - 浏览器窗口失焦（document.hidden）时的状态不一致
 * - 从不可见恢复到可见时骨架屏无法恢复
 */

import {createLogger} from '@rtc-agent/client';

const log = createLogger('VisibilityManager');

/**
 * 可见性状态
 */
export enum VisibilityState {
    /** 可见且活跃 */
    VISIBLE = 'visible',
    /** 不可见（Tab 切换或窗口失焦） */
    HIDDEN = 'hidden',
    /** 正在转换（从 hidden 到 visible 的过渡期） */
    TRANSITIONING = 'transitioning'
}

/**
 * 可见性状态变化监听器
 */
export type VisibilityChangeListener = (state: VisibilityState) => void;

/**
 * 可见性管理器
 *
 * 职责：
 * 1. 维护可见性状态机（VISIBLE ↔ HIDDEN ↔ TRANSITIONING）
 * 2. 通知监听器状态变化
 * 3. 提供操作许可检查（shouldPerformOperations）
 *
 * 使用方式：
 * ```typescript
 * const manager = new VisibilityManager();
 *
 * // 监听状态变化
 * manager.onStateChange(state => {
 *     console.log('Visibility changed:', state);
 * });
 *
 * // 更新可见性（由外部调用）
 * manager.update(true);  // 变为可见
 * manager.update(false); // 变为不可见
 *
 * // 检查是否应该执行操作
 * if (manager.shouldPerformOperations()) {
 *     // 执行虚拟滚动操作
 * }
 * ```
 */
export class VisibilityManager {
    private _state: VisibilityState = VisibilityState.VISIBLE;
    private _listeners: Set<VisibilityChangeListener> = new Set();

    /**
     * 获取当前状态
     */
    get state(): VisibilityState {
        return this._state;
    }

    /**
     * 更新可见性状态
     *
     * 状态转换规则：
     * - VISIBLE → HIDDEN: 直接转换
     * - HIDDEN → VISIBLE: 经过 TRANSITIONING 过渡状态
     * - TRANSITIONING → VISIBLE: 自动转换（在一帧后）
     *
     * @param isVisible 是否可见
     */
    update(isVisible: boolean): void {
        const newState = isVisible ? VisibilityState.VISIBLE : VisibilityState.HIDDEN;

        // 状态未变化，跳过
        if (this._state === newState) {
            return;
        }

        log.debug(`Visibility update: ${this._state} → ${newState}`);

        // 从 HIDDEN 到 VISIBLE 需要经过 TRANSITIONING 状态
        if (this._state === VisibilityState.HIDDEN && newState === VisibilityState.VISIBLE) {
            this._transitionTo(VisibilityState.TRANSITIONING);

            // 给浏览器一帧时间完成布局，然后转为 VISIBLE
            requestAnimationFrame(() => {
                if (this._state === VisibilityState.TRANSITIONING) {
                    this._transitionTo(VisibilityState.VISIBLE);
                }
            });
        } else {
            this._transitionTo(newState);
        }
    }

    /**
     * 转换到指定状态并通知监听器
     */
    private _transitionTo(state: VisibilityState): void {
        if (this._state === state) {
            return;
        }

        const oldState = this._state;
        this._state = state;

        log.debug(`Visibility state changed: ${oldState} → ${state}`);

        // 通知所有监听器
        for (const listener of this._listeners) {
            try {
                listener(state);
            } catch (err) {
                log.error('Visibility change listener failed:', err);
            }
        }
    }

    /**
     * 注册状态变化监听器
     *
     * @param listener 监听器函数
     * @returns 取消注册的函数
     */
    onStateChange(listener: VisibilityChangeListener): () => void {
        this._listeners.add(listener);

        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * 检查当前是否应该执行虚拟滚动操作
     *
     * 只有在 VISIBLE 状态下才允许执行操作（skeletonize、restore 等）。
     * HIDDEN 和 TRANSITIONING 状态下应该暂停所有操作。
     *
     * @returns 是否应该执行操作
     */
    shouldPerformOperations(): boolean {
        return this._state === VisibilityState.VISIBLE;
    }

    /**
     * 检查当前是否可见
     *
     * @returns 是否可见（VISIBLE 或 TRANSITIONING）
     */
    isVisible(): boolean {
        return this._state === VisibilityState.VISIBLE ||
               this._state === VisibilityState.TRANSITIONING;
    }

    /**
     * 清空所有监听器（用于 dispose）
     */
    dispose(): void {
        this._listeners.clear();
        this._state = VisibilityState.VISIBLE;
    }
}
