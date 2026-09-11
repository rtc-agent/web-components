/**
 * RTC Message List Component
 *
 * Renders messages in a scrollable container with timeline layout.
 * The component is self-responsible for auto-scrolling — it does not analyze
 * what kind of change happened (new message, toolcall output, reorder, etc.).
 *
 * ## Auto-scroll mechanism
 *
 * 1. **`updated()` reacts to context changes** — two triggers:
 *    - `_sessionCtx` changed (session switch) → reset follow intent to true
 *    - `_ctx` changed (messages changed) → scroll to bottom if following
 *    No change-type detection. No growth/shrink/reorder analysis.
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
import {customElement, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {repeat} from 'lit/directives/repeat.js';
import {styles} from './rtc-message-list.styles.js';
import {MessageContext, type MessageContextValue} from '../../contexts/message.js';
import {SessionContext, type SessionContextValue} from '../../contexts/session.js';
import {SettingsContext, type SettingsContextValue} from '../../contexts/settings.js';
import type {Message} from '../../types/index.js';
import './rtc-message.js';
import './rtc-user-message.js';
import './rtc-toolcall-card.js';
import type {ToolCallPair} from './rtc-toolcall-card.js';

@localized()
@customElement('rtc-message-list')
export class RtcMessageList extends LitElement {
    static styles = styles;

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
            reset: () => {},
            clearCurrentSession: () => {},
            setCurrentSession: () => {},
            setSessions: () => {},
        },
    };

    /** Previous session ID, used to detect session switches (tab activation). */
    private _prevSessionId: string | null = null;

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
    private _userAtBottom = true;

    @state()
    private _showLoadMoreBtn = false;

    /**
     * User intent to follow new content.
     *
     * Set by `_onScroll` based on `distanceFromBottom`:
     * - `distanceFromBottom < 60` → true (user is in the "follow zone")
     * - `distanceFromBottom ≥ 60` → false (user scrolled up to read history)
     *
     * The 60px threshold matches the "new messages" button visibility, creating
     * a consistent "follow zone": when the button is hidden, auto-scroll is active.
     *
     * With `overflow-anchor: none`, content growth does NOT trigger scroll events,
     * so `_shouldAutoScroll` only changes on: (a) user scrolls, (b) programmatic
     * `scrollTo()` (which lands at bottom → true).
     *
     * Consumed by: `updated()` (new message growth decision), ResizeObserver
     * (async content rendering), `_onVisibilityChange` (tab re-focus).
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
        return this._ctx.state.messages;
    }

    firstUpdated() {
        this._scrollEl = this.shadowRoot!.querySelector('.message-list-scroll') as HTMLElement;
        this._scrollEl?.addEventListener('scroll', this._onScroll);

        // Defeat browser scroll restoration on initial mount: force scrollTop to 0
        // so the first `updated()` cycle can scroll cleanly to the bottom.
        if (this._scrollEl) {
            this._scrollEl.scrollTop = 0;
        }
        // Snapshot initial session ID so we can detect future switches
        this._prevSessionId = this._sessionCtx.state.currentSessionId;

        // ResizeObserver: safety net for post-render content growth.
        // Fires when inner container size changes (streaming chunks, late Markdown,
        // thinking-block expansion). Uses debounced scroll to handle async renders
        // (e.g., Markdown that renders after the initial updateComplete).
        const inner = this.shadowRoot!.querySelector('.message-list-inner') as HTMLElement;
        if (inner) {
            this._resizeObserver = new ResizeObserver(() => {
                if (!this._shouldAutoScroll) return;
                // Immediate scroll
                this._scrollToBottom();
                // Debounced compensation: handles late async renders (Markdown, etc.)
                // that complete after the ResizeObserver fires.
                clearTimeout(this._resizeDebounceTimer);
                this._resizeDebounceTimer = window.setTimeout(() => {
                    if (this._shouldAutoScroll) {
                        this._scrollToBottom();
                    }
                }, 100);
            });
            this._resizeObserver.observe(inner);
        }

        // Visibility change: when the page becomes visible again (e.g., user switches
        // back to this browser tab), scroll to bottom if following. This handles the
        // case where the user was away and content may have changed.
        document.addEventListener('visibilitychange', this._boundOnVisibilityChange);
    }

    /**
     * Auto-scroll decision point.
     *
     * The component is responsible for its own scrolling. It does not analyze
     * what kind of change happened (growth, shrink, reorder, toolcall merge, etc.).
     * It only asks two questions:
     *
     * 1. **Did messages change?** (`_ctx` changed) → if following, scroll to bottom.
     * 2. **Did session change?** (`_sessionCtx` changed) → reset follow intent to true,
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

        // --- Session switch: reset follow intent ---
        // When the user opens/switches to a different session, they expect to see
        // the latest messages. Reset follow intent so subsequent message changes
        // will auto-scroll.
        const currSessionId = this._sessionCtx.state.currentSessionId;
        if (changed.has('_sessionCtx') && currSessionId !== this._prevSessionId) {
            this._prevSessionId = currSessionId;
            this._shouldAutoScroll = true;
            this._userAtBottom = true;
            this._showNewBtn = false;
        }

        // --- Messages changed: scroll if following ---
        // We don't care WHAT changed (new message, toolcall output, reorder, etc.).
        // If the user wants to follow, scroll to bottom. ResizeObserver handles
        // async content rendering (Markdown, thinking blocks, etc.).
        if (changed.has('_ctx')) {
            if (this._anchorInfo) {
                // Load-more (prepend): preserve scroll position using anchor
                this._preserveScrollPosition();
                this._anchorInfo = null;
            } else if (this._shouldAutoScroll) {
                // Normal change (append, update, etc.): scroll to bottom
                this._scheduleScroll();
            }
        }

        // --- Update load-more button visibility ---
        this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._scrollEl?.removeEventListener('scroll', this._onScroll);
        this._resizeObserver?.disconnect();
        clearTimeout(this._resizeDebounceTimer);
        document.removeEventListener('visibilitychange', this._boundOnVisibilityChange);
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
            const msgEls = this.shadowRoot!.querySelectorAll('rtc-message, rtc-user-message');
            if (msgEls.length > 0) {
                await Promise.all(
                    Array.from(msgEls).map(el => (el as LitElement).updateComplete)
                );
            }

            if (version !== this._scrollVersion) return;
            this._scrollToBottom();
        });
    }

    private _scrollToBottom() {
        if (!this._scrollEl) return;
        // Increment guard counter so _onScroll doesn't override _shouldAutoScroll
        // with a potentially incorrect value due to sub-pixel rounding.
        this._programmaticScrollCount++;
        this._scrollEl.scrollTo({top: this._scrollEl.scrollHeight, behavior: 'auto'});
        // Decrement after a short delay to cover async scroll events.
        // scrollTo({behavior: 'auto'}) typically fires scroll events synchronously,
        // but some browsers may defer them. 50ms covers layout/scroll batching.
        window.setTimeout(() => { this._programmaticScrollCount--; }, 50);
        // Sync intent state: programmatic scroll means we're following.
        this._shouldAutoScroll = true;
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
        this._userAtBottom = atBottom;
        this._showNewBtn = !atBottom;

        // Auto-scroll intent: only update on USER-initiated scrolls.
        // Programmatic scrolls (from _scrollToBottom) increment a guard counter
        // to prevent sub-pixel rounding errors from incorrectly disabling follow intent.
        //
        // With `overflow-anchor: none` on the scroll container, content growth
        // does NOT change scrollTop, so no scroll event fires during async renders
        // (Markdown, thinking expansion, tool-call cards). This means _onScroll
        // only fires for: (1) user-initiated scrolls, (2) programmatic scrollTo().
        //
        // Threshold: 60px (same as button visibility). This creates a "follow zone":
        // - User scrolls up beyond 60px → intent disabled (reading history)
        // - User scrolls back within 60px → intent re-enabled (ready to follow)
        // - Programmatic scrolls → intent always enabled (guard counter active)
        // The generous threshold accounts for sub-pixel rounding and users who
        // scroll "close to" the bottom without hitting the exact pixel.
        if (this._programmaticScrollCount === 0) {
            this._shouldAutoScroll = distanceFromBottom < 60;
        }

        // Show/hide load-more button based on scroll position
        this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();
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

    private async _handleLoadMoreClick() {
        this._showLoadMoreBtn = false;

        // Record the anchor element and its visual position before loading
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
        if (!this._scrollEl) return null;
        const scrollRect = this._scrollEl.getBoundingClientRect();
        const children = this._scrollEl.querySelectorAll('[data-client-id]');
        for (const el of children) {
            const rect = el.getBoundingClientRect();
            // First child whose top is at or below the scroll container's top
            if (rect.top >= scrollRect.top - 10) {
                return {
                    clientId: el.getAttribute('data-client-id') ?? '',
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
        if (!this._scrollEl || !this._anchorInfo) return;

        const anchorId = this._anchorInfo.clientId;
        const desiredVisualTop = this._anchorInfo.visualTop;

        this.updateComplete.then(async () => {
            // Wait for child message elements to render
            const msgEls = this.shadowRoot!.querySelectorAll('rtc-message, rtc-user-message, rtc-toolcall-card');
            if (msgEls.length > 0) {
                await Promise.all(
                    Array.from(msgEls).map(el => (el as LitElement).updateComplete)
                );
            }

            if (!this._scrollEl) return;

            // Find the anchor element after prepend
            const anchorEl = this._scrollEl.querySelector(`[data-client-id="${anchorId}"]`) as HTMLElement | null;
            if (anchorEl) {
                // Compute current visual position of anchor
                const scrollRect = this._scrollEl.getBoundingClientRect();
                const anchorRect = anchorEl.getBoundingClientRect();
                const currentVisualTop = anchorRect.top - scrollRect.top;

                // Adjust scrollTop so anchor returns to its pre-load visual position
                this._scrollEl.scrollTop += (currentVisualTop - desiredVisualTop);
            }

            // Re-evaluate load-more button after scroll adjustment
            this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();
        });
    }

    private _handleNewBtnClick() {
        if (this._scrollEl) {
            // Smooth scroll is async (animation over ~500ms). Increment the guard
            // counter to prevent _onScroll from disabling follow intent during the animation.
            this._programmaticScrollCount++;
            this._scrollEl.scrollTo({top: this._scrollEl.scrollHeight, behavior: 'smooth'});
            // Decrement counter after animation completes
            window.setTimeout(() => { this._programmaticScrollCount--; }, 500);
        }
        this._shouldAutoScroll = true;
        this._userAtBottom = true;
        this._showNewBtn = false;
    }

    render() {
        void this._localeCtx.locale;
        // _userAtBottom is a @state driving re-render on scroll; consumed implicitly.
        void this._userAtBottom;
        const msgs = this.messages;
        const items = this._buildRenderItems(msgs);
        // The last rendered item's key determines which component gets is-last
        const lastRenderedKey = items.length > 0 ? items[items.length - 1].key : '';
        const isLoadingMore = this._ctx.state.isLoadingMore;

        return html`
      <div class="message-list-scroll" part="scroll">
        <div class="message-list-inner" part="inner">
          ${repeat(
            items,
            (item) => item.key,
            (item) => {
              if (item.type === 'user') {
                return html`<rtc-user-message data-client-id=${item.message.clientId} .message=${item.message}></rtc-user-message>`;
              }
              if (item.type === 'toolcall') {
                return html`<rtc-toolcall-card data-client-id=${item.pair.input.clientId} .pair=${item.pair}></rtc-toolcall-card>`;
              }
              return html`<rtc-message
                data-client-id=${item.message.clientId}
                .message=${item.message}
                ?is-last=${item.key === lastRenderedKey}
              ></rtc-message>`;
            }
          )}
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

    /**
     * Build render items from the flat message list.
     *
     * Pairs toolcall_input + toolcall_output into a single ToolCallPair.
     * Output messages that are paired are excluded from the render list.
     *
     * Returns ordered render items: user | assistant | toolcall.
     */
    private _buildRenderItems(msgs: Message[]): Array<
        | {type: 'user'; key: string; message: Message}
        | {type: 'assistant'; key: string; message: Message}
        | {type: 'toolcall'; key: string; pair: ToolCallPair}
    > {
        // 1. Build a map: input clientId -> output Message (for quick lookup)
        const inputToOutput = new Map<string, Message>();
        for (const m of msgs) {
            if (m.content?.type === 'toolcall_output' && m.parentClientId) {
                inputToOutput.set(m.parentClientId, m);
            }
        }

        const items: Array<
            | {type: 'user'; key: string; message: Message}
            | {type: 'assistant'; key: string; message: Message}
            | {type: 'toolcall'; key: string; pair: ToolCallPair}
        > = [];

        for (const m of msgs) {
            if (m.content?.type === 'toolcall_output') {
                // Output is rendered as part of its input pair, skip standalone
                continue;
            }

            if (m.content?.type === 'toolcall_input') {
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
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-message-list': RtcMessageList;
    }
}
