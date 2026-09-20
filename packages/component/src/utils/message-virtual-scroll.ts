/**
 * Message Virtual Scroll - Inspired by Telegram Web
 *
 * Architecture (mirrors Telegram's bubbles.ts + appMessagesManager):
 * 1. Data layer: external repository = "cache" (like appMessagesManager)
 * 2. DOM layer: _elementMap = rendered DOM elements (like bubbles)
 * 3. Viewport slicing: classify into invisibleTop/visible/invisibleBottom
 * 4. Delete slice: remove off-screen DOM, mark loadedTop/Bottom = false
 * 5. Restore: when scrolling back, onLoadMore loads from cache using window boundary IDs
 *
 * Key Telegram references:
 * - loadMoreHistory: components/chat/bubbles.ts:4570
 *   - getRenderedHistory('asc') → [firstMid, ..., lastMid]
 *   - getHistory1(history[0], true) for top
 *   - getHistory1(history[last], false, true) for bottom
 */

import {ScrollSaver} from './scroll-saver.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('VirtualScroll');

export interface WindowBoundary {
    /** First item's ID in current window (undefined if empty) */
    firstId: string | undefined;
    /** Last item's ID in current window (undefined if empty) */
    lastId: string | undefined;
}

export interface MessageVirtualScrollOptions<T> {
    scrollContainer: HTMLElement;
    innerContainer: HTMLElement;
    renderItem: (item: T, index: number) => HTMLElement;
    getItemId: (item: T) => string;

    /**
     * Called when scrolling near edge and more messages may be available.
     * Receives current window boundary - use it to load adjacent messages from cache.
     * Return empty array to signal no more messages in that direction.
     *
     * Mirrors Telegram's loadMoreHistory → getHistory1(maxId, reverse) pattern.
     */
    onLoadMore?: (direction: 'top' | 'bottom', boundary: WindowBoundary) => Promise<T[]>;

    /** CSS selector for message elements (default: '.message') */
    query?: string;

    /**
     * Preload threshold - start loading when this far from edge (px, default: 300).
     * Telegram uses 300px (onScrollOffset = 300).
     */
    preloadThreshold?: number;

    /** Messages to keep as buffer on each side of viewport (default: 20) */
    bufferMessages?: number;

    /** Interval for viewport slicing check in ms (default: 3000, like Telegram) */
    sliceInterval?: number;

    /** Callback when content size changes (for custom scrollbar) */
    onSizeChange?: () => void;

    /**
     * Extract the "changeable content" from an item for comparison.
     * Only the returned value is compared to detect changes.
     * This is more efficient than JSON.stringify on the entire item.
     *
     * Example: For messages, return {content, status, timestamp} to ignore
     * internal fields that don't affect rendering.
     *
     * If not provided, falls back to JSON.stringify comparison.
     */
    getChangeableContent?: (item: T) => unknown;

    /**
     * Update an existing element in-place with new item data.
     * If provided, updateItemById and updateItems will call this instead of
     * destroying and recreating the element. This preserves DOM state
     * (e.g., rendered Markdown) and prevents visual flicker during streaming.
     *
     * The callback should update the element's properties to reflect the new item.
     * If not provided, falls back to destroy-rebuild pattern.
     */
    updateItemElement?: (element: HTMLElement, item: T, index: number) => void;
}

interface ViewportSlicePart<T> {
    element: HTMLElement;
    rect: DOMRect;
    index: number;
    item: T;
}

export class MessageVirtualScroll<T> {
    private _scrollContainer: HTMLElement;
    private _innerContainer: HTMLElement;
    private _renderItem: (item: T, index: number) => HTMLElement;
    private _getItemId: (item: T) => string;
    private _onLoadMore?: (direction: 'top' | 'bottom', boundary: WindowBoundary) => Promise<T[]>;
    private _onSizeChange?: () => void;
    private _getChangeableContent?: (item: T) => unknown;
    private _updateItemElement?: (element: HTMLElement, item: T, index: number) => void;
    private _query: string;
    private _preloadThreshold: number;
    private _bufferMessages: number;

