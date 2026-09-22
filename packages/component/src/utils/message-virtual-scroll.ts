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
import {VisibilityManager, VisibilityState} from './visibility-manager.js';
import {SkeletonTracker} from './skeleton-tracker.js';

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

    /** Height cache: itemId → last known height */
    private _heightCache: Map<string, number> = new Map();

    /** Component state cache: itemId → state object */
    private _componentStateCache: Map<string, Record<string, unknown>> = new Map();

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

    /** Last scroll top for direction detection */
    private _lastScrollTop: number = 0;

    /** Maximum restorations per frame */
    private readonly MAX_RESTORATIONS_PER_FRAME = 10;

    // ── Visibility State Machine (Architecture Redesign) ──

    /** Visibility manager: tracks VISIBLE/HIDDEN/TRANSITIONING state */
    private _visibilityManager: VisibilityManager;

    /** Skeleton tracker: unified lifecycle management for placeholders */
    private _skeletonTracker: SkeletonTracker;

    // ── Event-Driven Slicing ──

    /** Minimum interval between _sliceViewport calls (ms) */
    private readonly MIN_SLICE_INTERVAL = 2000;

    /** Timestamp of last _sliceViewport call (prevents double invocation) */
    private _lastSliceTime: number = 0;

    // ── Stream Awareness (Phase 4) ──

    /** Active streaming item IDs - prevents skeletonization during streaming */
    private _activeStreams: Set<string> = new Set();

    // ── Container Resize Observer (Phase 5, I4) ──

    /** ResizeObserver for scroll container - rebuilds placeholder positions on resize */
    private _containerResizeObserver?: ResizeObserver;

    /** Unsubscribe function for visibility manager state changes */
    private _visibilityUnsubscribe?: () => void;

    /** Cleanup for document visibilitychange listener */
    private _documentVisibilityCleanup?: () => void;

    // ── Hot/Cold Data Separation (Phase 5, I2) ──

    /**
     * Cold storage: historical messages that have been settled out of the hot window.
     * Items are moved here when _items exceeds MAX_HOT_ITEMS.
     * The repository serves as the authoritative external cache; we only track a
     * settled counter for logging — no secondary buffer, to avoid memory leaks.
     */
    private _settledCount = 0;

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
        this._sliceDebounceDelay = 1500; // 1.5s scroll-debounce: balances responsiveness vs. slice churn

        // Phase 1: Initialize skeleton placeholder callbacks
        this._createPlaceholder = options.createPlaceholder;
        this._extractComponentState = options.extractComponentState;
        this._injectComponentState = options.injectComponentState;
        this._isItemStable = options.isItemStable;

        // Architecture Redesign: Initialize visibility state machine and skeleton tracker
        this._visibilityManager = new VisibilityManager();
        this._skeletonTracker = new SkeletonTracker();

        // Subscribe to visibility state changes
        this._visibilityUnsubscribe = this._visibilityManager.onStateChange(state => {
            this._onVisibilityStateChange(state);
        });

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

        // Page Visibility API: update visibility manager when browser tab visibility changes.
        // The actual slicing/restoration logic now goes through the visibility state machine.
        const onDocumentVisibilityChange = () => {
            // Update visibility manager based on document.hidden
            // The actual Tab visibility (app-level) is controlled via setVisibility() API
            if (document.hidden) {
                this._visibilityManager.update(false);
            } else {
                // Don't automatically set to visible - let the parent component
                // control this via setVisibility() based on Tab active state
                // Only update if we were previously hidden due to document.hidden
                // This is a safety net for browser-level visibility
            }
        };
        document.addEventListener('visibilitychange', onDocumentVisibilityChange);

        // Setup user interaction tracking to distinguish user vs programmatic scrolls
        this._setupInteractionTracking();

        // Phase 5 (I4): Setup container resize observer
        // Rebuilds placeholder positions when the scroll container resizes (e.g., window resize)
        this._containerResizeObserver = new ResizeObserver(() => {
            this._onContainerResize();
        });
        this._containerResizeObserver.observe(this._scrollContainer);

        // Store cleanup for document visibility listener
        this._documentVisibilityCleanup = () => {
            document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
        };
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
            if (this._skeletonTracker.has(itemId)) {
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
     * If getChangeableContent is provided, only compares the extracted content
     * using shallow equality (own-property reference check) — avoids the cost
     * and key-order fragility of JSON.stringify.
     * Otherwise, falls back to JSON.stringify comparison.
     */
    protected _itemsEqual(a: T, b: T): boolean {
        if (this._getChangeableContent) {
            // Compare only the changeable content (more efficient)
            const contentA = this._getChangeableContent(a);
            const contentB = this._getChangeableContent(b);
            return this._shallowEqual(contentA, contentB);
        }
        // Fallback: compare entire items
        return JSON.stringify(a) === JSON.stringify(b);
    }

    /**
     * Shallow equality for plain objects: same own keys, same values (by reference).
     * Falls back to JSON.stringify for non-object / null values.
     */
    private _shallowEqual(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (typeof a !== 'object' || typeof b !== 'object') return JSON.stringify(a) === JSON.stringify(b);

        const keysA = Object.keys(a as Record<string, unknown>);
        const keysB = Object.keys(b as Record<string, unknown>);
        if (keysA.length !== keysB.length) return false;

        const objA = a as Record<string, unknown>;
        const objB = b as Record<string, unknown>;
        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
            if (objA[key] !== objB[key]) return false;
        }
        return true;
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
        // Add prepend height to all skeleton positions
        if (prependHeight > 0 && this._skeletonTracker.size > 0) {
            for (const skeleton of this._skeletonTracker.getAll()) {
                skeleton.y += prependHeight;
            }
            log.debug(`Updated ${this._skeletonTracker.size} skeleton positions by +${prependHeight}px`);
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
        if (this._skeletonTracker.has(itemId) && contentChanged) {
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

        // Cleanup skeleton tracking (consolidated via SkeletonTracker)
        this._skeletonTracker.clear();
        this._heightCache.clear();
        this._componentStateCache.clear();

        // Cleanup restoration state
        this._pendingRestorations = [];

        // Phase 4: Cleanup stream tracking
        this._activeStreams.clear();

        // Phase 5 (I2): Cleanup cold storage counter
        this._settledCount = 0;
    }

    /**
     * Get current visibility state.
     * @deprecated Use visibilityManager.state instead
     */
    isVisible(): boolean {
        return this._visibilityManager.isVisible();
    }

    /**
     * Public API: Set visibility state.
     * Called by parent component (rtc-message-list) when Tab visibility changes.
     *
     * This is the primary mechanism for the visibility state machine:
     * - Tab switch → parent calls setVisibility(false/true)
     * - Browser window blur/focus → parent calls setVisibility(false/true)
     *
     * The state machine ensures:
     * - HIDDEN: pauses all skeletonize/restore operations
     * - TRANSITIONING: gives browser one frame to stabilize layout
     * - VISIBLE: synchronously restores visible skeletons before allowing interaction
     *
     * @param isVisible Whether the component is currently visible to the user
     */
    setVisibility(isVisible: boolean): void {
        this._visibilityManager.update(isVisible);
    }

    /**
     * Get the visibility manager (for advanced use cases).
     */
    get visibilityManager(): VisibilityManager {
        return this._visibilityManager;
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
        return this._skeletonTracker.has(itemId);
    }

    /**
     * Synchronously restore a skeleton placeholder to a real element.
     * Used by scrollToMessage to ensure the target is visible before scrolling.
     *
     * Unlike batch restoration (which uses requestAnimationFrame), this runs
     * synchronously so the caller can immediately scroll to the restored element.
     */
    syncRestorePlaceholder(itemId: string): void {
        if (!this._skeletonTracker.has(itemId)) return;

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
        if (this._skeletonTracker.size === 0) return;

        log.debug(`restoreAll: restoring ${this._skeletonTracker.size} skeletons`);

        // Capture viewport position BEFORE any DOM mutations
        const viewportTop = this._scrollContainer.scrollTop;
        let totalHeightDiffAbove = 0;

        // Restore top-to-bottom for deterministic processing
        const skeletons = this._skeletonTracker.getAll().sort((a, b) => a.y - b.y);

        for (const skeleton of skeletons) {
            const skeletonEl = this._findElementByItemId(skeleton.itemId);
            if (!skeletonEl) continue;

            const oldHeight = skeletonEl.getBoundingClientRect().height;

            // Restore without individual scroll adjustment
            const result = this._restoreSkeletonInternal(skeleton.itemId, oldHeight);
            if (!result) continue;

            // Measure actual height and accumulate diff for elements above viewport
            const newHeight = result.element.getBoundingClientRect().height;
            const heightDiff = newHeight - oldHeight;

            // Use the captured viewportTop (not current scrollTop) for judgment
            if (Math.abs(heightDiff) > 5 && skeleton.y < viewportTop) {
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
        // Cleanup document visibility listener
        if (this._documentVisibilityCleanup) {
            this._documentVisibilityCleanup();
            this._documentVisibilityCleanup = undefined;
        }
        // Cleanup visibility manager
        if (this._visibilityUnsubscribe) {
            this._visibilityUnsubscribe();
            this._visibilityUnsubscribe = undefined;
        }
        this._visibilityManager.dispose();
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

        // Cleanup skeleton tracking (consolidated via SkeletonTracker)
        this._skeletonTracker.clear();
        this._heightCache.clear();
        this._componentStateCache.clear();

        // Cleanup restoration state
        this._pendingRestorations = [];

        // Phase 4: Cleanup stream tracking
        this._activeStreams.clear();

        // Phase 5 (I2): Cleanup cold storage counter
        this._settledCount = 0;
    }

    getStats() {
        return {
            totalItems: this._items.length,
            renderedItems: this._elementMap.size,
            placeholderCount: this._skeletonTracker.size,
            pendingRestorationCount: this._pendingRestorations.length,
            visibilityState: this._visibilityManager.state,
            loadedTop: this._loadedTop,
            loadedBottom: this._loadedBottom,
            firstId: this._items.length > 0 ? this._getItemId(this._items[0]) : undefined,
            lastId: this._items.length > 0 ? this._getItemId(this._items[this._items.length - 1]) : undefined,
            // Phase 5 (S2): Extended metrics for monitoring and debugging
            heightCacheSize: this._heightCache.size,
            stateCacheSize: this._componentStateCache.size,
            activeStreamCount: this._activeStreams.size,
            isVisible: this._isContainerVisible(),
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
     * Visibility check: Uses visibility state machine to ensure restoration only
     * happens when VISIBLE. This prevents the bug where restoration would fail
     * silently when the component was hidden.
     *
     * Skeleton lookup: Uses SkeletonTracker.getInRange() which handles the
     * "any part in range" check internally (including tall skeletons).
     *
     * Dedup: Uses SkeletonTracker's isPendingRestoration flag instead of a
     * separate _pendingRestorationIds set, avoiding the "dedup deadlock" bug
     * where failed restorations would never be retried.
     */
    private _restoreSkeletonsInRange(scrollTop: number, clientHeight: number): void {
        // Visibility state machine check
        if (!this._visibilityManager.shouldPerformOperations()) {
            return;
        }

        if (this._skeletonTracker.size === 0) return;

        // Fixed preload distance: 2× viewport height
        const PRELOAD_DISTANCE = clientHeight * 2;

        // Restore range: absolute coordinates
        const restoreTop = scrollTop - PRELOAD_DISTANCE;
        const restoreBottom = scrollTop + clientHeight + PRELOAD_DISTANCE;

        log.debug(`_restoreSkeletonsInRange: scrollTop=${scrollTop}, clientHeight=${clientHeight}, skeletons=${this._skeletonTracker.size}, range=[${restoreTop}, ${restoreBottom}]`);

        // Use SkeletonTracker to find skeletons in range
        // This internally checks "any part in range" and filters out already-pending ones
        const skeletonsInRange = this._skeletonTracker.getInRange(restoreTop, restoreBottom);

        if (skeletonsInRange.length === 0) {
            log.debug(`_restoreSkeletonsInRange: no skeletons in range`);
            return;
        }

        log.debug(`_restoreSkeletonsInRange: found ${skeletonsInRange.length} skeletons in range`);

        // Sort by scroll direction for natural restoration order
        const direction = this._getScrollDirection();
        if (direction === 'down') {
            skeletonsInRange.sort((a, b) => a.y - b.y);
        } else {
            skeletonsInRange.sort((a, b) => b.y - a.y);
        }

        // Add to pending restoration queue and mark as pending in tracker
        for (const skeleton of skeletonsInRange) {
            const index = this._findIndexByItemId(skeleton.itemId);
            if (index >= 0) {
                this._pendingRestorations.push({
                    itemId: skeleton.itemId,
                    index,
                    y: skeleton.y,
                });
                this._skeletonTracker.markPending(skeleton.itemId);
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
     *
     * Visibility check: Uses visibility state machine. If not VISIBLE, the batch
     * is cancelled and pending items are unmarked so they can be retried later.
     * This fixes the "dedup deadlock" bug where pending IDs would prevent retry.
     */
    private _scheduleBatchRestoration(): void {
        if (this._restorationScheduled || this._pendingRestorations.length === 0) return;

        this._restorationScheduled = true;

        requestAnimationFrame(() => {
            this._restorationScheduled = false;

            // Visibility state machine check
            if (!this._visibilityManager.shouldPerformOperations()) {
                log.debug(`Skipping batch restoration: visibility state is ${this._visibilityManager.state}`);
                // Clear pending flags so items can be retried when visible again
                for (const {itemId} of this._pendingRestorations) {
                    this._skeletonTracker.clearPending(itemId);
                }
                // Keep items in queue for retry (don't discard)
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
     * Check if the scroll container is currently visible.
     * Uses the visibility state machine as the single source of truth.
     *
     * The visibility state machine (VisibilityManager) tracks:
     * - VISIBLE: component is visible and interactive
     * - HIDDEN: component is not visible (Tab switch or browser window blur)
     * - TRANSITIONING: component is transitioning from hidden to visible
     *
     * This replaces the previous ad-hoc checks that couldn't detect
     * visibility: hidden CSS (which preserves layout dimensions).
     */
    private _isContainerVisible(): boolean {
        return this._visibilityManager.isVisible();
    }

    /**
     * Handle visibility state machine transitions.
     * Called by VisibilityManager when state changes.
     *
     * State transitions:
     * - VISIBLE → HIDDEN: Pause all operations, cancel pending timers
     * - HIDDEN → TRANSITIONING: Prepare for restore (wait one frame for layout)
     * - TRANSITIONING → VISIBLE: Rebuild skeleton positions, restore visible skeletons
     */
    private _onVisibilityStateChange(state: VisibilityState): void {
        log.debug(`Visibility state changed: ${state}`);

        switch (state) {
            case VisibilityState.HIDDEN:
                this._pauseOperations();
                break;

            case VisibilityState.TRANSITIONING:
                // Wait for VISIBLE state (next frame)
                break;

            case VisibilityState.VISIBLE:
                this._restoreState();
                break;
        }
    }

    /**
     * Pause all virtual scroll operations when becoming hidden.
     *
     * This is the key mechanism that prevents the bug:
     * - When Tab is hidden (visibility: hidden) or browser window loses focus,
     *   all skeletonize/restore operations are paused
     * - No new skeletons are created while hidden
     * - Pending restoration timers are cancelled
     * - When becoming visible again, state is rebuilt synchronously
     */
    private _pauseOperations(): void {
        // Cancel pending slice timer
        if (this._sliceDebounceTimer) {
            clearTimeout(this._sliceDebounceTimer);
            this._sliceDebounceTimer = null;
        }

        // Cancel pending restoration
        this._restorationScheduled = false;

        // Reset loading flags to prevent stuck state
        this._isLoading = {top: false, bottom: false};

        // Clear pending restorations (they will be re-queued when visible)
        // This fixes the "pendingRestorationIds dedup deadlock" bug:
        // IDs in _pendingRestorationIds would prevent retrying after failure.
        // By clearing pending state on hide, we ensure fresh restore attempts on show.
        for (const {itemId} of this._pendingRestorations) {
            this._skeletonTracker.clearPending(itemId);
        }
        this._pendingRestorations = [];

        log.debug('Paused all virtual scroll operations');
    }

    /**
     * Restore state when becoming visible again.
     *
     * This runs synchronously when the state machine transitions to VISIBLE:
     * 1. Rebuild skeleton Y positions (layout may have changed while hidden)
     * 2. Synchronously restore all skeletons in the current viewport
     * 3. Allow subsequent operations
     *
     * This fixes the "stale Y coordinates" bug:
     * - While hidden, layout may change (new messages, container resize)
     * - Old Y coordinates become stale
     * - By rebuilding positions synchronously on restore, we ensure accuracy
     */
    private _restoreState(): void {
        if (this._skeletonTracker.size === 0) {
            log.debug('No skeletons to restore');
            return;
        }

        log.debug(`Restoring state: ${this._skeletonTracker.size} skeletons`);

        // Step 1: Rebuild skeleton positions based on current layout
        this._skeletonTracker.rebuildPositions(this._scrollContainer, this._elementMap);

        // Step 2: Synchronously restore all skeletons in the current viewport
        // This is NOT limited by MAX_RESTORATIONS_PER_FRAME because we need
        // to ensure all visible skeletons are restored before user interaction
        this._restoreVisibleSkeletons();

        log.debug('State restored');
    }

    /**
     * Synchronously restore all skeletons in the current viewport.
     *
     * Called when transitioning from hidden to visible.
     * Unlike _restoreSkeletonsInRange (which uses rAF), this runs synchronously
     * to ensure all visible skeletons are restored before user can interact.
     */
    private _restoreVisibleSkeletons(): void {
        const {scrollTop, clientHeight} = this._scrollContainer;

        // Restore viewport + generous preload area
        const PRELOAD_DISTANCE = clientHeight;
        const restoreTop = scrollTop - PRELOAD_DISTANCE;
        const restoreBottom = scrollTop + clientHeight + PRELOAD_DISTANCE;

        const skeletonsInRange = this._skeletonTracker.getInRange(restoreTop, restoreBottom);

        if (skeletonsInRange.length === 0) {
            return;
        }

        log.debug(`Restoring ${skeletonsInRange.length} visible skeletons synchronously`);

        // Capture viewport position BEFORE any DOM mutations
        const viewportTop = this._scrollContainer.scrollTop;
        let totalHeightDiffAbove = 0;

        // Sort by Y for deterministic processing
        skeletonsInRange.sort((a, b) => a.y - b.y);

        for (const skeleton of skeletonsInRange) {
            const skeletonHeight = skeleton.element.getBoundingClientRect().height;
            const result = this._restoreSkeletonInternal(skeleton.itemId, skeletonHeight);
            if (!result) continue;

            // Measure actual height and accumulate diff for elements above viewport
            const newHeight = result.element.getBoundingClientRect().height;
            const heightDiff = newHeight - skeletonHeight;

            if (Math.abs(heightDiff) > 5 && skeleton.y < viewportTop) {
                totalHeightDiffAbove += heightDiff;
            }
        }

        // Single scroll adjustment for all restorations above viewport
        if (Math.abs(totalHeightDiffAbove) > 5) {
            this._scrollContainer.scrollTop += totalHeightDiffAbove;
            log.debug(`Adjusted scroll position by ${totalHeightDiffAbove}px after visible restore`);
        }
    }

    /**
     * Slice viewport: replace off-screen messages with skeleton placeholders.
     *
     * Phase 1: Instead of destroying elements, we replace them with skeleton
     * placeholders that maintain the scroll height. This provides visual continuity
     * and prevents scroll position jumps.
     *
     * Visibility check: Uses the visibility state machine (shouldPerformOperations)
     * to ensure slicing only happens when the component is VISIBLE. This prevents
     * the bug where background tabs (visibility: hidden) would have skeletons
     * created but never restored.
     *
     * I3: Also checks _lastSliceTime to prevent double invocation.
     */
    private _sliceViewport() {
        if (this._elementMap.size === 0) return;

        // Visibility state machine check: only perform operations when VISIBLE
        if (!this._visibilityManager.shouldPerformOperations()) {
            log.debug(`Skipping _sliceViewport: visibility state is ${this._visibilityManager.state}`);
            return;
        }

        // I3: Prevent rapid re-slicing
        const now = Date.now();
        if (now - this._lastSliceTime < this.MIN_SLICE_INTERVAL) {
            log.debug(`Skipping _sliceViewport: last slice was ${now - this._lastSliceTime}ms ago`);
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
            `After slice: skeletons=${this._skeletonTracker.size}, ` +
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
     * 5. Track placeholder via SkeletonTracker (unified lifecycle management)
     * 6. Stop tracking height for this element (skeleton height is fixed)
     */
    private _replaceWithSkeleton(index: number, element: HTMLElement, item: T): void {
        const itemId = this._getItemId(item);

        // Skip if already a placeholder
        if (this._skeletonTracker.has(itemId)) return;

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

        // Step 6: Track placeholder via SkeletonTracker (replaces old _placeholderItemIds + _addPlaceholderPosition)
        this._skeletonTracker.add(itemId, index, absoluteY, skeleton);

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
        const skeletonInfo = this._skeletonTracker.get(itemId);
        if (!skeletonInfo) return null;

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
        const skeletonY = skeletonInfo.y;
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

        // Cleanup placeholder tracking via SkeletonTracker
        // This clears: _placeholderItemIds entry, _placeholderPositions entry,
        // and _pendingRestorationIds entry (all consolidated in skeletonTracker)
        this._skeletonTracker.remove(itemId);
        this._componentStateCache.delete(itemId);

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
     * Rebuilds all skeleton Y positions via SkeletonTracker since cached coordinates become stale.
     *
     * Note: Only rebuilds positions when VISIBLE. When hidden, positions will be rebuilt
     * by _restoreState() when transitioning back to visible.
     */
    private _onContainerResize(): void {
        if (this._skeletonTracker.size === 0) return;

        // Only rebuild positions when visible (state machine check)
        if (this._visibilityManager.shouldPerformOperations()) {
            this._skeletonTracker.rebuildPositions(this._scrollContainer, this._elementMap);
            log.debug(`Rebuilt ${this._skeletonTracker.size} skeleton positions after container resize`);

            // Schedule a debounced slice check after position rebuild
            if (this._sliceDebounceTimer) {
                clearTimeout(this._sliceDebounceTimer);
            }
            this._sliceDebounceTimer = window.setTimeout(() => {
                this._sliceViewport();
            }, this._sliceDebounceDelay);
        }
    }

    // ── Hot/Cold Data Settlement (Phase 5, I2) ──

    /**
     * Settle excess hot items to cold storage.
     * Called after items are added to prevent unbounded memory growth.
     *
     * When _items exceeds MAX_HOT_ITEMS, the oldest items are evicted and a
     * settled counter is incremented for logging.
     * This keeps the hot window small for fast iteration while relying on the
     * repository as the authoritative cache for older history.
     *
     * IMPORTANT: After splicing _items, this method also synchronizes all index
     * structures (_idToIndex, _elementMap, dataset.messageIndex) and removes
     * orphaned DOM elements to prevent index drift.
     */
    private _settleData(): void {
        if (this._items.length <= this.MAX_HOT_ITEMS) return;

        const settleCount = this._items.length - this.MAX_HOT_ITEMS;
        const toSettle = this._items.splice(0, settleCount);
        this._settledCount += toSettle.length;

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

        log.debug(`Settled ${settleCount} items to cold storage (hot=${this._items.length}, settled=${this._settledCount})`);
    }

    // ── Rendering ──

    private _renderAll() {
        this._innerContainer.innerHTML = '';
        this._elementMap.clear();
        this._idToIndex.clear();

        // Critical: Clear all skeleton tracking state to prevent "ghost" placeholders.
        // When re-rendering all items, the DOM is completely rebuilt, so any existing
        // skeleton placeholders are destroyed. We must clear the tracking state to
        // match the new DOM state.
        this._skeletonTracker.clear();
        this._componentStateCache.clear();
        this._pendingRestorations = [];

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
