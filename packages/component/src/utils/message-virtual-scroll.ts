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
    private _query: string;
    private _preloadThreshold: number;
    private _bufferMessages: number;

    /** Currently loaded window of items */
    private _items: T[] = [];
    /** Map from item index to DOM element */
    private _elementMap: Map<number, HTMLElement> = new Map();

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
     */
    async prependItems(items: T[]): Promise<void> {
        if (items.length === 0) return;

        // Save scroll state using Telegram's algorithm
        const scrollSaver = new ScrollSaver(this._scrollContainer, this._query, true);
        scrollSaver.save();

        // Prepend to items array
        this._items = [...items, ...this._items];

        // Re-render: clear and re-render all (indices shift after prepend)
        this._renderAll();

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
    async appendItems(items: T[]): Promise<void> {
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

        console.log(
            `[VirtualScroll] appendItems: ` +
            `items=${items.length}, scrollHeight: ${scrollHeightBefore} → ${scrollHeightAfter}, ` +
            `scrollTop: ${scrollTopBefore} → ${scrollTopAfter}, ` +
            `diff=${scrollTopAfter - scrollTopBefore}`
        );

        this._onSizeChange?.();
    }

    clear() {
        this._items = [];
        this._elementMap.clear();
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

        // Debounced viewport slicing (like Telegram's sliceViewportDebounced)
        // Reset timer on each scroll event, execute after user stops scrolling
        if (this._sliceDebounceTimer) {
            clearTimeout(this._sliceDebounceTimer);
        }
        this._sliceDebounceTimer = window.setTimeout(() => {
            this._sliceViewport();
        }, this._sliceDebounceDelay);

        if (!this._onLoadMore) return;

        const boundary = this._getWindowBoundary();

        // Load more top: near top AND not fully loaded in that direction
        // Telegram uses onScrollOffset = 300px for early triggering
        if (distanceFromTop < this._preloadThreshold && !this._loadedTop && !this._isLoading.top) {
            console.log(`[VirtualScroll] Triggering loadMore(top), distanceFromTop=${distanceFromTop}, threshold=${this._preloadThreshold}, boundary.firstId=${boundary.firstId}`);
            this._isLoading.top = true;
            this._onLoadMore('top', boundary)
                .then(items => {
                    console.log(`[VirtualScroll] loadMore(top) returned ${items.length} items`);
                    if (items.length > 0) {
                        return this.prependItems(items);
                    }
                    // No more messages - mark as fully loaded
                    this._loadedTop = true;
                })
                .finally(() => {
                    this._isLoading.top = false;
                });
        }

        // Load more bottom: near bottom AND not fully loaded in that direction
        if (distanceFromBottom < this._preloadThreshold && !this._loadedBottom && !this._isLoading.bottom) {
            console.log(`[VirtualScroll] Triggering loadMore(bottom), distanceFromBottom=${distanceFromBottom}, threshold=${this._preloadThreshold}, boundary.lastId=${boundary.lastId}`);
            this._isLoading.bottom = true;
            this._onLoadMore('bottom', boundary)
                .then(items => {
                    console.log(`[VirtualScroll] loadMore(bottom) returned ${items.length} items`);
                    if (items.length > 0) {
                        return this.appendItems(items);
                    } else {
                        // No more messages - mark as fully loaded
                        this._loadedBottom = true;
                    }
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
     */
    private _sliceViewport() {
        if (this._elementMap.size === 0) return;

        const slice = this._getViewportSlice();
        const {invisibleTop, invisibleBottom} = slice;

        if (invisibleTop.length === 0 && invisibleBottom.length === 0) return;

        console.log(
            `[VirtualScroll] Slicing viewport: invisibleTop=${invisibleTop.length}, ` +
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

        // Restore scroll position
        scrollSaver.restore();

        // Notify size change
        this._onSizeChange?.();

        console.log(
            `[VirtualScroll] After slice: items=${this._items.length}, ` +
            `loadedTop=${this._loadedTop}, loadedBottom=${this._loadedBottom}`
        );
    }

    // ── Rendering ──

    private _renderAll() {
        this._innerContainer.innerHTML = '';
        this._elementMap.clear();

        const fragment = document.createDocumentFragment();
        this._items.forEach((item, index) => {
            const el = this._renderItem(item, index);
            el.dataset.messageIndex = String(index);
            this._elementMap.set(index, el);
            fragment.appendChild(el);
        });

        this._innerContainer.appendChild(fragment);
    }

    private _renderNewItems(items: T[], startIndex: number) {
        const fragment = document.createDocumentFragment();
        items.forEach((item, i) => {
            const index = startIndex + i;
            const el = this._renderItem(item, index);
            el.dataset.messageIndex = String(index);
            this._elementMap.set(index, el);
            fragment.appendChild(el);
        });
        this._innerContainer.appendChild(fragment);
    }
}
