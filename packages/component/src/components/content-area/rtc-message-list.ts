/**
 * RTC Message List Component
 *
 * Renders messages in a scrollable container with timeline layout.
 * Uses @lit-labs/virtualizer for virtual scrolling with automatic
 * dynamic-height handling via ResizeObserver.
 *
 * This is a single-instance component. Session switching is handled by the
 * MessageController's data-level caching. Scroll position is preserved across
 * tab switches via MessageController's scroll position cache.
 *
 * ## Auto-scroll mechanism
 *
 * 1. **`firstUpdated()` handles initial mount** -- if a scroll position was saved
 *    for this session (tab switch), restore it; otherwise scroll to bottom.
 *
 * 2. **`updated()` reacts to context changes**:
 *    - `_ctx` changed (messages changed) -> if following, scroll to bottom.
 *    - Load-more (prepend) -> preserve scroll position via anchor.
 *
 * 3. **`_handleScroll` (template-bound) tracks scroll position** -- via RAF throttling:
 *    - Updates "New messages" button visibility based on distance from bottom
 *    - Auto-triggers `loadMore()` when scrollTop < threshold
 *
 * 4. **ResizeObserver (built into @lit-labs/virtualizer)** handles async content:
 *    - Markdown rendering, thinking expansion, tool-call card resizing
 *    - Scrolls to bottom only if `_shouldAutoScroll` is true.
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
import {MessageContext, type MessageContextValue} from '../../contexts/message.js';
import {SessionContext, type SessionContextValue} from '../../contexts/session.js';
import {SettingsContext, type SettingsContextValue} from '../../contexts/settings.js';
import type {MessageController} from '../../controllers/message.controller.js';
import type {Message} from '../../types/index.js';
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

    @consume({context: MessageContext, subscribe: true})
    @state()
    private _ctx: MessageContextValue = {
        state: {messages: [], hasMore: false, isLoadingMore: false},
        actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}, loadMore: async () => {}}
    };

    @consume({context: SessionContext, subscribe: true})
    @state()
    private _sessionCtx: SessionContextValue = {
        state: {sessions: [], currentSessionId: null},
        actions: {
            createSession: () => '',
            switchSession: () => {},
            renameSession: async () => ({ok: true, error: ''}),
            deleteSession: async () => ({ok: true, error: ''}),
            closeSession: async () => ({ok: true}),
            reopenSession: async () => ({ok: true}),
            reset: () => {},
            clearCurrentSession: () => {},
            setCurrentSession: () => {},
            setSessions: () => {},
        },
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

    @state()
    private _showNewBtn = false;

    @state()
    private _showLoadMoreBtn = false;

    /**
     * Whether the user intends to follow new content ("follow mode").
     *
     * This is a **mutable flag** representing user intent, NOT scroll position.
     * It is set by:
     * - `_handleNewBtnClick` -- user explicitly clicks "New messages" -> true
     * - Session switch (no saved scroll) -- user expects latest -> true
     * - Messages cleared -- fresh state -> true
     *
     * It is NOT set by `scrollToBottom()` -- system actions don't change intent.
     * This separation prevents async code from overwriting user intent.
     */
    private _shouldAutoScroll = true;

    /** Last visible message ID, used to determine if user is at the bottom. */
    private _lastVisibleMessageId: string | null = null;

    /** Previous last message ID, used to detect message appends. */
    private _prevLastMessageId: string | null = null;

    /** RAF throttle flag for _handleScroll. */
    private _scrollRafPending = false;

    /** Bound visibilitychange handler for cleanup. */
    private _boundOnVisibilityChange = this._onVisibilityChange.bind(this);

    /** Cached render items, computed in willUpdate(). */
    private _renderItems: RenderItem[] = [];

    /** Previous messages count, used to detect message truncation/clearing. */
    private _prevMessagesCount = 0;

    /** Previous session ID, used to detect session switches. */
    private _prevSessionId: string | null = null;

    /** Stable renderItem function reference. */
    private _renderItemFn = (item: RenderItem): TemplateResult => {
        const lastKey = this._renderItems[this._renderItems.length - 1]?.key;
        return this._renderMessageItem(item, lastKey);
    };

    /** Stable keyFunction reference. */
    private _keyFn = (item: RenderItem) => item.key;

    get messages(): Message[] {
        return this._ctx.state.messages;
    }

    /**
     * Expose the lit-virtualizer element for parent components.
     * Used by rtc-content-area to read firstVisibleIndex for scroll saving.
     */
    getVirtualizer(): LitVirtualizer | null {
        return this._virtualizerEl ?? null;
    }

    /**
     * Expose render items for parent components.
     * Used by rtc-content-area to map firstVisibleIndex to a message key.
     */
    getRenderItems(): RenderItem[] {
        return this._renderItems;
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
            this._virtualizerEl?.scrollToIndex(index, 'center');
        }
    }

    protected willUpdate(changed: Map<string, unknown>): void {
        const ctxChanged = changed.has('_ctx') || changed.has('messages');
        if (ctxChanged) {
            this._renderItems = this._buildRenderItems(this.messages);
        }
    }

    async firstUpdated() {
        await this.updateComplete;

        if (this._virtualizerEl?.layoutComplete) {
            try {
                await this._virtualizerEl.layoutComplete;
            } catch {
                // Layout incomplete doesn't block subsequent operations;
                // scroll methods handle null/undefined gracefully.
            }
        }

        // On initial mount: try to restore saved scroll position (tab switch),
        // or scroll to bottom (first visit to this session).
        const savedPosition = this._consumeSavedScrollPosition();
        if (savedPosition) {
            this._applyScrollRestore(savedPosition);
        } else {
            this._shouldAutoScroll = true;
            this._scrollToBottomWithRetry(false);
        }

        this._prevSessionId = this._sessionCtx.state.currentSessionId;

        document.addEventListener('visibilitychange', this._boundOnVisibilityChange);
    }

    /**
     * React to context changes after render.
     *
     * Handles messages changed (_ctx): scroll to bottom if following,
     * or preserve scroll position for load-more (prepend).
     *
     * Session switches are handled in firstUpdated() for new mounts.
     * For existing instances (no remount), the single-instance approach
     * means the component stays alive and data changes flow through _ctx.
     */
    updated(changed: Map<string, unknown>) {
        super.updated(changed);

        const density = this._settingsCtx.state.chat.density;
        this.setAttribute('data-density', density);

        // --- Messages changed: scroll if following ---
        if (changed.has('_ctx')) {
            if (this._anchorInfo) {
                // Load-more (prepend): preserve scroll position using anchor
                this._preserveScrollPosition();
                this._anchorInfo = null;
            } else if (this._shouldAutoScroll && this._lastVisibleMessageId === this._prevLastMessageId) {
                // User was viewing the last message; auto-scroll for new content
                this._scrollToBottomWithRetry();
            }
        }

        // --- Update load-more button visibility ---
        this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();

        // Track last message ID for next comparison
        const msgs = this._ctx.state.messages;
        this._prevLastMessageId = msgs.length > 0 ? msgs[msgs.length - 1].clientId : null;

        // Detect message clearing (session reset / clearMessages)
        if (changed.has('_ctx') && msgs.length === 0 && this._prevMessagesCount > 0) {
            this._shouldAutoScroll = true;
        }
        this._prevMessagesCount = msgs.length;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('visibilitychange', this._boundOnVisibilityChange);
    }

    /**
     * Read and consume the saved scroll position from MessageController.
     * Returns undefined if no position is saved for the current session.
     */
    private _consumeSavedScrollPosition(): {index: number; messageId: string} | undefined {
        if (!this.messageController || !this.sessionId) return undefined;
        return this.messageController.consumeScrollPosition(this.sessionId);
    }

    /**
     * Restore scroll position to the saved index after virtualizer layout completes.
     * Validates the message ID to guard against stale indices.
     */
    private async _applyScrollRestore(saved: {index: number; messageId: string}) {
        const el = this._virtualizerEl;
        if (!el) return;

        if (el.layoutComplete) {
            try {
                await el.layoutComplete;
            } catch {
                // Proceed even if layout is incomplete
            }
        }

        // Validate the saved message is still at the expected index
        if (saved.index < this._renderItems.length &&
            this._renderItems[saved.index].key === saved.messageId) {
            el.scrollToIndex(saved.index, 'start');
        }

        this._shouldAutoScroll = true;
        this._showNewBtn = false;
        this._showLoadMoreBtn = false;
    }

    /**
     * Visibility change handler.
     * When the page becomes visible again, scroll to bottom if following.
     */
    private _onVisibilityChange() {
        if (document.visibilityState === 'visible' && this._shouldAutoScroll) {
            requestAnimationFrame(() => {
                if (this._shouldAutoScroll) {
                    this._scrollToBottomWithRetry();
                }
            });
        }
    }

    private _isNearTop(): boolean {
        const el = this._virtualizerEl;
        if (!el) return false;
        return el.scrollTop < VIRTUAL_SCROLL_CONFIG.NEAR_TOP_THRESHOLD;
    }

    private _isNearBottom(): boolean {
        const el = this._virtualizerEl;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < VIRTUAL_SCROLL_CONFIG.SCROLL_END_THRESHOLD;
    }

    private async _handleLoadMoreClick() {
        if (this._ctx.state.isLoadingMore) return;

        // Safari rubber-band guard: scrollTop < 0 indicates bounce state
        const el = this._virtualizerEl;
        if (el && el.scrollTop < 0) {
            await new Promise(resolve => setTimeout(resolve, VIRTUAL_SCROLL_CONFIG.SAFARI_BOUNCE_DELAY));
            if (!el || el.scrollTop < 0) return;
        }

        this._showLoadMoreBtn = false;
        this._anchorInfo = this._captureAnchorInfo();
        await this._ctx.actions.loadMore();
    }

    /** Anchor info captured before loadMore for scroll position preservation. */
    private _anchorInfo: {clientId: string; visualTop: number} | null = null;

    /**
     * Capture the first visible message's clientId and its position
     * relative to the scroll container viewport.
     */
    private _captureAnchorInfo(): {clientId: string; visualTop: number} | null {
        const el = this._virtualizerEl;
        if (!el) return null;
        const scrollRect = el.getBoundingClientRect();
        const children = el.querySelectorAll('[data-client-id]');
        for (const child of children) {
            const rect = child.getBoundingClientRect();
            if (rect.top >= scrollRect.top - 10) {
                return {
                    clientId: child.getAttribute('data-client-id') ?? '',
                    visualTop: rect.top - scrollRect.top,
                };
            }
        }
        return null;
    }

    /**
     * After prepending older messages, scroll so the anchor message stays
     * at the same visual position within the viewport.
     */
    private _preserveScrollPosition() {
        const el = this._virtualizerEl;
        if (!el || !this._anchorInfo) return;

        const anchorId = this._anchorInfo.clientId;
        const desiredVisualTop = this._anchorInfo.visualTop;

        this.updateComplete.then(async () => {
            if (el.layoutComplete) {
                try {
                    await el.layoutComplete;
                } catch {
                    // Layout incomplete: keep current anchor position as-is
                }
            }

            const anchorEl = el.querySelector(`[data-client-id="${anchorId}"]`) as HTMLElement | null;
            if (anchorEl) {
                const scrollRect = el.getBoundingClientRect();
                const anchorRect = anchorEl.getBoundingClientRect();
                const currentVisualTop = anchorRect.top - scrollRect.top;
                el.scrollTop += (currentVisualTop - desiredVisualTop);
            }

            this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();
        });
    }

    private _handleNewBtnClick() {
        this._shouldAutoScroll = true;
        this._scrollToBottomWithRetry();
    }

    /**
     * Smooth scroll to bottom with retry loop.
     *
     * lit-virtualizer may render asynchronously, requiring multiple scroll
     * attempts to reach the true bottom.
     *
     * @param smooth - Whether to use smooth scrolling animation. Pass false
     *                 for initial load to avoid visible scrolling.
     */
    private _scrollToBottomWithRetry(smooth: boolean = true) {
        const el = this._virtualizerEl;
        if (!el) return;

        let attempts = 0;
        const maxAttempts = 5;

        const tryScroll = () => {
            if (attempts >= maxAttempts) return;

            const behavior = attempts === 0 ? 'instant' : (smooth ? 'smooth' : 'instant');
            el.scrollTo({top: el.scrollHeight, behavior});

            setTimeout(() => {
                if (!this._isNearBottom()) {
                    attempts++;
                    tryScroll();
                }
            }, 400);
        };

        tryScroll();
    }

    render() {
        void this._localeCtx.locale;

        return html`
            <lit-virtualizer
                class="message-list-scroll"
                scroller
                .items=${this._renderItems}
                .renderItem=${this._renderItemFn}
                .keyFunction=${this._keyFn}
                @scroll=${this._handleScroll}
            ></lit-virtualizer>

            <button
                class="load-more-btn"
                ?hidden=${!this._showLoadMoreBtn}
                ?disabled=${this._ctx.state.isLoadingMore}
                @click=${this._handleLoadMoreClick}
            >${this._ctx.state.isLoadingMore ? msg('Loading...') : msg('↑ Load earlier messages')}</button>

            <button
                class="new-message-btn"
                ?hidden=${!this._showNewBtn}
                @click=${this._handleNewBtnClick}
            >${msg('↓ New messages')}</button>
        `;
    }

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
     * Handle scroll events from the virtualizer.
     *
     * Responsibilities:
     * 1. RAF-throttled button visibility updates
     * 2. Auto-trigger loadMore when near top
     * 3. Update last visible message ID for auto-scroll decisions
     */
    private _handleScroll = () => {
        if (!this._virtualizerEl) return;

        this._updateLastVisibleMessageId();

        if (!this._scrollRafPending) {
            this._scrollRafPending = true;
            requestAnimationFrame(() => {
                this._scrollRafPending = false;
                this._updateButtonVisibility();
            });
        }

        if (this._virtualizerEl.scrollTop < VIRTUAL_SCROLL_CONFIG.AUTO_LOAD_MORE_THRESHOLD
            && this._ctx.state.hasMore) {
            this._handleLoadMoreClick();
        }
    };

    /**
     * Update auto-scroll state by checking if the last message is visible.
     *
     * Conditions:
     * 1. Last message is rendered in the DOM (within virtualizer's viewport)
     * 2. Last message's bottom edge is within the viewport
     */
    private _updateLastVisibleMessageId() {
        const el = this._virtualizerEl;
        if (!el) {
            this._shouldAutoScroll = false;
            return;
        }

        const msgs = this._ctx.state.messages;
        const lastMsgId = msgs.length > 0 ? msgs[msgs.length - 1].clientId : null;
        if (!lastMsgId) {
            this._shouldAutoScroll = false;
            return;
        }

        const lastEl = el.querySelector(`[data-client-id="${lastMsgId}"]`);
        if (!lastEl) {
            this._shouldAutoScroll = false;
            return;
        }

        const rect = lastEl.getBoundingClientRect();
        const scrollRect = el.getBoundingClientRect();

        if (rect.bottom <= scrollRect.bottom) {
            this._lastVisibleMessageId = lastMsgId;
            this._shouldAutoScroll = true;
        } else {
            this._shouldAutoScroll = false;
        }
    }

    /**
     * Update button visibility based on scroll position.
     * Called via RAF throttle from _handleScroll.
     */
    private _updateButtonVisibility() {
        this._showNewBtn = !this._isNearBottom();
        this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();
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