    /** Currently loaded window of items */
    private _items: T[] = [];
    /** Map from item index to DOM element */
    private _elementMap: Map<number, HTMLElement> = new Map();
    /** Map from item ID to index for O(1) lookup */
    private _idToIndex: Map<string, number> = new Map();

    /**
     * loadedTop = true means "no more messages above the current window"
     * loadedBottom = true means "no more messages below the current window"
     *
     * When viewport is sliced, these become false, signaling that scrolling
     * back should trigger onLoadMore to restore destroyed messages.
     * (Mirrors Telegram's scrollable.loadedAll)
     */
    private _loadedTop = true;
    private _loadedBottom = true;

    private _isLoading = {top: false, bottom: false};
    private _scrollHandler: (() => void) | null = null;
    private _sliceDebounceTimer: number | null = null;
    private _sliceDebounceDelay: number;

    constructor(options: MessageVirtualScrollOptions<T>) {
        this._scrollContainer = options.scrollContainer;
        this._innerContainer = options.innerContainer;
        this._renderItem = options.renderItem;
        this._getItemId = options.getItemId;
        this._onLoadMore = options.onLoadMore;
        this._onSizeChange = options.onSizeChange;
        this._getChangeableContent = options.getChangeableContent;
        this._updateItemElement = options.updateItemElement;
        this._query = options.query ?? '.message';
        this._preloadThreshold = options.preloadThreshold ?? 300;
        this._bufferMessages = options.bufferMessages ?? 20;
        this._sliceDebounceDelay = options.sliceInterval ?? 3000;

        this._scrollHandler = () => this._onScroll();
        this._scrollContainer.addEventListener('scroll', this._scrollHandler, {passive: true});
    }

    /**
     * Set initial items (e.g., latest messages).
     * Called on first load - scrolls to bottom.
     */
    setItems(items: T[]) {
        this._items = [...items];
        // Initially: there may be more messages above, we're at the bottom
        this._loadedTop = false;
        this._loadedBottom = true;
        this._renderAll();
    }

    /**
     * Update items in place (e.g., when message status changes from 'syncing' to 'synced').
     * Only re-renders items that have changed and are currently in the DOM.
     * More efficient than setItems() which re-renders everything.
     *
     * Uses ID-based lookup + deep content comparison to avoid unnecessary DOM recreation.
     * This is critical for preserving Markdown DOM when tab switching triggers reload()
     * which returns new array references but identical content.
     */
    updateItems(items: T[]) {
        // Build a map of old items by ID for quick lookup
        const oldItemsById = new Map<string, { index: number; item: T }>();
        this._items.forEach((item, index) => {
            oldItemsById.set(this._getItemId(item), { index, item });
        });

        // Update items array
        this._items = [...items];

        // Find and re-render changed items
        items.forEach((newItem, newIndex) => {
            const itemId = this._getItemId(newItem);
            const oldEntry = oldItemsById.get(itemId);

            if (!oldEntry) {
                // New item (shouldn't happen in updateItems, but handle gracefully)
                return;
            }

            // Deep compare: if content is identical, skip re-render
            // This prevents Markdown DOM destruction when tab switching returns
            // new array references with identical content
            if (this._itemsEqual(oldEntry.item, newItem)) {
                return; // No change
            }

            // Item changed - check if it's currently rendered
            const element = this._elementMap.get(oldEntry.index);
            if (!element || !element.isConnected) {
                return; // Not in DOM
            }

            // In-place update: preserve DOM state (e.g., rendered Markdown)
            if (this._updateItemElement) {
                this._updateItemElement(element, newItem, newIndex);
            } else {
                // Fallback: destroy and rebuild
                const newElement = this._renderItem(newItem, newIndex);
                newElement.dataset.messageIndex = String(newIndex);
                this._elementMap.set(newIndex, newElement);
                element.replaceWith(newElement);
            }

            // Notify size change (height might have changed)
            this._onSizeChange?.();
        });
    }

