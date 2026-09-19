/**
 * RTC Message List Component
 *
 * Renders messages in a scrollable container with timeline layout.
 * Uses @lit-labs/virtualizer for virtual scrolling with automatic
 * dynamic-height handling via ResizeObserver.
 *
 * ## Multi-instance architecture
 *
 * Each `<rtc-message-list>` subscribes directly to `MessageRepository` for a
 * specific `sessionId`. This allows multiple instances to coexist (e.g. one per
 * open tab) without relying on a shared `MessageContext`. Data flows through
 * the repository's pub-sub mechanism; each instance independently tracks its
 * own scroll state and follow-mode.
 *
 * ## Auto-scroll mechanism
 *
 * 1. **`firstUpdated()` handles initial mount** — waits for virtualizer layout
 *    and Markdown rendering to stabilize, then scrolls to bottom.
 *
 * 2. **`updated()` reacts to message changes**:
 *    - If `_pendingScroll` is set (by `_handleNewMessages`), apply it.
 *
 * 3. **`_handleScroll` (template-bound) tracks follow mode**:
 *    - Updates `_followMode` based on distance from bottom.
 *
 * 4. **`_handleNewMessages` runs on every repository notification**:
 *    - Checks real-time scroll position (works even for background tabs).
 *    - Sets `_pendingScroll` when near bottom.
 *
 * 5. **ResizeObserver (built into @lit-labs/virtualizer)** handles async content:
 *    - Markdown rendering, thinking expansion, tool-call card resizing.
 *
 * @element rtc-message-list
 */
import {LitElement, html, type TemplateResult} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {query} from 'lit/decorators/query.js';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import '@lit-labs/virtualizer';
import type {LitVirtualizer} from '@lit-labs/virtualizer';
import {styles} from './rtc-message-list.styles.js';
import {SettingsContext, type SettingsContextValue} from '../../contexts/settings.js';
import type {MessageController} from '../../controllers/message.controller.js';
import type {Message, MessageState} from '../../types/index.js';
import './rtc-message.js';
import './rtc-user-message.js';
import './rtc-toolcall-card.js';
import './rtc-error-message.js';
import type {RenderItem} from './types.js';

/**
 * Virtual scroll configuration constants.
 *
 * Centralizes thresholds and buffers for virtual scrolling,
 * avoiding scattered magic numbers across the component.
 */
const VIRTUAL_SCROLL_CONFIG = {
    /** "Near bottom" threshold (px) */
    SCROLL_END_THRESHOLD: 80,
    /** Auto-load-more trigger threshold (px): scrollTop below this triggers loadMore */
    AUTO_LOAD_MORE_THRESHOLD: 120,
    /** "Near top" threshold (px), controls "Load more" button visibility */
    NEAR_TOP_THRESHOLD: 60,
    /** Safari rubber-band bounce wait delay (ms) */
    SAFARI_BOUNCE_DELAY: 200,
    /** ResizeObserver stability timeout (ms): no resize for this duration = stable */
    RENDER_STABLE_TIMEOUT: 100,
    /** Maximum wait for render completion (ms) before falling back */
    RENDER_MAX_WAIT: 3000,
} as const;


@localized()
@customElement('rtc-message-list')
export class RtcMessageList extends LitElement {
    static styles = styles;

    @query('lit-virtualizer')
    private _virtualizerEl!: LitVirtualizer;

    @property({type: String})
    sessionId: string | null = null;

    @property({attribute: false})
    messageController?: MessageController;

    @property({type: String, attribute: 'theme'})
    theme: 'light' | 'dark' | 'system' = 'system';

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[RtcMessageList] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @consume({context: SettingsContext, subscribe: true})
    @state()
    private _settingsCtx: SettingsContextValue = {
        state: {
            appearance: {theme: 'system', fontSize: 14},
            chat: {sendShortcut: 'Enter', density: 'comfortable'},
            files: {autoSave: true, defaultViewMode: 'split'},
            notifications: {soundEnabled: true, toastEnabled: true},
        },
        actions: {
            updateAppearance: () => {},
            updateChat: () => {},
            updateFiles: () => {},
            updateNotifications: () => {},
            resetAll: () => {},
        },
    };

