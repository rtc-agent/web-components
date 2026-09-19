/**
 * RTC Message List Component
 *
 * Renders messages in a scrollable container with timeline layout.
 * Each `<rtc-message-list>` subscribes directly to `MessageRepository` for a
 * specific `sessionId`. This allows multiple instances to coexist (e.g. one per
 * open tab) without relying on a shared `MessageContext`.
 *
 * ## Auto-scroll mechanism
 *
 * 1. **`updated()` reacts to message changes**:
 *    - If `_shouldAutoScroll` is true, scroll to bottom.
 *
 * 2. **`_onScroll` tracks user intent** — purely based on scroll position:
 *    - `distanceFromBottom < 60` → following (matches "new messages" button zone)
 *    - `distanceFromBottom ≥ 60` → not following
 *    Programmatic scrolls are guarded by `_programmaticScrollCount` to prevent
 *    sub-pixel rounding from incorrectly disabling follow intent.
 *
 * 3. **`overflow-anchor: none` (CSS)** — prevents the browser from adjusting
 *    scrollTop when content above changes. Ensures `_onScroll` only fires for
 *    user-initiated scrolls and programmatic `scrollTo()`.
 *
 * 4. **ResizeObserver handles async content** — fires when inner container size
 *    changes (Markdown rendering, thinking expansion, tool-call cards). Scrolls
 *    to bottom only if `_shouldAutoScroll` is true.
 *
 * @element rtc-message-list
 * @csspart scroll - The scroll container
 * @csspart inner - The inner message container
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-message-list.styles.js';
import {SettingsContext, type SettingsContextValue} from '../../contexts/settings.js';
import type {MessageController} from '../../controllers/message.controller.js';
import type {Message, MessageState} from '../../types/index.js';
import './rtc-message.js';
import './rtc-user-message.js';
import './rtc-toolcall-card.js';
import './rtc-error-message.js';
import {MessageVirtualScroll, type WindowBoundary} from '../../utils/message-virtual-scroll.js';

@localized()
@customElement('rtc-message-list')
export class RtcMessageList extends LitElement {
    static styles = styles;

    /** Session ID for this message list instance. */
    @property({type: String})
    sessionId: string | null = null;

    /** Message controller for accessing repository. */
    @property({attribute: false})
    messageController?: MessageController;

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

    @state()
    private _showNewBtn = false;

    @state()
    private _userAtBottom = true;

    @state()
    private _showLoadMoreBtn = false;

    /**
     * Whether the user intends to follow new content ("follow mode").
     *
     * This is a **mutable flag** representing user intent, NOT scroll position.
     * It is set by:
     * - `_onScroll` — when user scrolls to bottom → true, scrolls up → false
     * - `_handleNewBtnClick` — user explicitly clicks "New messages" → true
     * - Session switch — user expects to see latest messages → true
     *
     * It is NOT set by `_scrollToBottom()` — system actions don't change intent.
     * This separation prevents async code from overwriting user intent.
     *
     * Consumed by: `updated()`, `_scheduleScroll()` callback, ResizeObserver,
     * `_onVisibilityChange`.
     */
    private _shouldAutoScroll = true;

    /**
     * Guard counter: incremented during programmatic `scrollTo()` calls.
     * When > 0, `_onScroll` skips updating `_shouldAutoScroll` to prevent
     * sub-pixel rounding errors from incorrectly disabling follow intent.
     *
     * Uses a counter (not boolean) to handle multiple concurrent programmatic
     * scrolls (e.g., from _scheduleScroll + ResizeObserver firing in quick succession).
     * Each scroll increments; a 50ms timeout decrements. This covers async scroll
     * events that might fire after `scrollTo()` returns.
     */
    private _programmaticScrollCount = 0;

    private _scrollEl?: HTMLElement;
    private _resizeObserver?: ResizeObserver;
    private _resizeDebounceTimer?: number;

    /** Virtual scroll instance for efficient rendering */
    private _virtualScroll?: MessageVirtualScroll<Message>;

    /** Flag to prevent ResizeObserver feedback loop during virtual scroll operations */
    private _isVirtualScrollOperation = false;

    /** Bound visibilitychange handler for cleanup. */
    private _boundOnVisibilityChange = this._onVisibilityChange.bind(this);

    /**
     * Monotonically increasing version counter for scroll debouncing.
     * Each scroll request increments and captures the current value.
     * Before executing, the async scroll checks if its version is still current.
     * A newer request invalidates older ones -- no boolean flag needed.
     */
    private _scrollVersion = 0;

    get messages(): Message[] {
        return this._messages;
    }

    /**
     * Public API: scroll to the bottom of the message list.
     * Called by parent components (e.g., rtc-content-area) when needed.
     */
    scrollToBottom() {
        this._shouldAutoScroll = true;
        this._scrollToBottom();
    }

    /**
     * Public API: scroll to a specific message by clientId.
     * Called by parent components to navigate to a particular message.
     */
    scrollToMessage(clientId: string) {
        if (!this._scrollEl) return;
        const el = this._scrollEl.querySelector(`[data-client-id="${clientId}"]`) as HTMLElement | null;
        if (el) {
            el.scrollIntoView({behavior: 'smooth', block: 'center'});
            // Disable follow mode since user is viewing a specific message
            this._shouldAutoScroll = false;
        }
    }

    firstUpdated() {
        this._scrollEl = this.shadowRoot!.querySelector('.message-list-scroll') as HTMLElement;
        const innerEl = this.shadowRoot!.querySelector('.message-list-inner') as HTMLElement;

        // Defeat browser scroll restoration on initial mount: force scrollTop to 0
        // so the first `updated()` cycle can scroll cleanly to the bottom.
        if (this._scrollEl) {
            this._scrollEl.scrollTop = 0;
            // Add scroll listener for UI state updates (button visibility, auto-scroll intent)
            this._scrollEl.addEventListener('scroll', this._onScroll, {passive: true});
        }

        // Initialize virtual scroll
        if (this._scrollEl && innerEl) {
            this._virtualScroll = new MessageVirtualScroll<Message>({
                scrollContainer: this._scrollEl,
                innerContainer: innerEl,
                renderItem: (msg, index) => this._renderMessageElement(msg, index),
                getItemId: (msg) => msg.clientId,
                onLoadMore: (direction, boundary) => this._handleVirtualScrollLoadMore(direction, boundary),
                query: '[data-client-id]',
                preloadThreshold: 300, // Telegram uses 300px
                bufferMessages: 20,
                sliceInterval: 3000,
            });
        }

        // Subscribe to repository for this session
        this._subscribeToSession();

        // ResizeObserver: safety net for post-render content growth.
        // Fires when inner container size changes (streaming chunks, late Markdown,
        // thinking-block expansion). Uses debounced scroll to handle async renders
        // (e.g., Markdown that renders after the initial updateComplete).
        // IMPORTANT: Ignore resizes from virtual scroll's own operations to prevent feedback loop.
        if (innerEl) {
            this._resizeObserver = new ResizeObserver(() => {
                // Ignore resizes from virtual scroll operations (prependItems/appendItems)
                if (this._isVirtualScrollOperation) return;

                if (!this._shouldAutoScroll) return;
                // Debounced compensation: handles late async renders (Markdown, etc.)
                clearTimeout(this._resizeDebounceTimer);
                this._resizeDebounceTimer = window.setTimeout(() => {
                    if (this._shouldAutoScroll && !this._isVirtualScrollOperation) {
                        this._scrollToBottom();
                    }
                }, 100);
            });
            this._resizeObserver.observe(innerEl);
        }

        // Visibility change: when the page becomes visible again (e.g., user switches
        // back to this browser tab), scroll to bottom if following. This handles the
        // case where the user was away and content may have changed.
        document.addEventListener('visibilitychange', this._boundOnVisibilityChange);
    }

    /**
     * Subscribe to MessageRepository for the current session.
     * Called on firstUpdated and when sessionId changes.
     */
    private _subscribeToSession() {
        if (!this.sessionId || !this.messageController) return;

        // Unsubscribe from previous session
        this._subscription?.();
        this._subscription = undefined;

        // Clear virtual scroll for new session
        this._virtualScroll?.clear();
        this._messages = [];

        try {
            // Subscribe to repository for this session
            this._subscription = this.messageController.repository.subscribe(
                this.sessionId,
                (data: MessageState) => {
                    this._handleMessagesUpdate(data);
                },
            );

            // Trigger initial data load
            this.messageController.fetchInitialMessages(this.sessionId);
        } catch (err) {
            console.debug('[rtc-message-list] Repository not ready:', (err as Error).message);
        }
    }

    /**
     * Handle messages update from repository subscription.
     * Converts repository changes to virtual scroll operations.
     */
    private _handleMessagesUpdate(data: MessageState) {
        const oldMessages = this._messages;
        const newMessages = data.messages;

        if (!this._virtualScroll) {
            this._messages = newMessages;
            this._hasMore = data.hasMore;
            this._isLoadingMore = data.isLoadingMore;
            return;
        }

        if (oldMessages.length === 0 && newMessages.length > 0) {
            // Initial load
            this._isVirtualScrollOperation = true;
            this._virtualScroll.setItems(newMessages);
            if (this._shouldAutoScroll) {
                this._virtualScroll.scrollToBottom();
            }
            this._isVirtualScrollOperation = false;
        } else if (newMessages.length !== oldMessages.length) {
            // Detect changes: prepend, append, or both
            const oldSet = new Set(oldMessages.map(m => m.clientId));

            // Find prepended messages (in new but before old first)
            const prepended: Message[] = [];
            const appended: Message[] = [];

            const oldFirstId = oldMessages[0]?.clientId;
            const oldLastId = oldMessages[oldMessages.length - 1]?.clientId;

            for (const m of newMessages) {
                if (!oldSet.has(m.clientId)) {
                    // Check if it's before old first or after old last
                    const newIdx = newMessages.indexOf(m);
                    const oldFirstIdx = oldFirstId ? newMessages.findIndex(nm => nm.clientId === oldFirstId) : -1;
                    const oldLastIdx = oldLastId ? newMessages.findIndex(nm => nm.clientId === oldLastId) : -1;

                    if (oldFirstIdx === -1 || newIdx < oldFirstIdx) {
                        prepended.push(m);
                    } else if (oldLastIdx === -1 || newIdx > oldLastIdx) {
                        appended.push(m);
                    }
                }
            }

            if (prepended.length > 0 || appended.length > 0) {
                this._isVirtualScrollOperation = true;
                if (prepended.length > 0) {
                    this._virtualScroll.prependItems(prepended);
                }
                if (appended.length > 0) {
                    this._virtualScroll.appendItems(appended);
                }
                this._isVirtualScrollOperation = false;
            }
        }

        this._messages = newMessages;
        this._hasMore = data.hasMore;
        this._isLoadingMore = data.isLoadingMore;

        // Mark as fully loaded if repository says no more
        if (this._hasMore === false) {
            this._virtualScroll.setFullyLoaded('top', true);
        }
    }

    /**
     * Auto-scroll decision point.
     *
     * The component is responsible for its own scrolling. It does not analyze
     * what kind of change happened (growth, shrink, reorder, toolcall merge, etc.).
     * It only asks two questions:
     *
     * 1. **Did messages change?** (`_messages` changed) → if following, scroll to bottom.
     * 2. **Did session change?** (`sessionId` changed) → reset follow intent to true,
     *    then scroll to bottom (user expects to see latest messages in a new session).
     *
     * Async content rendering (Markdown, tool call expansion) is handled by
     * ResizeObserver, which scrolls when the inner container size changes.
     *
     * Load-more (prepend) is a special case: preserve scroll position via anchor.
     */
    updated(changed: Map<string, unknown>) {
        super.updated(changed);

        // Set density attribute for CSS styling
        const density = this._settingsCtx.state.chat.density;
        this.setAttribute('data-density', density);

        // --- Session switch: clear virtual scroll, re-subscribe, scroll to bottom ---
        if (changed.has('sessionId')) {
            this._virtualScroll?.clear();
            this._subscribeToSession();
            this._shouldAutoScroll = true;
            this._virtualScroll?.scrollToBottom();
            this._userAtBottom = true;
            this._showNewBtn = false;
        }

        // --- Messages changed: scroll if following ---
        // Virtual scroll handles its own scroll preservation via ScrollSaver.
        // We only need to scroll to bottom for new messages (append).
        if (changed.has('_messages')) {
            if (this._shouldAutoScroll) {
                this._scheduleScroll();
            }
        }

        // --- Update load-more button visibility ---
        this._showLoadMoreBtn = this._hasMore && this._isNearTop();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._scrollEl?.removeEventListener('scroll', this._onScroll);
        this._resizeObserver?.disconnect();
        clearTimeout(this._resizeDebounceTimer);
        document.removeEventListener('visibilitychange', this._boundOnVisibilityChange);
        this._subscription?.();
        this._subscription = undefined;
        this._virtualScroll?.dispose();
        this._virtualScroll = undefined;
    }

    /**
     * Schedule a scroll-to-bottom after the current render completes.
     *
     * Uses a version counter for clean debouncing:
     * - Each call increments `_scrollVersion`
     * - The async callback captures its version
     * - If version is stale when callback runs, a newer request has superseded it
     *
     * Waits for:
     * 1. `this.updateComplete` -- this component's render is done (new message
     *    element is in the DOM)
     * 2. All child message elements' `updateComplete` -- their first render
     *    (empty content for async Markdown, complete for sync components)
     *
     * Note: async Markdown rendering (marked + DOMPurify + highlight.js) happens
     * AFTER the child's first `updateComplete` resolves. The ResizeObserver is the
     * safety net that scrolls again when the content actually renders and the inner
     * container size changes.
     */
    private _scheduleScroll() {
        const version = ++this._scrollVersion;

        this.updateComplete.then(async () => {
            if (version !== this._scrollVersion) return;

            // Wait for all message children to finish their first render
            const msgEls = this.shadowRoot!.querySelectorAll('rtc-message, rtc-user-message, rtc-toolcall-card, rtc-error-message');
            if (msgEls.length > 0) {
                await Promise.all(
                    Array.from(msgEls).map(el => (el as LitElement).updateComplete)
                );
            }

            if (version !== this._scrollVersion) return;
            // Re-check follow intent before scrolling — user may have scrolled
            // up while we were waiting for updateComplete.
            if (!this._shouldAutoScroll) return;
            this._scrollToBottom();
        });
    }

    private _scrollToBottom() {
        if (!this._scrollEl) return;
        // Increment guard counter so _onScroll doesn't override _userAtBottom
        // with a potentially incorrect value due to sub-pixel rounding.
        this._programmaticScrollCount++;
        this._scrollEl.scrollTo({top: this._scrollEl.scrollHeight, behavior: 'auto'});
        // Decrement after a short delay to cover async scroll events.
        // scrollTo({behavior: 'auto'}) typically fires scroll events synchronously,
        // but some browsers may defer them. 50ms covers layout/scroll batching.
        window.setTimeout(() => { this._programmaticScrollCount--; }, 50);
        // NOTE: _scrollToBottom() does NOT set _shouldAutoScroll.
        // System actions (auto-scroll) should not change user intent.
        // Only user actions (_onScroll, _handleNewBtnClick, session switch) set it.
        this._userAtBottom = true;
        this._showNewBtn = false;
    }

    private _onScroll = () => {
        if (!this._scrollEl) return;
        const {scrollHeight, scrollTop, clientHeight} = this._scrollEl;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        // Button visibility: generous threshold (60px)
        // Shows "new messages" button early so user can click before reaching absolute bottom
        const atBottom = distanceFromBottom < 60;

        // Follow intent: always update based on scroll position.
        // The 60px threshold is large enough to be immune to sub-pixel rounding,
        // so we don't need the _programmaticScrollCount guard here.
        // This ensures user scroll-up is immediately respected, even during
        // streaming when programmatic scrolls happen frequently.
        this._shouldAutoScroll = atBottom;

        // UI state (_userAtBottom, _showNewBtn): guarded by _programmaticScrollCount
        // to prevent sub-pixel rounding from causing flicker during programmatic scrolls.
        if (this._programmaticScrollCount === 0) {
            this._userAtBottom = atBottom;
            this._showNewBtn = !atBottom;
        }

        // Show/hide load-more button based on scroll position
        this._showLoadMoreBtn = this._hasMore && this._isNearTop();
    };

    /**
     * Visibility change handler.
     *
     * When the page becomes visible again (e.g., user switches back to this browser
     * tab after looking at other tabs or applications), scroll to bottom if the user
     * intends to follow. This ensures the latest content is visible when the user
     * returns, especially after content may have changed while the page was hidden.
     */
    private _onVisibilityChange() {
        if (document.visibilityState === 'visible' && this._shouldAutoScroll) {
            // Delay slightly to allow any pending renders to complete
            requestAnimationFrame(() => {
                if (this._shouldAutoScroll) {
                    this._scrollToBottom();
                }
            });
        }
    }

    private _isNearTop(): boolean {
        if (!this._scrollEl) return false;
        return this._scrollEl.scrollTop < 60;
    }

    /**
     * Handle virtual scroll's onLoadMore callback.
     * Loads more messages from repository when scrolling near edges.
     */
    private async _handleVirtualScrollLoadMore(
        direction: 'top' | 'bottom',
        boundary: WindowBoundary
    ): Promise<Message[]> {
        if (!this.sessionId || !this.messageController) return [];

        const beforeMessages = [...this._messages];

        try {
            if (direction === 'top') {
                if (!boundary.firstId) return [];
                await this.messageController.loadMoreForSession(this.sessionId);
            } else {
                // Bottom loading not implemented yet
                return [];
            }

            // Wait for repository subscription to update _messages
            await this.updateComplete;

            // Find newly loaded messages (in _messages but not in beforeMessages)
            const beforeSet = new Set(beforeMessages.map(m => m.clientId));
            const newMessages = this._messages.filter(m => !beforeSet.has(m.clientId));

            // Mark as fully loaded if no new messages and repository says no more
            if (newMessages.length === 0 && !this._hasMore) {
                this._virtualScroll?.setFullyLoaded(direction, true);
            }

            return newMessages;
        } catch (err) {
            console.error('[rtc-message-list] loadMore failed:', err);
            return [];
        }
    }

    /**
     * Render a message element for virtual scroll.
     * Toolcall input and output are rendered separately (no pairing).
     */
    private _renderMessageElement(msg: Message, index: number): HTMLElement {
        const isLast = index === this._messages.length - 1;

        // Error messages
        if (msg.content?.type === 'error') {
            const el = document.createElement('rtc-error-message');
            el.setAttribute('data-client-id', msg.clientId);
            (el as any).message = msg;
            return el;
        }

        // Toolcall input and output rendered separately (no pairing)
        if (msg.content?.type === 'toolcall_input' || msg.content?.type === 'toolcall_output') {
            const el = document.createElement('rtc-message');
            el.setAttribute('data-client-id', msg.clientId);
            (el as any).message = msg;
            if (isLast) {
                el.setAttribute('is-last', '');
            }
            return el;
        }

        // User messages
        if (msg.role === 'user') {
            const el = document.createElement('rtc-user-message');
            el.setAttribute('data-client-id', msg.clientId);
            (el as any).message = msg;
            return el;
        }

        // Assistant messages
        const el = document.createElement('rtc-message');
        el.setAttribute('data-client-id', msg.clientId);
        (el as any).message = msg;
        if (isLast) {
            el.setAttribute('is-last', '');
        }
        return el;
    }

    private _handleLoadMoreClick = async () => {
        // Guard: prevent concurrent load-more requests
        if (this._isLoadingMore || !this._virtualScroll) return;

        // Trigger virtual scroll's load-more by simulating scroll to top
        // (virtual scroll will auto-load when near edge)
        const stats = this._virtualScroll.getStats();
        if (stats.firstId) {
            await this._handleVirtualScrollLoadMore('top', {
                firstId: stats.firstId,
                lastId: stats.lastId,
            });
        }
    };

    private _handleNewBtnClick = () => {
        if (this._scrollEl) {
            // Smooth scroll is async (animation over ~500ms). Increment the guard
            // counter to prevent _onScroll from disabling follow intent during the animation.
            this._programmaticScrollCount++;
            this._scrollEl.scrollTo({top: this._scrollEl.scrollHeight, behavior: 'smooth'});
            // Decrement counter after animation completes
            window.setTimeout(() => { this._programmaticScrollCount--; }, 500);
        }
        // User explicitly clicked "New messages" → enable follow mode.
        this._shouldAutoScroll = true;
        this._userAtBottom = true;
        this._showNewBtn = false;
    };

    render() {
        void this._localeCtx.locale;
        // _userAtBottom is a @state driving re-render on scroll; consumed implicitly.
        void this._userAtBottom;
        const isLoadingMore = this._isLoadingMore;

        // Virtual scroll manages DOM elements directly.
        // render() only provides the container structure.
        return html`
            <div class="message-list-scroll" part="scroll">
                <div class="message-list-inner" part="inner">
                    <!-- MessageVirtualScroll dynamically inserts message elements here -->
                </div>
            </div>
            <button
                class="load-more-btn"
                ?hidden=${!this._showLoadMoreBtn}
                ?disabled=${isLoadingMore}
                @click=${this._handleLoadMoreClick}
                aria-label="Load earlier messages"
            >${isLoadingMore ? msg('Loading...') : msg('↑ Load earlier messages')}</button>
            <button
                class="new-message-btn"
                ?hidden=${!this._showNewBtn}
                @click=${this._handleNewBtnClick}
            >${msg('↓ New messages')}</button>
        `;
    }

}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-message-list': RtcMessageList;
    }
}