    /**
     * Deep compare two items for equality.
     * If getChangeableContent is provided, only compares the extracted content.
     * Otherwise, falls back to JSON.stringify comparison.
     */
    protected _itemsEqual(a: T, b: T): boolean {
        if (this._getChangeableContent) {
            // Compare only the changeable content (more efficient)
            const contentA = this._getChangeableContent(a);
            const contentB = this._getChangeableContent(b);
            return JSON.stringify(contentA) === JSON.stringify(contentB);
        }
        // Fallback: compare entire items
        return JSON.stringify(a) === JSON.stringify(b);
    }

    /**
     * Mark that all messages in a direction have been loaded.
     * Called by the consumer when repository has no more messages.
     */
    setFullyLoaded(direction: 'top' | 'bottom', value: boolean) {
        if (direction === 'top') {
            this._loadedTop = value;
        } else {
            this._loadedBottom = value;
        }
    }

    /**
     * Prepend items (older messages) with smooth scroll compensation.
     * Uses Telegram's ScrollSaver algorithm.
     *
     * IMPORTANT: Only inserts new elements at the beginning, does NOT re-render
     * all elements. This preserves DOM element references for ScrollSaver.
     */
    prependItems(items: T[]): void {
        if (items.length === 0) return;

        // Save scroll state using Telegram's algorithm
        const scrollSaver = new ScrollSaver(this._scrollContainer, this._query, true);
        scrollSaver.save();

        // Prepend to items array
        this._items = [...items, ...this._items];

        // Re-index existing elements (indices shift after prepend)
        // We need to update messageIndex dataset for all existing elements
        const existingElements = Array.from(this._innerContainer.children) as HTMLElement[];
        for (const el of existingElements) {
            const oldIndex = parseInt(el.dataset.messageIndex || '-1', 10);
            if (oldIndex >= 0) {
                el.dataset.messageIndex = String(oldIndex + items.length);
            }
        }

        // Insert new elements at the beginning (don't re-render existing)
        const fragment = document.createDocumentFragment();
        items.forEach((item, index) => {
            const el = this._renderItem(item, index);
            el.dataset.messageIndex = String(index);
            this._elementMap.set(index, el);
            fragment.appendChild(el);
        });

        // Insert at the beginning
        if (this._innerContainer.firstChild) {
            this._innerContainer.insertBefore(fragment, this._innerContainer.firstChild);
        } else {
            this._innerContainer.appendChild(fragment);
        }

        // Re-index existing elements in _elementMap (indices shift after prepend)
        const newElementMap = new Map<number, HTMLElement>();
        this._elementMap.forEach((el, oldIndex) => {
            newElementMap.set(oldIndex + items.length, el);
        });
        this._elementMap = newElementMap;

        // Rebuild ID-to-index mapping
        this._rebuildIdToIndex();

        // Restore scroll position using Telegram's algorithm
        scrollSaver.restore();

        // Notify size change (for custom scrollbar)
        this._onSizeChange?.();
    }

    /**
     * Append items (newer messages) with smooth scroll compensation.
     * Uses Telegram's ScrollSaver algorithm with reverse=false.
     * Anchors to the LAST visible element's bottom position.
     */
    appendItems(items: T[]): void {
        if (items.length === 0) return;

        // Save scroll state using Telegram's algorithm (reverse=false for bottom)
        const scrollSaver = new ScrollSaver(this._scrollContainer, this._query, false);
        scrollSaver.save();

        const scrollTopBefore = this._scrollContainer.scrollTop;
        const scrollHeightBefore = this._scrollContainer.scrollHeight;

        const startIndex = this._items.length;
        this._items = [...this._items, ...items];

        // Render new items
        this._renderNewItems(items, startIndex);

        const scrollHeightAfter = this._scrollContainer.scrollHeight;

        // Restore scroll position using Telegram's algorithm
        scrollSaver.restore();

        const scrollTopAfter = this._scrollContainer.scrollTop;

        log.debug(
            `appendItems: ` +
            `items=${items.length}, scrollHeight: ${scrollHeightBefore} → ${scrollHeightAfter}, ` +
            `scrollTop: ${scrollTopBefore} → ${scrollTopAfter}, ` +
            `diff=${scrollTopAfter - scrollTopBefore}`
        );

        this._onSizeChange?.();
    }