    // ── Repository subscription state ──

    /** Unsubscribe function returned by MessageRepository.subscribe(). */
    private _subscription?: () => void;

    /** Messages for the current session (driven by repository subscription). */
    @state()
    private _messages: Message[] = [];

    /** Whether older messages are available (backward pagination). */
    @state()
    private _hasMore = false;

    /** Whether a loadMore request is in-flight. */
    @state()
    private _isLoadingMore = false;

    /** Controls visibility after first render completes. */
    @state()
    private _ready = false;

    /** Whether to auto-scroll on new messages ("follow mode"). */
    @state()
    private _followMode = true;

    /** Pending scroll action: 'bottom' means scroll to latest message. */
    private _pendingScroll: 'bottom' | null = null;

    /** RAF throttle flag for _handleScroll. */
    private _scrollRafPending = false;

    /** Generation counter for _applyPendingScroll to prevent concurrent conflicts. */
    private _applyPendingScrollGeneration = 0;

    /** When true, scroll events should not update button state (during programmatic scroll). */
    private _scrollSuppressed = false;

    // ── Render-complete cleanup handles (Issue #8 fix) ──

    /** ResizeObserver used by _waitForRenderComplete, for cleanup on disconnect. */
    private _renderObserver?: ResizeObserver;

    /** Resize-stability timer from _waitForRenderComplete. */
    private _renderStableTimer?: ReturnType<typeof setTimeout>;

    /** Maximum-wait fallback timer from _waitForRenderComplete. */
    private _renderMaxWaitTimer?: ReturnType<typeof setTimeout>;

    // ── UI state ──

    @state()
    private _showNewBtn = false;

    @state()
    private _showLoadMoreBtn = false;

    /** Cached render items, computed in willUpdate(). */
    private _renderItems: RenderItem[] = [];

    /**
     * Pre-computed key of the last render item.
     *
     * Updated in willUpdate() alongside _renderItems to avoid
     * redundant O(1) lookups inside _renderItemFn (Issue #7 fix).
     */
    private _lastKey: string | undefined = undefined;

    /** Stable renderItem function reference. */
    private _renderItemFn = (item: RenderItem): TemplateResult => {
        return this._renderMessageItem(item, this._lastKey);
    };

    /** Stable keyFunction reference. */
    private _keyFn = (item: RenderItem) => item.key;

    // ── Public API ──

    get messages(): Message[] {
        return this._messages;
    }

    /**
     * Scroll to the bottom of the message list.
     * Public method for external callers.
     */
    scrollToBottom() {
        const el = this._virtualizerEl;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }

    /**
     * Scroll to a specific message by clientId.
     * Looks up the index in _renderItems (not messages), because the
     * virtualizer's index corresponds to _renderItems.
     */
    scrollToMessage(clientId: string) {
        const index = this._renderItems.findIndex(item => item.key === clientId);
        if (index >= 0) {
            try {
                this._virtualizerEl?.scrollToIndex(index, 'center');
            } catch {
                // scrollToIndex may fail in test environments (jsdom) or when
                // the virtualizer layout is not yet ready; safe to ignore.
            }
        }
    }

    // ── Lifecycle ──

    connectedCallback() {
        super.connectedCallback();
        // Subscription is handled in willUpdate() when sessionId or messageController changes.
        // This avoids double subscription on initial mount.
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._subscription?.();
        this._subscription = undefined;

        // Clean up render-complete observers/timers (Issue #8 fix)
        clearTimeout(this._renderStableTimer);
        clearTimeout(this._renderMaxWaitTimer);
        this._renderObserver?.disconnect();
    }

