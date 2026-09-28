/**
 * Skeleton Tracker - Unified skeleton screen lifecycle management
 *
 * Replaces the previously scattered state management:
 * - _placeholderItemIds: Set<string>
 * - _placeholderPositions: Array<{itemId: string; y: number}>
 * - _placeholderIndexMap: Map<string, number>
 * - _pendingRestorationIds: Set<string>
 *
 * Unified management of skeleton screen creation, tracking, and restoration, providing a clear API.
 */

import {createLogger} from '@rtc-agent/client';

const log = createLogger('SkeletonTracker');

/**
 * Skeleton screen info
 */
export interface SkeletonInfo {
    /** Element ID */
    itemId: string;
    /** Index in _items */
    index: number;
    /** Absolute Y coordinate (relative to scroll content) */
    y: number;
    /** DOM element reference */
    element: HTMLElement;
    /** Whether it is in the pending restoration queue */
    isPendingRestoration: boolean;
}

/**
 * Skeleton screen tracker
 *
 * Responsibilities:
 * 1. Track state of all skeleton screens (position, DOM reference, restoration state)
 * 2. Provide efficient query API (by range, by ID)
 * 3. Support batch operations (rebuild positions, clear)
 *
 * Usage:
 * ```typescript
 * const tracker = new SkeletonTracker();
 *
 * // Add skeleton
 * tracker.add(itemId, index, y, element);
 *
 * // Query skeletons in range
 * const skeletons = tracker.getSkeletonsInRange(top, bottom);
 *
 * // Rebuild all positions (after layout changes)
 * tracker.rebuildPositions(scrollContainer, elementMap);
 *
 * // Remove restored skeleton
 * tracker.remove(itemId);
 * ```
 */
export class SkeletonTracker {
    /** Skeleton info map: itemId -> SkeletonInfo */
    private _skeletons: Map<string, SkeletonInfo> = new Map();

    /**
     * Add a skeleton
     *
     * @param itemId Element ID
     * @param index Index in _items
     * @param y Absolute Y coordinate
     * @param element DOM element reference
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
     * Remove a skeleton
     *
     * @param itemId Element ID
     */
    remove(itemId: string): void {
        const removed = this._skeletons.delete(itemId);
        if (removed) {
            log.debug(`Removed skeleton ${itemId}`);
        }
    }

    /**
     * Get skeleton info
     *
     * @param itemId Element ID
     * @returns Skeleton info, or undefined if not found
     */
    get(itemId: string): SkeletonInfo | undefined {
        return this._skeletons.get(itemId);
    }

    /**
     * Check if an item is a skeleton
     *
     * @param itemId Element ID
     * @returns Whether it is a skeleton
     */
    has(itemId: string): boolean {
        return this._skeletons.has(itemId);
    }

    /**
     * Get skeletons within a Y range
     *
     * Checks if any part of the skeleton (top, bottom, or fully contained) is within range.
     *
     * @param yMin Range upper bound
     * @param yMax Range lower bound
     * @returns Array of skeletons within range
     */
    getInRange(yMin: number, yMax: number): SkeletonInfo[] {
        const result: SkeletonInfo[] = [];

        for (const skeleton of this._skeletons.values()) {
            // Skip those already in the restoration queue
            if (skeleton.isPendingRestoration) {
                continue;
            }

            // Check if element is still in the DOM
            if (!skeleton.element.isConnected) {
                log.warn(`Skeleton ${skeleton.itemId} element not connected, removing`);
                this._skeletons.delete(skeleton.itemId);
                continue;
            }

            const skeletonHeight = skeleton.element.getBoundingClientRect().height;
            const skeletonBottom = skeleton.y + skeletonHeight;

            // Check if within range (any part)
            const inRange =
                (skeleton.y >= yMin && skeleton.y <= yMax) || // top is within range
                (skeletonBottom >= yMin && skeletonBottom <= yMax) || // bottom is within range
                (skeleton.y < yMin && skeletonBottom > yMax); // fully contains range

            if (inRange) {
                result.push(skeleton);
            }
        }

        return result;
    }

    /**
     * Mark a skeleton as pending restoration
     *
     * @param itemId Element ID
     */
    markPending(itemId: string): void {
        const skeleton = this._skeletons.get(itemId);
        if (skeleton) {
            skeleton.isPendingRestoration = true;
        }
    }

    /**
     * Clear pending restoration flag
     *
     * @param itemId Element ID
     */
    clearPending(itemId: string): void {
        const skeleton = this._skeletons.get(itemId);
        if (skeleton) {
            skeleton.isPendingRestoration = false;
        }
    }

    /**
     * Rebuild Y positions for all skeletons
     *
     * Called after layout changes (container resize, element insertion, etc.)
     * to recalculate absolute Y coordinates for all skeletons based on current DOM state.
     *
     * @param scrollContainer Scroll container
     * @param elementMap Index -> DOM element map
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
     * Update skeleton indices
     *
     * Called after the _items array changes (prepend, splice, etc.)
     * to update all skeleton indices to match the new _items array.
     *
     * @param indexMap Old index -> new index map
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
     * Clear all skeletons
     */
    clear(): void {
        const count = this._skeletons.size;
        this._skeletons.clear();
        log.debug(`Cleared ${count} skeletons`);
    }

    /**
     * Get all skeletons
     *
     * @returns Array of all skeletons
     */
    getAll(): SkeletonInfo[] {
        return Array.from(this._skeletons.values());
    }

    /**
     * Get skeleton count
     */
    get size(): number {
        return this._skeletons.size;
    }

    /**
     * Get count of skeletons pending restoration
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