    /**
     * Update a single item by ID.
     * O(1) lookup using _idToIndex map.
     *
     * @param itemId - The ID of the item to update
     * @param newItem - The new item data
     * @returns true if the item was found and updated, false otherwise
     */
    updateItemById(itemId: string, newItem: T): boolean {
        const index = this._idToIndex.get(itemId);
        if (index === undefined) return false;

        const element = this._elementMap.get(index);
        if (!element || !element.isConnected) return false;

        // Check if content actually changed
        const oldItem = this._items[index];
        if (this._itemsEqual(oldItem, newItem)) {
            return true; // No change, but item exists
        }

        // Update items array
        this._items[index] = newItem;

        // In-place update: preserve DOM state (e.g., rendered Markdown)
        if (this._updateItemElement) {
            this._updateItemElement(element, newItem, index);
        } else {
            // Fallback: destroy and rebuild
            const newElement = this._renderItem(newItem, index);
            newElement.dataset.messageIndex = String(index);
            this._elementMap.set(index, newElement);
            element.replaceWith(newElement);
        }

        // Notify size change (height might have changed)
        this._onSizeChange?.();

        return true;
    }

    clear() {
        this._items = [];
        this._elementMap.clear();
        this._idToIndex.clear();
        this._innerContainer.innerHTML = '';
        this._loadedTop = true;
        this._loadedBottom = true;
    }

    scrollToBottom() {
        this._scrollContainer.scrollTop = this._scrollContainer.scrollHeight;
    }

    dispose() {
        if (this._scrollHandler) {
            this._scrollContainer.removeEventListener('scroll', this._scrollHandler);
        }
        if (this._sliceDebounceTimer) {
            clearTimeout(this._sliceDebounceTimer);
        }
    }

    getStats() {
        return {
            totalItems: this._items.length,
            renderedItems: this._elementMap.size,
            loadedTop: this._loadedTop,
            loadedBottom: this._loadedBottom,
            firstId: this._items.length > 0 ? this._getItemId(this._items[0]) : undefined,
            lastId: this._items.length > 0 ? this._getItemId(this._items[this._items.length - 1]) : undefined,
        };
    }

    /**
     * Get current window boundary (like Telegram's getRenderedHistory).
     */
    private _getWindowBoundary(): WindowBoundary {
        return {
            firstId: this._items.length > 0 ? this._getItemId(this._items[0]) : undefined,
            lastId: this._items.length > 0 ? this._getItemId(this._items[this._items.length - 1]) : undefined,
        };
    }

    // ── Scroll Handler ──

