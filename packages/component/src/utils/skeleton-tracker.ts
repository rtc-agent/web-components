/**
 * Skeleton Tracker - 骨架屏生命周期统一管理
 *
 * 替代原有分散的状态管理：
 * - _placeholderItemIds: Set<string>
 * - _placeholderPositions: Array<{itemId: string; y: number}>
 * - _placeholderIndexMap: Map<string, number>
 * - _pendingRestorationIds: Set<string>
 *
 * 统一管理骨架屏的创建、追踪、恢复，提供清晰的 API。
 */

import {createLogger} from '@rtc-agent/client';

const log = createLogger('SkeletonTracker');

/**
 * 骨架屏信息
 */
export interface SkeletonInfo {
    /** 元素 ID */
    itemId: string;
    /** 在 _items 中的索引 */
    index: number;
    /** 绝对 Y 坐标（相对于滚动内容） */
    y: number;
    /** DOM 元素引用 */
    element: HTMLElement;
    /** 是否在待恢复队列中 */
    isPendingRestoration: boolean;
}

/**
 * 骨架屏追踪器
 *
 * 职责：
 * 1. 追踪所有骨架屏的状态（位置、DOM 引用、恢复状态）
 * 2. 提供高效的查询 API（按范围、按 ID）
 * 3. 支持批量操作（重建位置、清空）
 *
 * 使用方式：
 * ```typescript
 * const tracker = new SkeletonTracker();
 *
 * // 添加骨架屏
 * tracker.add(itemId, index, y, element);
 *
 * // 查询范围内的骨架屏
 * const skeletons = tracker.getSkeletonsInRange(top, bottom);
 *
 * // 重建所有位置（布局变化后）
 * tracker.rebuildPositions(scrollContainer, elementMap);
 *
 * // 移除已恢复的骨架屏
 * tracker.remove(itemId);
 * ```
 */
export class SkeletonTracker {
    /** 骨架屏信息映射：itemId → SkeletonInfo */
    private _skeletons: Map<string, SkeletonInfo> = new Map();

    /**
     * 添加骨架屏
     *
     * @param itemId 元素 ID
     * @param index 在 _items 中的索引
     * @param y 绝对 Y 坐标
     * @param element DOM 元素引用
     */
    add(itemId: string, index: number, y: number, element: HTMLElement): void {
        if (this._skeletons.has(itemId)) {
            log.warn(`Skeleton ${itemId} already exists, updating`);
        }

        this._skeletons.set(itemId, {
            itemId,
            index,
            y,
            element,
            isPendingRestoration: false,
        });

        log.debug(`Added skeleton ${itemId} at y=${y}`);
    }

    /**
     * 移除骨架屏
     *
     * @param itemId 元素 ID
     */
    remove(itemId: string): void {
        const removed = this._skeletons.delete(itemId);
        if (removed) {
            log.debug(`Removed skeleton ${itemId}`);
        }
    }

    /**
     * 获取骨架屏信息
     *
     * @param itemId 元素 ID
     * @returns 骨架屏信息，不存在返回 undefined
     */
    get(itemId: string): SkeletonInfo | undefined {
        return this._skeletons.get(itemId);
    }

    /**
     * 检查是否是骨架屏
     *
     * @param itemId 元素 ID
     * @returns 是否是骨架屏
     */
    has(itemId: string): boolean {
        return this._skeletons.has(itemId);
    }

    /**
     * 获取指定 Y 范围内的骨架屏
     *
     * 检查骨架屏的任意部分是否在范围内（顶部、底部或完全包含）。
     *
     * @param yMin 范围上界
     * @param yMax 范围下界
     * @returns 范围内的骨架屏数组
     */
    getInRange(yMin: number, yMax: number): SkeletonInfo[] {
        const result: SkeletonInfo[] = [];

        for (const skeleton of this._skeletons.values()) {
            // 跳过已在恢复队列中的
            if (skeleton.isPendingRestoration) {
                continue;
            }

            // 检查元素是否还在 DOM 中
            if (!skeleton.element.isConnected) {
                log.warn(`Skeleton ${skeleton.itemId} element not connected, removing`);
                this._skeletons.delete(skeleton.itemId);
                continue;
            }

            const skeletonHeight = skeleton.element.getBoundingClientRect().height;
            const skeletonBottom = skeleton.y + skeletonHeight;

            // 检查是否在范围内（任意部分）
            const inRange =
                (skeleton.y >= yMin && skeleton.y <= yMax) || // 顶部在范围内
                (skeletonBottom >= yMin && skeletonBottom <= yMax) || // 底部在范围内
                (skeleton.y < yMin && skeletonBottom > yMax); // 完全包含范围

            if (inRange) {
                result.push(skeleton);
            }
        }

        return result;
    }

    /**
     * 标记骨架屏为待恢复状态
     *
     * @param itemId 元素 ID
     */
    markPending(itemId: string): void {
        const skeleton = this._skeletons.get(itemId);
        if (skeleton) {
            skeleton.isPendingRestoration = true;
        }
    }

    /**
     * 清除待恢复标记
     *
     * @param itemId 元素 ID
     */
    clearPending(itemId: string): void {
        const skeleton = this._skeletons.get(itemId);
        if (skeleton) {
            skeleton.isPendingRestoration = false;
        }
    }

    /**
     * 重建所有骨架屏的 Y 位置
     *
     * 当布局发生变化（容器 resize、元素插入等）后调用，
     * 基于当前 DOM 状态重新计算所有骨架屏的绝对 Y 坐标。
     *
     * @param scrollContainer 滚动容器
     * @param elementMap 索引 → DOM 元素映射
     */
    rebuildPositions(scrollContainer: HTMLElement, elementMap: Map<number, HTMLElement>): void {
        const containerRect = scrollContainer.getBoundingClientRect();

        for (const skeleton of this._skeletons.values()) {
            const element = elementMap.get(skeleton.index);

            if (element && element.isConnected) {
                const rect = element.getBoundingClientRect();
                skeleton.y = rect.top - containerRect.top + scrollContainer.scrollTop;
            } else {
                log.warn(`Skeleton ${skeleton.itemId} element not found at index ${skeleton.index}`);
            }
        }

        log.debug(`Rebuilt positions for ${this._skeletons.size} skeletons`);
    }

    /**
     * 更新骨架屏的索引
     *
     * 当 _items 数组变化（prepend、splice 等）后调用，
     * 更新所有骨架屏的索引以匹配新的 _items 数组。
     *
     * @param indexMap 旧索引 → 新索引映射
     */
    updateIndices(indexMap: Map<number, number>): void {
        for (const skeleton of this._skeletons.values()) {
            const newIndex = indexMap.get(skeleton.index);
            if (newIndex !== undefined) {
                skeleton.index = newIndex;
            }
        }
    }

    /**
     * 清空所有骨架屏
     */
    clear(): void {
        const count = this._skeletons.size;
        this._skeletons.clear();
        log.debug(`Cleared ${count} skeletons`);
    }

    /**
     * 获取所有骨架屏
     *
     * @returns 所有骨架屏数组
     */
    getAll(): SkeletonInfo[] {
        return Array.from(this._skeletons.values());
    }

    /**
     * 获取骨架屏数量
     */
    get size(): number {
        return this._skeletons.size;
    }

    /**
     * 获取待恢复的骨架屏数量
     */
    get pendingCount(): number {
        let count = 0;
        for (const skeleton of this._skeletons.values()) {
            if (skeleton.isPendingRestoration) {
                count++;
            }
        }
        return count;
    }
}
