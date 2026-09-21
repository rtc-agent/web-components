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
import {MessageSkeletonGenerator} from './message-skeleton.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('VirtualScroll');

/**
 * Stateful component interface - components can implement this to preserve state
 * across virtualization (destroy/restore cycles).
 */
export interface StatefulComponent {
    getState(): Record<string, unknown>;
    setState(state: Record<string, unknown>): void;
}

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

    /**
     * Create a skeleton placeholder element for an item being virtualized.
     * If not provided, uses MessageSkeletonGenerator to create default skeletons.
     */
    createPlaceholder?: (item: T, height: number) => HTMLElement;

    /**
     * Extract component state before destroying an element (for state preservation).
     * Called during viewport slicing before replacing with skeleton.
     */
    extractComponentState?: (item: T, element: HTMLElement) => Record<string, unknown> | null;

    /**
     * Inject component state after restoring an element from skeleton.
     * Called synchronously before first render to avoid flicker.
     */
    injectComponentState?: (item: T, element: HTMLElement, state: Record<string, unknown>) => void;

    /**
     * Check if an item is stable (safe to virtualize).
     * Unstable items (e.g., streaming messages) are not replaced with skeletons.
     */
    isItemStable?: (item: T) => boolean;
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

    /** User interaction state for distinguishing user vs programmatic scrolls */
    private _isUserInteracting = false;
    private _interactionCleanup: (() => void) | null = null;

    // ── Phase 1: Skeleton Placeholder Properties ──

    /** New callback options for skeleton placeholder support */
    private _createPlaceholder?: (item: T, height: number) => HTMLElement;
    private _extractComponentState?: (item: T, element: HTMLElement) => Record<string, unknown> | null;
    private _injectComponentState?: (
        item: T,
        element: HTMLElement,
        state: Record<string, unknown>
    ) => void;
    private _isItemStable?: (item: T) => boolean;

    /** Placeholder item IDs (ID-based tracking, immune to index remapping) */
    private _placeholderItemIds: Set<string> = new Set();

    /** Height cache: itemId → last known height */
    private _heightCache: Map<string, number> = new Map();

    /** Component state cache: itemId → state object */
    private _componentStateCache: Map<string, Record<string, unknown>> = new Map();

    /** Placeholder position index: sorted array (by Y coordinate) for O(log n) lookup */
    private _placeholderPositions: Array<{itemId: string; y: number}> = [];

    /** Reverse index: itemId → array index for O(1) lookup */
    private _placeholderIndexMap: Map<string, number> = new Map();

    /** Element height tracker using ResizeObserver */
    private _itemResizeObserver?: ResizeObserver;

    /** Capacity limit for component state cache */
    private readonly MAX_STATE_CACHE = 200;

    /** S5: Capacity limit for height cache (larger since entries are smaller) */
    private readonly MAX_HEIGHT_CACHE = 500;

    // ── Phase 2: Skeleton Restoration State ──

    /** Pending restoration queue */
    private _pendingRestorations: Array<{itemId: string; index: number; y: number}> = [];

    /** Whether a batch restoration is already scheduled */
    private _restorationScheduled: boolean = false;

    /** IDs currently in pending restoration queue (dedup) */
    private _pendingRestorationIds: Set<string> = new Set();

    /** Last scroll top for direction detection */
    private _lastScrollTop: number = 0;

    /** Maximum restorations per frame */
    private readonly MAX_RESTORATIONS_PER_FRAME = 10;

    // ── Event-Driven Slicing ──

    /** Minimum interval between _sliceViewport calls (ms) */
    private readonly MIN_SLICE_INTERVAL = 2000;

    /** Timestamp of last _sliceViewport call (prevents double invocation) */
    private _lastSliceTime: number = 0;

    // ── Visibility API (Phase 4) ──

    /** Explicit visibility state - controlled by setVisibility() */
    private _isVisible: boolean = true;

    /** Browser page visibility state - controlled by visibilitychange event */
    private _pageVisible: boolean = true;

    // ── Stream Awareness (Phase 4) ──

    /** Active streaming item IDs - prevents skeletonization during streaming */
    private _activeStreams: Set<string> = new Set();

    // ── Container Resize Observer (Phase 5, I4) ──

    /** ResizeObserver for scroll container - rebuilds placeholder positions on resize */
    private _containerResizeObserver?: ResizeObserver;

    /** Event listener for visibilitychange - pauses slicing when tab is hidden */
    private _visibilityChangeHandler?: () => void;

    // ── Hot/Cold Data Separation (Phase 5, I2) ──

    /**
     * Cold storage: historical messages that have been settled out of the hot window.
     * Items are moved here when _items exceeds MAX_HOT_ITEMS.
     * The repository serves as the authoritative external cache; _coldItems is a
     * secondary buffer for quick access without repository round-trips.
     */
    private _coldItems: T[] = [];

    /** Maximum items in hot storage before settling to cold */
    private readonly MAX_HOT_ITEMS = 500;

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
        this._sliceDebounceDelay = 3000; // Fixed 3s scroll-debounce delay

        // Phase 1: Initialize skeleton placeholder callbacks
        this._createPlaceholder = options.createPlaceholder;
        this._extractComponentState = options.extractComponentState;
        this._injectComponentState = options.injectComponentState;
        this._isItemStable = options.isItemStable;

        this._scrollHandler = () => this._onScroll();
        this._scrollContainer.addEventListener('scroll', this._scrollHandler, {passive: true});

        // Phase 1: Setup element height tracker using ResizeObserver
        // S2: Guard against tracking skeleton heights (only track real elements)
        this._itemResizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const el = entry.target as HTMLElement;
                const itemId = el.dataset.itemId;
                // Skip skeleton placeholders - they have fixed height
                if (itemId && el.dataset.isSkeleton !== 'true') {
                    this._setHeightCache(itemId, entry.contentRect.height);
                }
            }
        });

        // Event-driven slicing: no periodic timer.
        // Slicing is triggered by scroll events (3s debounce) and container resize.
        // This matches Telegram's architecture and avoids background-tab bugs.

        // Page Visibility API: pause slicing when browser tab is hidden.
        // This is a safety net - scroll events won't fire when hidden, but container
        // resize may fire when the tab returns to foreground.
        this._visibilityChangeHandler = () => this._onVisibilityChange();
        document.addEventListener('visibilitychange', this._visibilityChangeHandler);

        // Setup user interaction tracking to distinguish user vs programmatic scrolls
        this._setupInteractionTracking();

        // Phase 5 (I4): Setup container resize observer
        // Rebuilds placeholder positions when the scroll container resizes (e.g., window resize)
        this._containerResizeObserver = new ResizeObserver(() => {
            this._onContainerResize();
        });
        this._containerResizeObserver.observe(this._scrollContainer);
    }

    /**
     * Declarative API: Set items and automatically apply optimal DOM operations.
     *
     * This is the main entry point for consumers. It internally diffs old vs new items
     * and applies the minimal DOM operations:
     * - Empty → items: Full render with scroll to bottom (initial load)
     * - Items → empty: Clear all
     * - Items changed: Detect prepend/append/update/middle-insert and apply optimal operations
     *
     * Scroll compensation is handled automatically via ScrollSaver.
     */
    setItems(newItems: T[]) {
        const oldItems = this._items;

        // Case 1: Empty → items (initial load)
        if (oldItems.length === 0 && newItems.length > 0) {
            this._items = [...newItems];
            this._loadedTop = false;
            this._loadedBottom = true;
            this._renderAll();
            // Phase 5 (I2): Settle excess items to cold storage
            this._settleData();
            return;
        }

        // Case 2: Items → empty
        if (oldItems.length > 0 && newItems.length === 0) {
            this.clear();
            return;
        }

        // Case 3: Both empty - nothing to do
        if (oldItems.length === 0 && newItems.length === 0) {
            return;
        }

        // Case 4: Compute diff and apply optimal operations
        const diff = this._computeDiff(oldItems, newItems);

        // Optimization: if no changes at all, return early without updating _items
        // This prevents unnecessary array reference changes during tab switching
        if (diff.prepended.length === 0 &&
            diff.appended.length === 0 &&
            diff.middleInserted.length === 0 &&
            !diff.hasUpdates &&
            !diff.hasRemovals) {
            return;
        }

        log.debug(
            `setItems diff: prepended=${diff.prepended.length}, ` +
            `appended=${diff.appended.length}, middleInserted=${diff.middleInserted.length}, ` +
            `updated=${diff.hasUpdates}`
        );

        // Apply operations
        if (diff.middleInserted.length > 0 || diff.hasRemovals) {
            // Middle insert or removal: full re-render with scroll compensation
            // This is rare (e.g., fork with historical messages), so acceptable
            const scrollSaver = new ScrollSaver(this._scrollContainer, this._query, true);
            scrollSaver.save();
            this._items = [...newItems];
            this._renderAll();
            scrollSaver.restore();
        } else {
            // Incremental updates: prepend → append → update
            if (diff.prepended.length > 0) {
                this._prependToDom(diff.prepended);
            }
            if (diff.appended.length > 0) {
                this._appendToDom(diff.appended);
            }
            if (diff.hasUpdates) {
                this._updateInPlace(newItems);
            }
            // Always sync _items to match newItems
            this._items = [...newItems];
        }

        this._rebuildIdToIndex();

        // Phase 5 (I2): Settle excess items to cold storage
        this._settleData();
    }

    /**
     * Compute diff between old and new items.
     * Detects: prepended (before old first), appended (after old last),
     * middleInserted (between old first and last), removals, and content updates.
     */
    private _computeDiff(oldItems: T[], newItems: T[]): {
        prepended: T[];
        appended: T[];
        middleInserted: T[];
        hasUpdates: boolean;
        hasRemovals: boolean;
    } {
        const oldIdSet = new Set(oldItems.map(item => this._getItemId(item)));
        const newIdSet = new Set(newItems.map(item => this._getItemId(item)));

        // Find prepended items (new items before old first)
        const oldFirstId = oldItems.length > 0 ? this._getItemId(oldItems[0]) : undefined;
        const oldFirstNewIdx = oldFirstId
            ? newItems.findIndex(item => this._getItemId(item) === oldFirstId)
            : -1;
        const prepended = oldFirstNewIdx > 0 ? newItems.slice(0, oldFirstNewIdx) : [];

        // Find appended items (new items after old last)
        const oldLastId = oldItems.length > 0 ? this._getItemId(oldItems[oldItems.length - 1]) : undefined;
        const oldLastNewIdx = oldLastId
            ? newItems.findIndex(item => this._getItemId(item) === oldLastId)
            : -1;
        const appended =
            oldLastNewIdx >= 0 && oldLastNewIdx < newItems.length - 1
                ? newItems.slice(oldLastNewIdx + 1)
                : [];

        // Find middle inserted items (new items between old first and last that are not in old)
        const middleInserted: T[] = [];
        if (oldFirstNewIdx >= 0 && oldLastNewIdx >= 0) {
            for (let i = oldFirstNewIdx + 1; i < oldLastNewIdx; i++) {
                const item = newItems[i];
                if (!oldIdSet.has(this._getItemId(item))) {
                    middleInserted.push(item);
                }
            }
        }

        // Check for removals (items in old but not in new)
        const hasRemovals = oldItems.some(item => !newIdSet.has(this._getItemId(item)));

        // Check for content updates (items in both but content changed)
        const oldItemsById = new Map<string, T>();
        oldItems.forEach(item => {
            oldItemsById.set(this._getItemId(item), item);
        });

        let hasUpdates = false;
        for (const newItem of newItems) {
            const oldItem = oldItemsById.get(this._getItemId(newItem));
            if (oldItem && !this._itemsEqual(oldItem, newItem)) {
                hasUpdates = true;
                break;
            }
        }

        return {prepended, appended, middleInserted, hasUpdates, hasRemovals};
    }

    /**
     * Prepend items to DOM without updating _items.
     * Used internally by setItems.
     */
    private _prependToDom(items: T[]): void {
        if (items.length === 0) return;

        // Save scroll state
        const scrollSaver = new ScrollSaver(this._scrollContainer, this._query, true);
        scrollSaver.save();

        // Re-index existing elements (indices shift after prepend)
        const existingElements = Array.from(this._innerContainer.children) as HTMLElement[];
        for (const el of existingElements) {
            const oldIndex = parseInt(el.dataset.messageIndex || '-1', 10);
            if (oldIndex >= 0) {
                el.dataset.messageIndex = String(oldIndex + items.length);
            }
        }

        // Insert new elements at the beginning
        const fragment = document.createDocumentFragment();
        items.forEach((item, index) => {
            const el = this._renderItem(item, index);
            const itemId = this._getItemId(item);
            el.dataset.messageIndex = String(index);
            el.dataset.itemId = itemId;
            el.dataset.isSkeleton = 'false';
            // Start tracking height
            this._itemResizeObserver?.observe(el);
            fragment.appendChild(el);
        });

        if (this._innerContainer.firstChild) {
            this._innerContainer.insertBefore(fragment, this._innerContainer.firstChild);
        } else {
            this._innerContainer.appendChild(fragment);
        }

        // Re-index existing elements in _elementMap
        const newElementMap = new Map<number, HTMLElement>();
        this._elementMap.forEach((el, oldIndex) => {
            newElementMap.set(oldIndex + items.length, el);
        });
        this._elementMap = newElementMap;

        // Add new elements to _elementMap
        items.forEach((_item, index) => {
            const el = this._innerContainer.children[index] as HTMLElement;
            this._elementMap.set(index, el);
        });

        // Restore scroll position
        scrollSaver.restore();

        this._onSizeChange?.();
    }

    /**
     * Append items to DOM without updating _items.
     * Used internally by setItems.
     */
    private _appendToDom(items: T[]): void {
        if (items.length === 0) return;

        // Save scroll state
        const scrollSaver = new ScrollSaver(this._scrollContainer, this._query, false);
        scrollSaver.save();

        const startIndex = this._items.length;

        // Render new items
        this._renderNewItems(items, startIndex);

        // Restore scroll position
        scrollSaver.restore();

        this._onSizeChange?.();
    }

    /**
     * Shared logic for updating items in place.
     * Used by both updateItems() and _updateInPlace().
     */
    private _applyItemUpdates(newItems: T[]): void {
        // Build a map of old items by ID
        const oldItemsById = new Map<string, {index: number; item: T}>();
        this._items.forEach((item, index) => {
            oldItemsById.set(this._getItemId(item), {index, item});
        });

        // Update _items
        this._items = [...newItems];

        // Find and re-render changed items
        newItems.forEach((newItem, newIndex) => {
            const itemId = this._getItemId(newItem);
            const oldEntry = oldItemsById.get(itemId);

            if (!oldEntry) {
                // New item - should have been handled by prepend/append
                return;
            }

            // Deep compare: if content is identical, skip re-render
            // This prevents Markdown DOM destruction when tab switching returns
            // new array references with identical content
            if (this._itemsEqual(oldEntry.item, newItem)) {
                return;
            }

            // Phase 2: If item is a placeholder, invalidate cached state and skip DOM update
            // The skeleton can't be updated in-place; restoration will use latest data
            if (this._placeholderItemIds.has(itemId)) {
                this._componentStateCache.delete(itemId);
                log.debug(`Invalidated cached state for ${itemId} (content changed while placeholder)`);
                return;
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
                newElement.dataset.itemId = itemId;
                newElement.dataset.isSkeleton = 'false';
                this._elementMap.set(newIndex, newElement);
                // Stop tracking old element, start tracking new
                this._itemResizeObserver?.unobserve(element);
                this._itemResizeObserver?.observe(newElement);
                element.replaceWith(newElement);
            }

            this._onSizeChange?.();
        });
    }

    /**
     * Update existing items in place.
     * Only re-renders items that have changed and are currently in the DOM.
     * Called internally by setItems() during incremental updates.
     */
    private _updateInPlace(newItems: T[]): void {
        this._applyItemUpdates(newItems);
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
        this._applyItemUpdates(items);
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
            const itemId = this._getItemId(item);
            el.dataset.messageIndex = String(index);
            el.dataset.itemId = itemId;
            el.dataset.isSkeleton = 'false';
            this._elementMap.set(index, el);
            // Start tracking height
            this._itemResizeObserver?.observe(el);
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

        // I2: Update placeholder Y coordinates (all existing elements shift down)
        // Calculate total height of prepended elements
        let prependHeight = 0;
        for (let i = 0; i < items.length; i++) {
            const el = this._innerContainer.children[i] as HTMLElement;
            if (el) {
                prependHeight += el.getBoundingClientRect().height;
            }
        }
        // Add prepend height to all placeholder positions
        if (prependHeight > 0 && this._placeholderPositions.length > 0) {
            for (const entry of this._placeholderPositions) {
                entry.y += prependHeight;
            }
            log.debug(`Updated ${this._placeholderPositions.length} placeholder positions by +${prependHeight}px`);
        }

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

        // Phase 5 (I2): Settle excess items to cold storage
        this._settleData();

        this._onSizeChange?.();
    }

    /**
     * Update a single item by ID.
     * O(1) lookup using _idToIndex map.
     *
     * Phase 5: Correctly handles placeholder state:
     * - Always updates data model
     * - If placeholder and content changed, invalidates cached state
     * - If not placeholder, updates DOM
     *
     * @param itemId - The ID of the item to update
     * @param newItem - The new item data
     * @returns true if the item was found and updated, false otherwise
     */
    updateItemById(itemId: string, newItem: T): boolean {
        const index = this._idToIndex.get(itemId);
        if (index === undefined) return false;

        // Check if content actually changed
        const oldItem = this._items[index];
        const contentChanged = !this._itemsEqual(oldItem, newItem);

        // 1. Always update data in _items
        this._items[index] = newItem;

        // 2. If placeholder and content changed, invalidate cached state
        if (this._placeholderItemIds.has(itemId) && contentChanged) {
            this._componentStateCache.delete(itemId);
            log.debug(`Invalidated cached state for ${itemId} (content changed while placeholder)`);
            return true; // Data updated, DOM will be updated on restoration
        }

        // 3. If component exists (not a placeholder), update DOM
        const element = this._elementMap.get(index);
        if (!element || !element.isConnected) {
            return true; // Data updated but not in DOM
        }

        // Skip DOM update if content unchanged
        if (!contentChanged) {
            return true;
        }

        // In-place update: preserve DOM state (e.g., rendered Markdown)
        if (this._updateItemElement) {
            this._updateItemElement(element, newItem, index);
        } else {
            // Fallback: destroy and rebuild
            const newElement = this._renderItem(newItem, index);
            newElement.dataset.messageIndex = String(index);
            newElement.dataset.itemId = itemId;
            newElement.dataset.isSkeleton = 'false';
            this._elementMap.set(index, newElement);
            // Stop tracking old element, start tracking new
            this._itemResizeObserver?.unobserve(element);
            this._itemResizeObserver?.observe(newElement);
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

        // Phase 1: Cleanup placeholder tracking structures
        this._placeholderItemIds.clear();
        this._placeholderPositions = [];
        this._placeholderIndexMap.clear();
        this._heightCache.clear();
        this._componentStateCache.clear();

        // Phase 2: Cleanup restoration state
        this._pendingRestorations = [];
        this._pendingRestorationIds.clear();

        // Phase 4: Cleanup stream tracking
        this._activeStreams.clear();

        // Phase 5 (I2): Cleanup cold storage
        this._coldItems = [];
    }

    /**
     * Explicit visibility API - called by parent component.
     * Replaces unreliable getBoundingClientRect() detection for visibility: hidden.
     *
     * When hidden, _sliceViewport is skipped to prevent incorrect skeletonization
     * of elements in a hidden container (e.g., inactive tab).
     *
     * @param visible - Whether the container is currently visible
     */
    setVisibility(visible: boolean): void {
        const changed = this._isVisible !== visible;
        this._isVisible = visible;
        if (changed) {
            log.debug(`Visibility changed: ${visible}`);
            if (visible) {
                // When becoming visible, trigger a slice check
                this._sliceViewport();
            }
        }
    }

    /**
     * Get current visibility state.
     */
    isVisible(): boolean {
        return this._isVisible;
    }

    /**
     * Mark an item as actively streaming.
     * Prevents skeletonization during streaming output.
     * Call this when WebSocket stream starts for a message.
     */
    markStreamStart(itemId: string): void {
        this._activeStreams.add(itemId);
        log.debug(`Stream started for ${itemId}`);
    }

    /**
     * Mark an item's streaming as ended.
     * Allows skeletonization after streaming completes.
     * Call this when WebSocket stream ends for a message.
     */
    markStreamEnd(itemId: string): void {
        this._activeStreams.delete(itemId);
        log.debug(`Stream ended for ${itemId}`);
        // Trigger a slice check so the item can be skeletonized if off-screen
        this._sliceViewport();
    }

    /**
     * Check if an item is currently streaming.
     */
    isStreaming(itemId: string): boolean {
        return this._activeStreams.has(itemId);
    }

    /**
     * Check if an item is currently a skeleton placeholder.
     * Used by scrollToMessage to determine if sync restoration is needed.
     */
    isPlaceholder(itemId: string): boolean {
        return this._placeholderItemIds.has(itemId);
    }

    /**
     * Synchronously restore a skeleton placeholder to a real element.
     * Used by scrollToMessage to ensure the target is visible before scrolling.
     *
     * Unlike batch restoration (which uses requestAnimationFrame), this runs
     * synchronously so the caller can immediately scroll to the restored element.
     */
    syncRestorePlaceholder(itemId: string): void {
        if (!this._placeholderItemIds.has(itemId)) return;

        const index = this._findIndexByItemId(itemId);
        if (index === -1) return;

        const skeleton = this._elementMap.get(index);
        if (!skeleton) return;

        const skeletonHeight = skeleton.getBoundingClientRect().height;
        this._restoreSkeleton(itemId, index, skeletonHeight);
    }

    scrollToBottom() {
        this._scrollContainer.scrollTop = this._scrollContainer.scrollHeight;
    }

    /**
     * Synchronously restore ALL skeleton placeholders.
     *
     * This stabilizes scrollHeight before programmatic scrolls (e.g., scrollToBottom),
     * preventing the "scroll target drift" bug where smooth scroll targets a stale
     * scrollHeight while skeletons are being restored mid-animation.
     *
     * Uses cumulative scroll adjustment to prevent compound drift when multiple
     * skeletons are restored: captures viewport position once before any DOM mutations,
     * then adjusts scrollTop by the total height difference of all elements restored
     * above the viewport in a single operation.
     *
     * Call this BEFORE any scrollTo/scrollIntoView to ensure the scroll target is real.
     */
    restoreAll(): void {
        if (this._placeholderItemIds.size === 0) return;

        log.debug(`restoreAll: restoring ${this._placeholderItemIds.size} skeletons`);

        // Capture viewport position BEFORE any DOM mutations
        const viewportTop = this._scrollContainer.scrollTop;
        let totalHeightDiffAbove = 0;

        // Restore top-to-bottom for deterministic processing
        const entries = [...this._placeholderPositions].sort((a, b) => a.y - b.y);

        for (const entry of entries) {
            const skeleton = this._findElementByItemId(entry.itemId);
            if (!skeleton) continue;

            const oldHeight = skeleton.getBoundingClientRect().height;

            // Restore without individual scroll adjustment
            const result = this._restoreSkeletonInternal(entry.itemId, oldHeight);
            if (!result) continue;

            // Measure actual height and accumulate diff for elements above viewport
            const newHeight = result.element.getBoundingClientRect().height;
            const heightDiff = newHeight - oldHeight;

            // Use the captured viewportTop (not current scrollTop) for judgment
            if (Math.abs(heightDiff) > 5 && entry.y < viewportTop) {
                totalHeightDiffAbove += heightDiff;
            }
        }

        // Single scroll adjustment for all restorations above viewport
        if (Math.abs(totalHeightDiffAbove) > 5) {
            this._scrollContainer.scrollTop += totalHeightDiffAbove;
            log.debug(`Adjusted scroll position by ${totalHeightDiffAbove}px after batch restore`);
        }
    }

    /**
     * Setup user interaction tracking to distinguish user vs programmatic scrolls.
     * Tracks pointer (mouse/touch) and keyboard interactions on the scroll container.
     * This allows _onScroll to skip viewport slicing for programmatic scrolls (auto-scroll).
     */
    private _setupInteractionTracking() {
        const container = this._scrollContainer;

        const onPointerDown = () => {
            this._isUserInteracting = true;
        };

        const onPointerUp = () => {
            this._isUserInteracting = false;
        };

        const onKeyDown = (e: KeyboardEvent) => {
            // Only track scroll-related keys
            const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
            if (scrollKeys.includes(e.key)) {
                this._isUserInteracting = true;
            }
        };

        const onKeyUp = () => {
            this._isUserInteracting = false;
        };

        container.addEventListener('pointerdown', onPointerDown, {passive: true});
        container.addEventListener('pointerup', onPointerUp, {passive: true});
        container.addEventListener('pointercancel', onPointerUp, {passive: true});
        container.addEventListener('keydown', onKeyDown, {passive: true});
        container.addEventListener('keyup', onKeyUp, {passive: true});

        // Store cleanup function
        this._interactionCleanup = () => {
            container.removeEventListener('pointerdown', onPointerDown);
            container.removeEventListener('pointerup', onPointerUp);
            container.removeEventListener('pointercancel', onPointerUp);
            container.removeEventListener('keydown', onKeyDown);
            container.removeEventListener('keyup', onKeyUp);
        };
    }

    dispose() {
        if (this._scrollHandler) {
            this._scrollContainer.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        if (this._sliceDebounceTimer) {
            clearTimeout(this._sliceDebounceTimer);
            this._sliceDebounceTimer = null;
        }
        // Cleanup page visibility listener
        if (this._visibilityChangeHandler) {
            document.removeEventListener('visibilitychange', this._visibilityChangeHandler);
            this._visibilityChangeHandler = undefined;
        }
        if (this._interactionCleanup) {
            this._interactionCleanup();
            this._interactionCleanup = null;
        }
        // Phase 1: Cleanup ResizeObserver
        if (this._itemResizeObserver) {
            this._itemResizeObserver.disconnect();
            this._itemResizeObserver = undefined;
        }
        // Phase 5 (I4): Cleanup container resize observer
        if (this._containerResizeObserver) {
            this._containerResizeObserver.disconnect();
            this._containerResizeObserver = undefined;
        }
        // Release internal references to allow GC of items and DOM elements.
        // Without this, the scroll container's parent may hold the virtual scroll
        // object alive long after disconnection, keeping large item arrays and
        // element maps in memory.
        this._items = [];
        this._elementMap.clear();
        this._idToIndex.clear();

        // Phase 1: Cleanup placeholder tracking structures
        this._placeholderItemIds.clear();
        this._placeholderPositions = [];
        this._placeholderIndexMap.clear();
        this._heightCache.clear();
        this._componentStateCache.clear();

        // Phase 2: Cleanup restoration state
        this._pendingRestorations = [];
        this._pendingRestorationIds.clear();

        // Phase 4: Cleanup stream tracking
        this._activeStreams.clear();

        // Phase 5 (I2): Cleanup cold storage
        this._coldItems = [];
    }

    getStats() {
        return {
            totalItems: this._items.length,
            renderedItems: this._elementMap.size,
            placeholderCount: this._placeholderItemIds.size,
            loadedTop: this._loadedTop,
            loadedBottom: this._loadedBottom,
            firstId: this._items.length > 0 ? this._getItemId(this._items[0]) : undefined,
            lastId: this._items.length > 0 ? this._getItemId(this._items[this._items.length - 1]) : undefined,
            // Phase 5 (S2): Extended metrics for monitoring and debugging
            heightCacheSize: this._heightCache.size,
            stateCacheSize: this._componentStateCache.size,
            activeStreamCount: this._activeStreams.size,
            pendingRestorationCount: this._pendingRestorations.length,
            isVisible: this._isVisible,
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

        // NOTE: avoid per-event debug logging here — scroll fires at 60fps+ and
        // would fill the 500-entry logBuffer in seconds, drowning other log output.
        // Only log when a meaningful action is triggered (loadMore, slice).

        // Debounced viewport slicing (like Telegram's sliceViewportDebounced)
        // Only trigger on user-initiated scrolls, not programmatic scrolls (auto-scroll).
        // This prevents flickering during high-frequency message updates.
        if (this._isUserInteracting) {
            if (this._sliceDebounceTimer) {
                clearTimeout(this._sliceDebounceTimer);
            }
            this._sliceDebounceTimer = window.setTimeout(() => {
                this._sliceViewport();
            }, this._sliceDebounceDelay);
        }

        if (!this._onLoadMore) return;

        const boundary = this._getWindowBoundary();

        // Load more top: near top AND not fully loaded in that direction
        // Telegram uses onScrollOffset = 300px for early triggering
        if (distanceFromTop < this._preloadThreshold && !this._loadedTop && !this._isLoading.top) {
            log.debug(`loadMore(top) triggered, distance=${distanceFromTop}, threshold=${this._preloadThreshold}`);
            this._isLoading.top = true;
            this._onLoadMore('top', boundary)
                .then(items => {
                    if (items.length > 0) {
                        log.debug(`loadMore(top) returned ${items.length} items`);
                        return this.prependItems(items);
                    }
                    // No more messages returned directly - but DO NOT auto-mark as fully loaded.
                    // Consumer controls _loadedTop via setFullyLoaded() based on repository's hasMore.
                    // (loadMore may be async; actual items arrive via subscription updates.)
                })
                .catch(err => {
                    // Guard against unhandled rejection from onLoadMore callback or DOM operations
                    // in prependItems (e.g. when component is disconnected mid-load).
                    log.error('loadMore(top) failed:', err);
                })
                .finally(() => {
                    this._isLoading.top = false;
                });
        }

        // Load more bottom: near bottom AND not fully loaded in that direction
        if (distanceFromBottom < this._preloadThreshold && !this._loadedBottom && !this._isLoading.bottom) {
            log.debug(`loadMore(bottom) triggered, distance=${distanceFromBottom}, threshold=${this._preloadThreshold}`);
            this._isLoading.bottom = true;
            this._onLoadMore('bottom', boundary)
                .then(items => {
                    if (items.length > 0) {
                        log.debug(`loadMore(bottom) returned ${items.length} items`);
                        return this.appendItems(items);
                    }
                    // No more messages returned directly - but DO NOT auto-mark as fully loaded.
                    // Consumer controls _loadedBottom via setFullyLoaded() based on repository's hasMore.
                })
                .catch(err => {
                    // Guard against unhandled rejection from onLoadMore callback or DOM operations
                    // in appendItems (e.g. when component is disconnected mid-load).
                    log.error('loadMore(bottom) failed:', err);
                })
                .finally(() => {
                    this._isLoading.bottom = false;
                });
        }

        // Phase 2: Restore skeletons in preload range
        this._restoreSkeletonsInRange(scrollTop, clientHeight);
    }

    /**
     * Phase 2: Find and schedule restoration for skeletons in the preload range.
     * Uses fixed 2× viewport preload distance for simplicity.
     *
     * IMPORTANT: For tall skeletons, we check if ANY part of the skeleton is in range,
     * not just the top position. This ensures tall skeletons (e.g., 7000px) are restored
     * when the user scrolls to their visible portion.
     */
    private _restoreSkeletonsInRange(scrollTop: number, clientHeight: number): void {
        if (this._placeholderItemIds.size === 0) return;

        // Fixed preload distance: 2× viewport height
        const PRELOAD_DISTANCE = clientHeight * 2;

        // Restore range: absolute coordinates (consistent with _placeholderPositions storage)
        const restoreTop = scrollTop - PRELOAD_DISTANCE;
        const restoreBottom = scrollTop + clientHeight + PRELOAD_DISTANCE;

        log.debug(`_restoreSkeletonsInRange: scrollTop=${scrollTop}, clientHeight=${clientHeight}, placeholders=${this._placeholderItemIds.size}, range=[${restoreTop}, ${restoreBottom}]`);

        // Find placeholders where ANY part is in range (not just the top position)
        // This is critical for tall skeletons where the top may be far from the visible portion
        const placeholdersInRange = this._placeholderPositions.filter(entry => {
            const skeleton = this._findElementByItemId(entry.itemId);
            if (!skeleton) return false;

            const skeletonHeight = skeleton.getBoundingClientRect().height;
            const skeletonBottom = entry.y + skeletonHeight;

            // Check if any part of the skeleton is in the restore range
            return (entry.y >= restoreTop && entry.y <= restoreBottom) || // top in range
                   (skeletonBottom >= restoreTop && skeletonBottom <= restoreBottom) || // bottom in range
                   (entry.y < restoreTop && skeletonBottom > restoreBottom); // skeleton fully contains range
        });

        if (placeholdersInRange.length === 0) {
            log.debug(`_restoreSkeletonsInRange: no placeholders in range`);
            return;
        }

        log.debug(`_restoreSkeletonsInRange: found ${placeholdersInRange.length} placeholders in range`);

        // Sort by scroll direction for natural restoration order
        const direction = this._getScrollDirection();
        if (direction === 'down') {
            placeholdersInRange.sort((a, b) => a.y - b.y);
        } else {
            placeholdersInRange.sort((a, b) => b.y - a.y);
        }

        // Add to pending restoration queue (with dedup)
        for (const entry of placeholdersInRange) {
            if (!this._pendingRestorationIds.has(entry.itemId)) {
                const index = this._findIndexByItemId(entry.itemId);
                if (index >= 0) {
                    this._pendingRestorations.push({
                        itemId: entry.itemId,
                        index,
                        y: entry.y,
                    });
                    this._pendingRestorationIds.add(entry.itemId);
                }
            }
        }

        // Schedule batch restoration
        this._scheduleBatchRestoration();
    }

    /**
     * Detect scroll direction (up/down) based on last scroll position.
     */
    private _getScrollDirection(): 'down' | 'up' {
        const currentTop = this._scrollContainer.scrollTop;
        const direction = currentTop >= this._lastScrollTop ? 'down' : 'up';
        this._lastScrollTop = currentTop;
        return direction;
    }

    /**
     * Schedule batch restoration with frame limit.
     * Uses requestAnimationFrame for smooth rendering.
     *
     * Uses cumulative scroll adjustment: captures viewport position once before
     * the batch, then adjusts scrollTop by the total height difference of all
     * elements restored above the viewport in a single operation.
     */
    private _scheduleBatchRestoration(): void {
        if (this._restorationScheduled || this._pendingRestorations.length === 0) return;

        this._restorationScheduled = true;

        requestAnimationFrame(() => {
            this._restorationScheduled = false;

            // Phase 4: Skip restoration if container is not visible (e.g., tab switched away)
            if (!this._isVisible) {
                log.debug('Skipping batch restoration: container is not visible');
                return;
            }

            // Process up to MAX_RESTORATIONS_PER_FRAME items
            const batch = this._pendingRestorations.splice(0, this.MAX_RESTORATIONS_PER_FRAME);

            // Capture viewport position BEFORE any DOM mutations
            const viewportTop = this._scrollContainer.scrollTop;
            let totalHeightDiffAbove = 0;

            // Batch read heights (avoid layout thrashing)
            const heights = new Map<string, number>();
            for (const {itemId} of batch) {
                const skeleton = this._findElementByItemId(itemId);
                if (skeleton) {
                    heights.set(itemId, skeleton.getBoundingClientRect().height);
                }
            }

            // Batch restore (write to DOM) with cumulative scroll adjustment
            for (const {itemId, y} of batch) {
                const skeletonHeight = heights.get(itemId) ?? 0;
                const result = this._restoreSkeletonInternal(itemId, skeletonHeight);
                if (!result) continue;

                // Measure actual height and accumulate diff for elements above viewport
                const newHeight = result.element.getBoundingClientRect().height;
                const heightDiff = newHeight - skeletonHeight;

                // Use the captured viewportTop (not current scrollTop) for judgment
                if (Math.abs(heightDiff) > 5 && y < viewportTop) {
                    totalHeightDiffAbove += heightDiff;
                }
            }

            // Single scroll adjustment for all restorations above viewport
            if (Math.abs(totalHeightDiffAbove) > 5) {
                this._scrollContainer.scrollTop += totalHeightDiffAbove;
                log.debug(`Adjusted scroll position by ${totalHeightDiffAbove}px after batch restoration`);
            }

            // Continue if more pending
            if (this._pendingRestorations.length > 0) {
                this._scheduleBatchRestoration();
            }
        });
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

    // ── Viewport Slicing (Hybrid: Timer + Scroll-debounce) ──

    /**
     * Handle browser page visibility change.
     * When the tab becomes hidden, set _pageVisible to false to prevent slicing.
     * When the tab becomes visible again, set _pageVisible to true.
     * This is a safety net - scroll events won't fire when hidden, but container
     * resize may fire when the tab returns to foreground (browser re-layout).
     */
    private _onVisibilityChange(): void {
        const wasVisible = this._pageVisible;
        this._pageVisible = !document.hidden;

        if (wasVisible !== this._pageVisible) {
            log.debug(`Page visibility changed: ${this._pageVisible ? 'visible' : 'hidden'}`);
        }
    }

    /**
     * Slice viewport: replace off-screen messages with skeleton placeholders.
     *
     * Phase 1: Instead of destroying elements, we replace them with skeleton
     * placeholders that maintain the scroll height. This provides visual continuity
     * and prevents scroll position jumps.
     *
     * IMPORTANT: Skip slicing if container is hidden (visibility: hidden).
     * Uses explicit _isVisible flag (set via setVisibility()) as primary check,
     * _pageVisible flag (from visibilitychange event) as browser-level check,
     * with getBoundingClientRect() as additional safety net for display: none.
     *
     * I3: Also checks _lastSliceTime to prevent double invocation.
     */
    private _sliceViewport() {
        if (this._elementMap.size === 0) return;

        // I1: Check explicit visibility flag (in-app tab switching)
        if (!this._isVisible) {
            log.debug('Skipping _sliceViewport: container is not visible (explicit API)');
            return;
        }

        // Page visibility check (browser tab hidden/shown)
        if (!this._pageVisible) {
            log.debug('Skipping _sliceViewport: page is not visible (browser tab hidden)');
            return;
        }

        // I3: Prevent rapid re-slicing
        const now = Date.now();
        if (now - this._lastSliceTime < this.MIN_SLICE_INTERVAL) {
            log.debug(`Skipping _sliceViewport: last slice was ${now - this._lastSliceTime}ms ago`);
            return;
        }

        // Additional safety net: check if container has zero dimensions (display: none)
        const containerRect = this._scrollContainer.getBoundingClientRect();
        const isContainerVisible = containerRect.width > 0 && containerRect.height > 0;
        if (!isContainerVisible) {
            log.debug('Skipping _sliceViewport: container has zero dimensions');
            return;
        }

        // Record slice time for double-invocation guard
        this._lastSliceTime = Date.now();

        const slice = this._getViewportSlice();
        const {invisibleTop, invisibleBottom} = slice;

        if (invisibleTop.length === 0 && invisibleBottom.length === 0) return;

        // Filter out unstable items (streaming, recently arrived, etc.)
        const stableInvisibleTop = invisibleTop.filter(part => this._checkItemStable(part.item));
        const stableInvisibleBottom = invisibleBottom.filter(part => this._checkItemStable(part.item));

        if (stableInvisibleTop.length === 0 && stableInvisibleBottom.length === 0) return;

        log.debug(
            `Slicing viewport: stableTop=${stableInvisibleTop.length}, ` +
            `stableBottom=${stableInvisibleBottom.length}, ` +
            `visible=${slice.visible.length}` +
            `, scrollTop=${this._scrollContainer.scrollTop}` +
            `, scrollHeight=${this._scrollContainer.scrollHeight}`
        );

        // Log which items are being skeletonized
        if (stableInvisibleTop.length > 0) {
            const topIds = stableInvisibleTop.map(p => this._getItemId(p.item)).join(', ');
            log.debug(`Will skeletonize top items: ${topIds}`);
        }
        if (stableInvisibleBottom.length > 0) {
            const bottomIds = stableInvisibleBottom.map(p => this._getItemId(p.item)).join(', ');
            log.debug(`Will skeletonize bottom items: ${bottomIds}`);
        }

        // Mark as not fully loaded (like Telegram's setLoaded)
        if (stableInvisibleTop.length > 0) {
            this._loadedTop = false;
        }
        if (stableInvisibleBottom.length > 0) {
            this._loadedBottom = false;
        }

        // Save scroll state
        const scrollSaver = new ScrollSaver(this._scrollContainer, this._query, stableInvisibleTop.length > 0);
        scrollSaver.save();
        const savedScrollTop = this._scrollContainer.scrollTop;

        // Replace top invisible elements with skeleton placeholders
        for (const part of stableInvisibleTop) {
            this._replaceWithSkeleton(part.index, part.element, part.item);
        }

        // Replace bottom invisible elements with skeleton placeholders
        for (const part of stableInvisibleBottom) {
            this._replaceWithSkeleton(part.index, part.element, part.item);
        }

        // Restore scroll position
        scrollSaver.restore();
        const restoredScrollTop = this._scrollContainer.scrollTop;
        log.debug(`Scroll position: saved=${savedScrollTop}, restored=${restoredScrollTop}, diff=${restoredScrollTop - savedScrollTop}`);

        // Notify size change
        this._onSizeChange?.();

        log.debug(
            `After slice: placeholders=${this._placeholderItemIds.size}, ` +
            `loadedTop=${this._loadedTop}, loadedBottom=${this._loadedBottom}`
        );
    }

    /**
     * Replace real element with skeleton placeholder.
     *
     * This is the core of Phase 1: instead of destroying off-screen elements,
     * we replace them with skeleton placeholders that maintain the scroll height.
     *
     * Steps:
     * 1. Extract component state (if supported)
     * 2. Cache the element height
     * 3. Create skeleton placeholder
     * 4. Replace DOM element
     * 5. Track placeholder in _placeholderItemIds and _placeholderPositions
     * 6. Stop tracking height for this element (skeleton height is fixed)
     */
    private _replaceWithSkeleton(index: number, element: HTMLElement, item: T): void {
        const itemId = this._getItemId(item);

        // Skip if already a placeholder
        if (this._placeholderItemIds.has(itemId)) return;

        // Phase 4 (I7 fix): Skip if element has been disconnected from DOM
        // (e.g., by concurrent clear() or session switch)
        if (!element.isConnected) {
            log.debug(`Skipping skeleton replacement for ${itemId}: element not connected`);
            return;
        }

        // Step 1: Extract component state before destroying
        if (this._extractComponentState) {
            const state = this._extractComponentState(item, element);
            if (state) {
                this._cacheComponentState(itemId, state);
            }
        }

        // Step 2: Get height (prefer cached height from ResizeObserver)
        const cachedHeight = this._heightCache.get(itemId);
        const height = cachedHeight ?? element.getBoundingClientRect().height;

        // Step 3: Create skeleton placeholder
        const skeleton = this._createPlaceholder
            ? this._createPlaceholder(item, height)
            : this._createDefaultSkeleton(item, height);

        // Set dataset attributes for identification
        skeleton.dataset.itemId = itemId;
        skeleton.dataset.messageIndex = String(index);
        skeleton.dataset.isSkeleton = 'true';

        // Step 4: Calculate absolute Y position (relative to scroll container)
        const containerRect = this._scrollContainer.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const absoluteY = elementRect.top - containerRect.top + this._scrollContainer.scrollTop;

        // Step 5: Replace element with skeleton in DOM
        element.replaceWith(skeleton);
        this._elementMap.set(index, skeleton);

        // Step 6: Track placeholder using ID (not index)
        this._placeholderItemIds.add(itemId);
        this._addPlaceholderPosition(itemId, absoluteY);

        // Step 7: Stop tracking height for old element, start for skeleton (no-op for skeleton)
        this._itemResizeObserver?.unobserve(element);

        log.debug(`Replaced item ${itemId} with skeleton (height=${height}px)`);
    }

    /**
     * Phase 2: Restore a skeleton placeholder to a real element.
     *
     * This is the inverse of _replaceWithSkeleton:
     * 1. Render the real element from item data
     * 2. Inject cached state synchronously (before first render to avoid flicker)
     * 3. Replace skeleton with real element in DOM
     * 4. Start tracking height for the new element
     * 5. Adjust scroll position if needed (for elements above viewport)
     *
     * @param itemId - Stable ID of the item (immune to index shifts from prepend/append)
     * @param _index - Index at scheduling time (unused; resolved via _idToIndex for correctness)
     * @param skeletonHeight - Height of the skeleton placeholder (for scroll adjustment)
     */
    private _restoreSkeleton(itemId: string, _index: number, skeletonHeight: number): void {
        const result = this._restoreSkeletonInternal(itemId, skeletonHeight);
        if (!result) return;

        // Schedule scroll adjustment for single restoration
        const { element, skeletonY, skeletonHeight: oldHeight } = result;
        requestAnimationFrame(() => {
            const actualHeight = element.getBoundingClientRect().height;
            const heightDiff = actualHeight - oldHeight;

            // Only adjust if height difference is significant
            if (Math.abs(heightDiff) > 5) {
                const viewportTop = this._scrollContainer.scrollTop;

                // Only adjust if restored element is above current viewport
                // (to avoid viewport jumping for elements user can see)
                if (skeletonY < viewportTop) {
                    this._scrollContainer.scrollTop += heightDiff;
                    log.debug(`Adjusted scroll position by ${heightDiff}px after restoring ${itemId}`);
                }
            }
        });

        log.debug(`Restored skeleton for item ${itemId}`);
    }

    /**
     * Internal skeleton restoration without scroll adjustment.
     * Returns height diff info for batch scroll adjustment.
     *
     * @param itemId - Stable ID of the item
     * @param skeletonHeight - Height of the skeleton placeholder
     * @returns Restoration result or null if skipped
     */
    private _restoreSkeletonInternal(
        itemId: string,
        skeletonHeight: number
    ): { element: HTMLElement; skeletonY: number; skeletonHeight: number } | null {
        // Skip if not actually a placeholder (may have been restored already)
        if (!this._placeholderItemIds.has(itemId)) return null;

        // Resolve current index: use _idToIndex for O(1) lookup, falling back to elementMap scan
        let actualIndex = this._idToIndex.get(itemId);
        if (actualIndex === undefined) {
            log.debug(`_idToIndex stale for ${itemId}, falling back to elementMap scan`);
            for (const [idx, el] of this._elementMap) {
                if (el.dataset.isSkeleton === 'true' && el.dataset.itemId === itemId) {
                    actualIndex = idx;
                    break;
                }
            }
        }

        if (actualIndex === undefined) {
            log.debug(`Skipping restore: index not found for ${itemId}`);
            return null;
        }

        const item = this._items[actualIndex];
        if (!item) {
            log.warn(`Item not found at index ${actualIndex} for ${itemId}`);
            return null;
        }

        const skeleton = this._elementMap.get(actualIndex);
        if (!skeleton) return null;

        // Capture position before mutation (critical for batch scroll adjustment)
        const skeletonY = this._getPlaceholderY(itemId);
        const cachedState = this._componentStateCache.get(itemId);

        // Render real content
        const el = this._renderItem(item, actualIndex);
        el.dataset.itemId = itemId;
        el.dataset.messageIndex = String(actualIndex);
        el.dataset.isSkeleton = 'false';

        // Inject cached state (synchronous, before first render, avoids flicker)
        if (cachedState && this._injectComponentState) {
            this._injectComponentState(item, el, cachedState);
        }

        // Start tracking height for new element
        this._itemResizeObserver?.observe(el);

        // Replace skeleton with real content in DOM
        skeleton.replaceWith(el);
        this._elementMap.set(actualIndex, el);

        // Cleanup placeholder tracking
        this._placeholderItemIds.delete(itemId);
        this._removePlaceholderPosition(itemId);
        this._componentStateCache.delete(itemId);
        this._pendingRestorationIds.delete(itemId);

        return { element: el, skeletonY, skeletonHeight };
    }

    /**
     * Create default skeleton using MessageSkeletonGenerator.
     * Called when createPlaceholder callback is not provided.
     */
    private _createDefaultSkeleton(item: T, height: number): HTMLElement {
        const type = this._getSkeletonType(item);
        const htmlContent = MessageSkeletonGenerator.generate(type, height);

        const skeleton = document.createElement('div');
        skeleton.className = `message-skeleton message-skeleton-${type}`;
        skeleton.style.height = `${height}px`;
        skeleton.innerHTML = htmlContent;
        return skeleton;
    }

    /**
     * Determine skeleton type based on item content.
     * Uses type guard for safe property access on generic T.
     *
     * NOTE: This is a fallback method. In production, `createPlaceholder` callback
     * is always provided by the consumer (rtc-message-list.ts), which uses
     * MessageSkeletonGenerator.create() with full type information.
     * This method is only used if createPlaceholder is not provided.
     */
    private _getSkeletonType(item: T): 'user' | 'assistant' | 'toolcall' | 'toolcall-reply' | 'error' {
        // Type guard for safe property access
        const hasRole = (obj: unknown): obj is {role: unknown} =>
            typeof obj === 'object' && obj !== null && 'role' in obj;
        const hasContent = (obj: unknown): obj is {content: unknown} =>
            typeof obj === 'object' && obj !== null && 'content' in obj;

        const role = hasRole(item) ? item.role : undefined;
        const content = hasContent(item) ? item.content : undefined;
        const contentType =
            typeof content === 'object' && content !== null && 'type' in content
                ? (content as {type: unknown}).type
                : undefined;

        if (role === 'user') return 'user';
        if (role === 'error' || contentType === 'error') return 'error';
        if (contentType === 'toolcall_output') return 'toolcall-reply';
        if (contentType === 'toolcall_input') return 'toolcall';
        return 'assistant';
    }

    /**
     * Cache component state with capacity limit.
     * When cache exceeds MAX_STATE_CACHE, removes oldest half.
     * Uses Map iterator for O(1) key access without allocation.
     */
    private _cacheComponentState(itemId: string, state: Record<string, unknown>): void {
        this._componentStateCache.set(itemId, state);

        // Evict oldest half when over capacity
        if (this._componentStateCache.size > this.MAX_STATE_CACHE) {
            const iterator = this._componentStateCache.keys();
            const removeCount = Math.floor(this._componentStateCache.size / 2);
            for (let i = 0; i < removeCount; i++) {
                const result = iterator.next();
                if (!result.done) {
                    this._componentStateCache.delete(result.value);
                }
            }
            log.debug(`Evicted ${removeCount} entries from state cache`);
        }
    }

    /**
     * S5: Set height cache with capacity limit.
     * When cache exceeds MAX_HEIGHT_CACHE, removes oldest half.
     * Uses Map iterator for O(1) key access without allocation.
     */
    private _setHeightCache(itemId: string, height: number): void {
        this._heightCache.set(itemId, height);

        // Evict oldest half when over capacity
        if (this._heightCache.size > this.MAX_HEIGHT_CACHE) {
            const iterator = this._heightCache.keys();
            const removeCount = Math.floor(this._heightCache.size / 2);
            for (let i = 0; i < removeCount; i++) {
                const result = iterator.next();
                if (!result.done) {
                    this._heightCache.delete(result.value);
                }
            }
            log.debug(`Evicted ${removeCount} entries from height cache`);
        }
    }

    /**
     * Add placeholder position to sorted array (maintains Y-coordinate order).
     * Uses binary search to find insertion point - O(log n) search + O(n) splice.
     */
    private _addPlaceholderPosition(itemId: string, y: number): void {
        // Binary search for insertion point
        let lo = 0;
        let hi = this._placeholderPositions.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this._placeholderPositions[mid].y < y) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        // Insert at lo position to maintain sorted order
        this._placeholderPositions.splice(lo, 0, {itemId, y});

        // Update reverse index map (all entries at or after lo shift by 1)
        // Safe: Map.set() during iteration updates existing keys without affecting iteration order
        for (const [key, idx] of this._placeholderIndexMap) {
            if (idx >= lo) this._placeholderIndexMap.set(key, idx + 1);
        }
        this._placeholderIndexMap.set(itemId, lo);
    }

    /**
     * Check if an item is stable (safe to virtualize).
     * Unstable items should not be replaced with skeletons.
     */
    private _checkItemStable(item: T): boolean {
        const itemId = this._getItemId(item);

        // Phase 4: Check active streams first (explicit stream marking)
        if (this._activeStreams.has(itemId)) {
            return false;
        }

        // Use external callback if provided
        if (this._isItemStable) {
            return this._isItemStable(item);
        }

        // Default: all items are stable
        return true;
    }

    /**
     * Find placeholder Y coordinate from reverse index map - O(1).
     */
    protected _getPlaceholderY(itemId: string): number {
        const idx = this._placeholderIndexMap.get(itemId);
        if (idx === undefined) return 0;
        return this._placeholderPositions[idx]?.y ?? 0;
    }

    /**
     * Remove placeholder position from sorted array.
     * Updates reverse index map for all subsequent entries.
     */
    protected _removePlaceholderPosition(itemId: string): void {
        const idx = this._placeholderIndexMap.get(itemId);
        if (idx === undefined) return;

        this._placeholderPositions.splice(idx, 1);
        this._placeholderIndexMap.delete(itemId);

        // Update reverse index (all entries after idx shift by -1)
        // Safe: Map.set() during iteration updates existing keys without affecting iteration order
        for (const [key, mapIdx] of this._placeholderIndexMap) {
            if (mapIdx > idx) this._placeholderIndexMap.set(key, mapIdx - 1);
        }
    }

    /**
     * S3: Find element by itemId using O(1) map lookup.
     * Falls back to DOM query only if not found in maps.
     * Used for placeholder restoration and scroll-to-message.
     */
    protected _findElementByItemId(itemId: string): HTMLElement | null {
        // Try O(1) lookup via _idToIndex + _elementMap first
        const index = this._idToIndex.get(itemId);
        if (index !== undefined) {
            const el = this._elementMap.get(index);
            if (el && el.isConnected) {
                return el;
            }
        }
        // Fallback to DOM query (for cases where index mapping is stale)
        return this._innerContainer.querySelector(`[data-item-id="${itemId}"]`);
    }

    /**
     * Find item index by itemId using _idToIndex map - O(1).
     */
    protected _findIndexByItemId(itemId: string): number {
        return this._idToIndex.get(itemId) ?? -1;
    }

    // ── Container Resize Handling (Phase 5, I4) ──

    /**
     * Handle scroll container resize (e.g., window resize).
     * Rebuilds all placeholder Y positions since cached coordinates become stale.
     */
    private _onContainerResize(): void {
        if (this._placeholderPositions.length === 0) return;
        this._rebuildPlaceholderPositions();
        // Schedule a debounced slice check after position rebuild
        if (this._sliceDebounceTimer) {
            clearTimeout(this._sliceDebounceTimer);
        }
        this._sliceDebounceTimer = window.setTimeout(() => {
            this._sliceViewport();
        }, this._sliceDebounceDelay);
    }

    /**
     * Rebuild all placeholder positions from current DOM state.
     * Called when the scroll container resizes and cached Y coordinates become stale.
     */
    private _rebuildPlaceholderPositions(): void {
        this._placeholderPositions = [];
        this._placeholderIndexMap.clear();

        const containerRect = this._scrollContainer.getBoundingClientRect();
        for (const itemId of this._placeholderItemIds) {
            const element = this._findElementByItemId(itemId);
            if (element) {
                const rect = element.getBoundingClientRect();
                const absoluteY = rect.top - containerRect.top + this._scrollContainer.scrollTop;
                this._addPlaceholderPosition(itemId, absoluteY);
            }
        }

        log.debug(`Rebuilt ${this._placeholderPositions.length} placeholder positions after container resize`);
    }

    // ── Hot/Cold Data Settlement (Phase 5, I2) ──

    /**
     * Settle excess hot items to cold storage.
     * Called after items are added to prevent unbounded memory growth.
     *
     * When _items exceeds MAX_HOT_ITEMS, the oldest items are moved to _coldItems.
     * This keeps the hot window small for fast iteration while retaining recent
     * history for quick access without repository round-trips.
     *
     * IMPORTANT: After splicing _items, this method also synchronizes all index
     * structures (_idToIndex, _elementMap, dataset.messageIndex) and removes
     * orphaned DOM elements to prevent index drift.
     */
    private _settleData(): void {
        if (this._items.length <= this.MAX_HOT_ITEMS) return;

        const settleCount = this._items.length - this.MAX_HOT_ITEMS;
        const toSettle = this._items.splice(0, settleCount);
        this._coldItems.push(...toSettle);

        // Clean up caches and index entries for settled items
        for (const item of toSettle) {
            const itemId = this._getItemId(item);
            this._heightCache.delete(itemId);
            this._componentStateCache.delete(itemId);
            this._idToIndex.delete(itemId);
        }

        // Rebuild _idToIndex: all remaining items' indices shifted by -settleCount
        this._rebuildIdToIndex();

        // Re-key _elementMap and update DOM dataset.messageIndex to match new indices.
        // Remove orphaned DOM elements for settled items.
        if (settleCount > 0) {
            const newElementMap = new Map<number, HTMLElement>();
            for (const [oldIdx, el] of this._elementMap) {
                const newIdx = oldIdx - settleCount;
                if (newIdx >= 0) {
                    newElementMap.set(newIdx, el);
                    el.dataset.messageIndex = String(newIdx);
                } else {
                    // Settled element: remove from DOM and stop observing
                    el.remove();
                    this._itemResizeObserver?.unobserve(el);
                }
            }
            this._elementMap = newElementMap;
        }

        log.debug(`Settled ${settleCount} items to cold storage (hot=${this._items.length}, cold=${this._coldItems.length})`);
    }

    // ── Rendering ──

    private _renderAll() {
        this._innerContainer.innerHTML = '';
        this._elementMap.clear();
        this._idToIndex.clear();

        const fragment = document.createDocumentFragment();
        this._items.forEach((item, index) => {
            const el = this._renderItem(item, index);
            const itemId = this._getItemId(item);
            el.dataset.messageIndex = String(index);
            el.dataset.itemId = itemId;
            el.dataset.isSkeleton = 'false';
            this._elementMap.set(index, el);
            this._idToIndex.set(itemId, index);
            // Start tracking height
            this._itemResizeObserver?.observe(el);
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
            const itemId = this._getItemId(item);
            el.dataset.messageIndex = String(index);
            el.dataset.itemId = itemId;
            el.dataset.isSkeleton = 'false';
            this._elementMap.set(index, el);
            this._idToIndex.set(itemId, index);
            // Start tracking height
            this._itemResizeObserver?.observe(el);
            fragment.appendChild(el);
        });
        this._innerContainer.appendChild(fragment);
    }
}