    private _onScroll() {
        const {scrollTop, scrollHeight, clientHeight} = this._scrollContainer;
        const distanceFromTop = scrollTop;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        log.debug(
            `_onScroll: scrollTop=${scrollTop}, scrollHeight=${scrollHeight}, clientHeight=${clientHeight}, ` +
            `distanceFromTop=${distanceFromTop}, distanceFromBottom=${distanceFromBottom}, ` +
            `loadedTop=${this._loadedTop}, loadedBottom=${this._loadedBottom}, ` +
            `isLoadingTop=${this._isLoading.top}, isLoadingBottom=${this._isLoading.bottom}`
        );

        // Debounced viewport slicing (like Telegram's sliceViewportDebounced)
        // Reset timer on each scroll event, execute after user stops scrolling
        if (this._sliceDebounceTimer) {
            clearTimeout(this._sliceDebounceTimer);
        }
        this._sliceDebounceTimer = window.setTimeout(() => {
            this._sliceViewport();
        }, this._sliceDebounceDelay);

        if (!this._onLoadMore) {
            log.debug('_onScroll: no onLoadMore callback');
            return;
        }

        const boundary = this._getWindowBoundary();
        log.debug(`_onScroll: boundary=${JSON.stringify(boundary)}`);

        // Load more top: near top AND not fully loaded in that direction
        // Telegram uses onScrollOffset = 300px for early triggering
        if (distanceFromTop < this._preloadThreshold && !this._loadedTop && !this._isLoading.top) {
            log.debug(`Triggering loadMore(top), distanceFromTop=${distanceFromTop}, threshold=${this._preloadThreshold}, boundary.firstId=${boundary.firstId}`);
            this._isLoading.top = true;
            this._onLoadMore('top', boundary)
                .then(items => {
                    log.debug(`loadMore(top) returned ${items.length} items`);
                    if (items.length > 0) {
                        return this.prependItems(items);
                    }
                    // No more messages returned directly - but DO NOT auto-mark as fully loaded.
                    // Consumer controls _loadedTop via setFullyLoaded() based on repository's hasMore.
                    // (loadMore may be async; actual items arrive via subscription updates.)
                    log.debug('loadMore(top) returned 0 items; consumer should update loadedTop via setFullyLoaded()');
                })
                .finally(() => {
                    this._isLoading.top = false;
                });
        } else {
            log.debug(
                `loadMore(top) NOT triggered: ` +
                `distanceFromTop=${distanceFromTop} >= threshold=${this._preloadThreshold}? ${distanceFromTop >= this._preloadThreshold}, ` +
                `loadedTop=${this._loadedTop}, isLoadingTop=${this._isLoading.top}`
            );
        }

        // Load more bottom: near bottom AND not fully loaded in that direction
        if (distanceFromBottom < this._preloadThreshold && !this._loadedBottom && !this._isLoading.bottom) {
            log.debug(`Triggering loadMore(bottom), distanceFromBottom=${distanceFromBottom}, threshold=${this._preloadThreshold}, boundary.lastId=${boundary.lastId}`);
            this._isLoading.bottom = true;
            this._onLoadMore('bottom', boundary)
                .then(items => {
                    log.debug(`loadMore(bottom) returned ${items.length} items`);
                    if (items.length > 0) {
                        return this.appendItems(items);
                    }
                    // No more messages returned directly - but DO NOT auto-mark as fully loaded.
                    // Consumer controls _loadedBottom via setFullyLoaded() based on repository's hasMore.
                    log.debug('loadMore(bottom) returned 0 items; consumer should update loadedBottom via setFullyLoaded()');
                })
                .finally(() => {
                    this._isLoading.bottom = false;
                });
        }
    }

    // ── Viewport Slicing (Telegram-style) ──

    /**
     * Classify elements into invisibleTop, visible, invisibleBottom.
     * Mirrors Telegram's getViewportSlice (helpers/dom/getViewportSlice.ts).
     */
    private _getViewportSlice(): {
        invisibleTop: ViewportSlicePart<T>[];
        visible: ViewportSlicePart<T>[];
        invisibleBottom: ViewportSlicePart<T>[];
    } {
        const containerRect = this._scrollContainer.getBoundingClientRect();
        const children = Array.from(this._innerContainer.children) as HTMLElement[];

        const invisibleTop: ViewportSlicePart<T>[] = [];
        const visible: ViewportSlicePart<T>[] = [];
        const invisibleBottom: ViewportSlicePart<T>[] = [];
        let foundVisible = false;

        for (const element of children) {
            const index = parseInt(element.dataset.messageIndex || '-1', 10);
            if (index < 0 || index >= this._items.length) continue;

            const rect = element.getBoundingClientRect();
            // Check if element intersects with container viewport
            const isVisible = rect.bottom > containerRect.top && rect.top < containerRect.bottom;

            let target: ViewportSlicePart<T>[];
            if (isVisible) {
                foundVisible = true;
                target = visible;
            } else if (foundVisible) {
                target = invisibleBottom;
            } else {
                target = invisibleTop;
            }

            target.push({element, rect, index, item: this._items[index]});
        }

        // Keep buffer on each side (like Telegram's extraMinLength)
        // Move last N from invisibleTop → visible
        const bufferCount = this._bufferMessages;
        if (bufferCount > 0) {
            const fromTop = invisibleTop.splice(Math.max(0, invisibleTop.length - bufferCount), bufferCount);
            visible.unshift(...fromTop);

            // Move first N from invisibleBottom → visible
            const fromBottom = invisibleBottom.splice(0, bufferCount);
            visible.push(...fromBottom);
        }

        return {invisibleTop, visible, invisibleBottom};
    }