    protected willUpdate(changed: Map<string, unknown>): void {
        // Re-subscribe if sessionId or messageController changed
        if ((changed.has('sessionId') || changed.has('messageController')) && this.messageController && this.sessionId) {
            // Unsubscribe from old session
            this._subscription?.();
            this._subscription = undefined;

            try {
                // Subscribe to new session
                this._subscription = this.messageController.repository.subscribe(
                    this.sessionId,
                    (data: MessageState) => {
                        this._messages = data.messages;
                        this._hasMore = data.hasMore;
                        this._isLoadingMore = data.isLoadingMore;
                        this._handleNewMessages();
                    },
                );

                // Trigger initial data load
                this.messageController.fetchInitialMessages(this.sessionId);
            } catch (err) {
                // Repository not initialized yet; will retry on next update
                console.debug('[rtc-message-list] Repository not ready, deferring subscription:', (err as Error).message);
            }

            // Build render items from current _messages (may have been updated by subscribe callback)
            this._renderItems = this._buildRenderItems(this._messages);
            this._lastKey = this._renderItems[this._renderItems.length - 1]?.key;
        } else if (changed.has('_messages')) {
            // Normal case: _messages changed via repository subscription
            this._renderItems = this._buildRenderItems(this._messages);
            this._lastKey = this._renderItems[this._renderItems.length - 1]?.key;
        }
    }

    protected async firstUpdated() {
        // Wait for virtualizer layout complete
        if (this._virtualizerEl?.layoutComplete) {
            try {
                await this._virtualizerEl.layoutComplete;
            } catch {
                // Layout incomplete doesn't block subsequent operations;
                // scroll methods handle null/undefined gracefully.
            }
        }

        // Wait for Markdown rendering + scrollHeight stabilization
        await this._waitForRenderComplete();

        // Scroll to bottom
        if (this._followMode && this._virtualizerEl && this._renderItems.length > 0) {
            try {
                this._virtualizerEl.scrollToIndex(this._renderItems.length - 1, 'end');
            } catch {
                // scrollToIndex may fail in test environments (jsdom) or when
                // the virtualizer layout is not yet ready; safe to ignore.
            }
        }

        // Clear any pending scroll set during initialization, since we've
        // already handled the initial scroll-to-bottom above.
        this._pendingScroll = null;

        // Show the component
        this._ready = true;
    }

    /**
     * React to state changes after render.
     *
     * Handles pending scroll actions set by `_handleNewMessages`.
     * Also updates density attribute and load-more button visibility.
     */
    updated(changed: Map<string, unknown>) {
        super.updated(changed);

        const density = this._settingsCtx.state.chat.density;
        this.setAttribute('data-density', density);

        // If _ready is false, still in first render — let firstUpdated handle it
        if (!this._ready) return;

        // If _messages changed, apply pending scroll.
        // _applyPendingScroll is async but updated() cannot await it.
        // Attach .catch() to prevent unhandled promise rejection.
        if (changed.has('_messages')) {
            this._applyPendingScroll().catch(err => {
                console.debug('[rtc-message-list] _applyPendingScroll error:', err);
            });
        }

        // Update load-more button visibility
        this._showLoadMoreBtn = this._hasMore && this._isNearTop();
    }

    // ── Render readiness ──

    /**
     * Wait for rendering to complete (ResizeObserver event-driven + timeout fallback).
     *
     * 1. Monitor virtualizer content container with ResizeObserver.
     * 2. 100ms without resize = stable.
     * 3. Max 3 second timeout fallback.
     */
    private async _waitForRenderComplete(): Promise<void> {
        const el = this._virtualizerEl;
        if (!el) return;

        return new Promise(resolve => {
            let resolved = false;

            // Monitor virtualizer content container
            const contentEl = el.querySelector('[role="list"]') || el.firstElementChild;
            if (!contentEl) {
                resolve();
                return;
            }

            // Clean up any previous observer/timers before creating new ones
            // (e.g. _applyPendingScroll may call _waitForRenderComplete multiple times)
            this._renderObserver?.disconnect();
            clearTimeout(this._renderStableTimer);

            this._renderObserver = new ResizeObserver(() => {
                clearTimeout(this._renderStableTimer);
                this._renderStableTimer = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        this._renderObserver?.disconnect();
                        resolve();
                    }
                }, VIRTUAL_SCROLL_CONFIG.RENDER_STABLE_TIMEOUT);
            });

            this._renderObserver.observe(contentEl);