    /**
     * Slice viewport: destroy off-screen messages, mark loaded flags.
     * Mirrors Telegram's deleteViewportSlice (bubbles.ts:12390).
     *
     * IMPORTANT: Skip slicing if container is hidden (visibility: hidden).
     * When hidden, getBoundingClientRect() returns zeros, causing all elements
     * to be misclassified and destroyed. ScrollSaver also fails with zero rects.
     */
    private _sliceViewport() {
        if (this._elementMap.size === 0) return;

        // Check if container is visible (not hidden by content-visibility)
        const containerRect = this._scrollContainer.getBoundingClientRect();
        const isContainerVisible = containerRect.width > 0 && containerRect.height > 0;
        if (!isContainerVisible) {
            log.debug('Skipping _sliceViewport: container is hidden');
            return;
        }

        const slice = this._getViewportSlice();
        const {invisibleTop, invisibleBottom} = slice;

        if (invisibleTop.length === 0 && invisibleBottom.length === 0) return;

        log.debug(
            `Slicing viewport: invisibleTop=${invisibleTop.length}, ` +
            `visible=${slice.visible.length}, invisibleBottom=${invisibleBottom.length}`
        );

        // Mark as not fully loaded (like Telegram's setLoaded)
        if (invisibleTop.length > 0) {
            this._loadedTop = false;
        }
        if (invisibleBottom.length > 0) {
            this._loadedBottom = false;
        }

        // Save scroll state
        const scrollSaver = new ScrollSaver(this._scrollContainer, this._query, invisibleTop.length > 0);
        scrollSaver.save();

        // Remove invisible top elements
        for (const part of invisibleTop) {
            part.element.remove();
            this._elementMap.delete(part.index);
        }

        // Remove invisible bottom elements
        for (const part of invisibleBottom) {
            part.element.remove();
            this._elementMap.delete(part.index);
        }

        // Remove items from _items array (keep only visible items)
        const visibleIndices = new Set(slice.visible.map(p => p.index));
        this._items = this._items.filter((_, i) => visibleIndices.has(i));

        // Rebuild _elementMap with new indices
        const newElementMap = new Map<number, HTMLElement>();
        let newIndex = 0;
        slice.visible.forEach(part => {
            newElementMap.set(newIndex, part.element);
            part.element.dataset.messageIndex = String(newIndex);
            newIndex++;
        });
        this._elementMap = newElementMap;

        // Rebuild ID-to-index mapping
        this._rebuildIdToIndex();

        // Restore scroll position
        scrollSaver.restore();

        // Notify size change
        this._onSizeChange?.();

        log.debug(
            `After slice: items=${this._items.length}, ` +
            `loadedTop=${this._loadedTop}, loadedBottom=${this._loadedBottom}`
        );
    }

    // ── Rendering ──

    private _renderAll() {
        this._innerContainer.innerHTML = '';
        this._elementMap.clear();
        this._idToIndex.clear();

        const fragment = document.createDocumentFragment();
        this._items.forEach((item, index) => {
            const el = this._renderItem(item, index);
            el.dataset.messageIndex = String(index);
            this._elementMap.set(index, el);
            this._idToIndex.set(this._getItemId(item), index);
            fragment.appendChild(el);
        });

        this._innerContainer.appendChild(fragment);
    }

    /**
     * Rebuild the ID-to-index mapping from current _items array.
     * Called after operations that change item indices (prepend, slice, etc.)
     */
    private _rebuildIdToIndex() {
        this._idToIndex.clear();
        this._items.forEach((item, index) => {
            this._idToIndex.set(this._getItemId(item), index);
        });
    }

    private _renderNewItems(items: T[], startIndex: number) {
        const fragment = document.createDocumentFragment();
        items.forEach((item, i) => {
            const index = startIndex + i;
            const el = this._renderItem(item, index);
            el.dataset.messageIndex = String(index);
            this._elementMap.set(index, el);
            this._idToIndex.set(this._getItemId(item), index);
            fragment.appendChild(el);
        });
        this._innerContainer.appendChild(fragment);
    }
}