            // Safety timeout: max 3 seconds
            this._renderMaxWaitTimer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this._renderObserver?.disconnect();
                    resolve();
                }
            }, VIRTUAL_SCROLL_CONFIG.RENDER_MAX_WAIT);

            // Initial check: may already be stable
            this._renderStableTimer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this._renderObserver?.disconnect();
                    resolve();
                }
            }, VIRTUAL_SCROLL_CONFIG.RENDER_STABLE_TIMEOUT);
        });
    }

    // ── Message handling ──

    /**
     * Handle new messages arriving from the repository.
     *
     * Runs for both foreground and background tabs. Checks real-time scroll
     * position to decide whether to auto-scroll, since scroll events don't
     * fire when the tab is hidden.
     *
     * Note: This method does NOT update `_followMode`.
     *
     * `_followMode` represents "user intent to follow new content" and is only
     * updated by user scroll events (`_handleScroll`). In background tabs
     * (visibility: hidden), scroll events don't fire, so `_followMode` stays
     * true (its initial value). This is intentional: background tabs should
     * always follow new messages, so when the user returns they see the latest
     * content at the bottom.
     *
     * `_pendingScroll` is the actual trigger for auto-scroll. It is set here
     * based on real-time scroll position check, and consumed by `_applyPendingScroll`
     * in `updated()`.
     */
    private _handleNewMessages() {
        if (!this._virtualizerEl) {
            // Virtualizer not ready yet; queue scroll-to-bottom for when it is.
            this._pendingScroll = 'bottom';
            return;
        }

        // _followMode is the authoritative signal of user intent to follow
        // new content. Independent re-computation of isNearBottom here would
        // contradict _handleScroll's judgment within the RAF throttle window.
        // In background tabs (visibility: hidden), scroll events don't fire,
        // so _followMode stays true (its initial value) — which is the desired
        // behavior: background tabs always follow new messages.
        if (!this._followMode) return;

        this._pendingScroll = 'bottom';
    }

    /**
     * Apply pending scroll action after render.
     *
     * Waits for virtualizer layout and render stabilization before scrolling,
     * then performs a secondary check 300ms later to handle async content
     * (e.g. Markdown rendering, tool-call card resizing) that may change
     * the scrollHeight after the initial scroll.
     */
    private async _applyPendingScroll() {
        if (!this._virtualizerEl || this._pendingScroll !== 'bottom') return;

        // Clear the flag synchronously before any await, so callers observing
        // _pendingScroll immediately after updated() see it cleared.
        this._pendingScroll = null;

        // Generation counter: if a newer _applyPendingScroll starts before this
        // one finishes, the older one becomes a no-op at each await boundary.
        // This prevents concurrent scrollToIndex calls fighting over scroll
        // position and leaking timers.
        const gen = ++this._applyPendingScrollGeneration;
        const el = this._virtualizerEl;

        // 1. Wait for virtualizer layout complete
        if (el.layoutComplete) {
            try {
                await el.layoutComplete;
            } catch {
                // Layout incomplete doesn't block scroll; safe to ignore.
            }
        }
        if (gen !== this._applyPendingScrollGeneration) return;

        // 2. Wait for render to stabilize (ResizeObserver 100ms no-change)
        await this._waitForRenderComplete();
        if (gen !== this._applyPendingScrollGeneration) return;

        // 3. Execute scroll — but only if user still intends to follow.
        // During the awaits above, _followMode may have flipped to false
        // (user scrolled up). Respect the current intent, not the stale one.
        if (this._followMode && this._renderItems.length > 0) {
            try {
                el.scrollToIndex(this._renderItems.length - 1, 'end');
            } catch {
                // scrollToIndex may fail in test environments (jsdom) or when
                // the virtualizer layout is not yet ready; safe to ignore.
            }
        }
        if (gen !== this._applyPendingScrollGeneration) return;

        // 4. Secondary check: async content (Markdown, tool-call cards) may
        // have changed scrollHeight after the initial scroll. Re-check both
        // _followMode (user intent) and real-time DOM position (ground truth).
        await new Promise(resolve => setTimeout(resolve, 300));
        if (gen !== this._applyPendingScrollGeneration) return;

        if (this._followMode) {
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (distanceFromBottom > 10) {
                try {
                    el.scrollToIndex(this._renderItems.length - 1, 'end');
                } catch {
                    // Safe to ignore
                }
            }
        }
    }

    // ── Scroll handling ──

    /**
     * Handle scroll events from the virtualizer.
     *
     * Updates follow mode and button visibility.
     * Throttled via requestAnimationFrame to avoid excessive re-renders.
     */
    private _handleScroll = () => {
        const el = this._virtualizerEl;
        if (!el) return;

        // _followMode must be updated synchronously because _handleNewMessages
        // and _applyPendingScroll depend on it as the authoritative signal of
        // user intent. Deferring it to RAF (~16ms) creates a window where
        // _followMode is stale relative to the actual scroll position.
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight
            < VIRTUAL_SCROLL_CONFIG.SCROLL_END_THRESHOLD;
        this._followMode = isNearBottom;

        // UI state updates are still throttled via RAF to avoid excessive re-renders.
        if (this._scrollRafPending) return;
        this._scrollRafPending = true;

        requestAnimationFrame(() => {
            this._scrollRafPending = false;
            if (!this._virtualizerEl) return;

            // During programmatic scroll (button click), suppress button state
            // changes to avoid flicker: _applyPendingScroll's scrollToIndex
            // fires scroll events that would otherwise re-show the button.
            if (!this._scrollSuppressed) {
                this._showNewBtn = !this._followMode;
            }
            this._showLoadMoreBtn = this._hasMore && this._isNearTop();

            // Auto-trigger loadMore when near top
            if (el.scrollTop < VIRTUAL_SCROLL_CONFIG.AUTO_LOAD_MORE_THRESHOLD && this._hasMore) {
                this._handleLoadMoreClick();
            }
        });
    };

    private _isNearTop(): boolean {
        const el = this._virtualizerEl;
        if (!el) return false;
        return el.scrollTop < VIRTUAL_SCROLL_CONFIG.NEAR_TOP_THRESHOLD;
    }

    // ── Load more ──

    /**
     * Handle "Load more" button click.
     *
     * Arrow function to preserve `this` context when used as event handler.
     * Lit's @click=${handler} does not auto-bind regular methods.
     */
    private _handleLoadMoreClick = async () => {
        if (this._isLoadingMore) return;

        const el = this._virtualizerEl;
        if (!el || !this.messageController || !this.sessionId) return;

        // Capture sessionId before any await to guard against tab switches
        const sessionId = this.sessionId;

        // Safari rubber-band guard: scrollTop < 0 indicates bounce state
        if (el.scrollTop < 0) {
            await new Promise(resolve => setTimeout(resolve, VIRTUAL_SCROLL_CONFIG.SAFARI_BOUNCE_DELAY));
            // sessionId may have changed during the wait
            if (this.sessionId !== sessionId) return;
            if (!el || el.scrollTop < 0) return;
        }

        // Save current scroll position for restoration after prepend
        const prevScrollHeight = el.scrollHeight;
        const prevScrollTop = el.scrollTop;

        this._showLoadMoreBtn = false;

        // Load earlier messages (prepends to the list)
        await this.messageController.loadMoreForSession(sessionId);

        // Wait for render to complete so scrollHeight reflects new content
        await this.updateComplete;

        // Restore scroll position: offset by the height of prepended content
        const newScrollHeight = el.scrollHeight;
        el.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
    };

    // ── Button handlers ──

    /**
     * Handle "New messages" button click.
     *
     * Arrow function to preserve `this` context when used as event handler.
     * Lit's @click=${handler} does not auto-bind regular methods.
     */
    private _handleNewBtnClick = async () => {
        this._followMode = true;
        this._showNewBtn = false; // Immediately hide button
        this._pendingScroll = 'bottom';

        // Suppress scroll events from updating button state during the
        // programmatic scrollToIndex calls inside _applyPendingScroll.
        // Without this, scrollToIndex fires scroll events that the RAF-
        // throttled _handleScroll would interpret as "user scrolled away",
        // re-showing the button we just hid.
        this._scrollSuppressed = true;
        try {
            await this._applyPendingScroll();
        } finally {
            this._scrollSuppressed = false;
        }

        // After suppression ends, derive button state from the final
        // scroll position (ground truth), not from _followMode alone.
        const el = this._virtualizerEl;
        if (el) {
            const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                < VIRTUAL_SCROLL_CONFIG.SCROLL_END_THRESHOLD;
            this._showNewBtn = !isNearBottom;
        }
    };

    // ── Render ──

    render() {
        void this._localeCtx.locale;

        return html`
            <div class="list-wrapper">
                <lit-virtualizer
                    class="message-list-scroll"
                    scroller
                    .items=${this._renderItems}
                    .renderItem=${this._renderItemFn}
                    .keyFunction=${this._keyFn}
                    @scroll=${this._handleScroll}
                ></lit-virtualizer>
            </div>

            <button
                class="load-more-btn"
                ?hidden=${!this._showLoadMoreBtn}
                ?disabled=${this._isLoadingMore}
                @click=${this._handleLoadMoreClick}
            >${this._isLoadingMore ? msg('Loading...') : msg('↑ Load earlier messages')}</button>

            <button
                class="new-message-btn"
                ?hidden=${!this._showNewBtn}
                @click=${this._handleNewBtnClick}
            >${msg('↓ New messages')}</button>
        `;
    }

    // ── Render item routing ──

    /**
     * Build render items from the flat message list.
     *
     * Pairs toolcall_input + toolcall_output into a single ToolCallPair.
     * Output messages that are paired are excluded from the render list.
     * Error messages are routed to their own render type.
     *
     * Returns ordered render items: user | assistant | toolcall | error.
     */
    private _buildRenderItems(msgs: Message[]): RenderItem[] {
        const inputToOutput = new Map<string, Message>();
        for (const m of msgs) {
            if (m.content?.type === 'toolcall_output' && m.parentClientId) {
                inputToOutput.set(m.parentClientId, m);
            }
        }

        const items: RenderItem[] = [];

        for (const m of msgs) {
            if (m.content?.type === 'toolcall_output') {
                continue;
            }

            if (m.content?.type === 'error') {
                items.push({type: 'error', key: m.clientId, message: m});
            } else if (m.content?.type === 'toolcall_input') {
                items.push({
                    type: 'toolcall',
                    key: m.clientId,
                    pair: {input: m, output: inputToOutput.get(m.clientId)},
                });
            } else if (m.role === 'user') {
                items.push({type: 'user', key: m.clientId, message: m});
            } else {
                items.push({type: 'assistant', key: m.clientId, message: m});
            }
        }

        return items;
    }

    /**
     * Route render items to different message components by type.
     *
     * Uses switch + never exhaustiveness check so the compiler enforces
     * updating this method when new RenderItem types are added.
     *
     * Each message is wrapped in div.message-item for consistent width
     * and padding.
     *
     * @param item - The render item (after _buildRenderItems processing)
     * @param lastKey - Key of the last render item, used for is-last attribute
     *                  (only assistant messages need this, to hide trailing spacing)
     */
    private _renderMessageItem(item: RenderItem, lastKey: string | undefined) {
        switch (item.type) {
            case 'user':
                return html`
                    <div class="message-item">
                        <rtc-user-message
                            data-client-id=${item.message.clientId}
                            .message=${item.message}
                        ></rtc-user-message>
                    </div>
                `;
            case 'toolcall':
                return html`
                    <div class="message-item">
                        <rtc-toolcall-card
                            data-client-id=${item.pair.input.clientId}
                            .pair=${item.pair}
                        ></rtc-toolcall-card>
                    </div>
                `;
            case 'error':
                return html`
                    <div class="message-item">
                        <rtc-error-message
                            data-client-id=${item.message.clientId}
                            .message=${item.message}
                        ></rtc-error-message>
                    </div>
                `;
            case 'assistant':
                return html`
                    <div class="message-item">
                        <rtc-message
                            data-client-id=${item.message.clientId}
                            .message=${item.message}
                            ?is-last=${item.key === lastKey}
                        ></rtc-message>
                    </div>
                `;
            default: {
                const _exhaustive: never = item;
                console.warn('[RtcMessageList] Unknown render item type:', _exhaustive);
                return html``;
            }
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-message-list': RtcMessageList;
    }
}
