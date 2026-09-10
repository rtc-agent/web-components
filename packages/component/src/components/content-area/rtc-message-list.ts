/**
 * RTC Message List Component
 *
 * Renders messages in a scrollable container with timeline layout.
 * Auto-scrolls to bottom when new messages arrive (if user is at bottom).
 * Shows "new messages" button when user has scrolled up.
 *
 * ## Auto-scroll mechanism
 *
 * Uses reactive change detection in `updated()` + version counter debouncing:
 *
 * 1. **`updated()` as single decision point** -- compares current vs. previous
 *    message state, determines scroll intent:
 *    - Growth (count increased): new messages -> scroll if at bottom
 *    - Shrink/Replace (Fork/clear): always scroll, reset state
 *    - Reorder (same IDs, different order): scroll if at bottom
 *    - Content update (streaming): handled by ResizeObserver
 *
 * 2. **Version counter replaces `_pendingScroll`** -- monotonically increasing
 *    integer; each scroll request captures its version; superseded requests
 *    are silently discarded. No boolean flag, no blocking, no lost scrolls.
 *
 * 3. **ResizeObserver as pure safety net** -- only handles post-render content
 *    growth (async Markdown, streaming); no decision logic.
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
     * Distinct from `_userAtBottom` (which drives the "new messages" button UI):
     * - `_userAtBottom`: updated on every scroll event, reflects physical position.
     * - `_shouldAutoScroll`: sticky "follow" intent; flipped to false only when the
     *   user deliberately scrolls upward, flipped back to true when user returns
     *   to the bottom or clicks "New messages". Content-growth scroll events
     *   (thinking expansion, streaming Markdown) do NOT flip it.
     */
    private _shouldAutoScroll = true;

    /** Previous scroll position, used to distinguish user scrolls from content growth. */
    private _lastScrollTop = 0;

    private _scrollEl?: HTMLElement;
    private _resizeObserver?: ResizeObserver;
    private _resizeDebounceTimer?: number;

    /** Bound visibilitychange handler for cleanup. */
    private _boundOnVisibilityChange = this._onVisibilityChange.bind(this);

    /** Previous message IDs for change detection. */
    private _prevMsgIds: string[] = [];

    /** Previous message count for growth/shrink detection. */
    private _prevMsgCount = 0;

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
            this._lastScrollTop = 0;
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
     * Single decision point for auto-scroll.
     *
     * Detects what changed in the messages array and determines scroll intent:
     *
     * - **Growth** (count increased): new messages arrived -> scroll if at bottom
     * - **Shrink/Replace** (count decreased OR all IDs changed): fork/clear -> always scroll, reset state
     * - **Reorder** (same IDs, different order): sort -> scroll if at bottom
     * - **Content update** (same IDs, same order): streaming append -> handled by ResizeObserver
     */
    updated(changed: Map<string, unknown>) {
        super.updated(changed);

        // Set density attribute for CSS styling
        const density = this._settingsCtx.state.chat.density;
        this.setAttribute('data-density', density);

        // --- Session switch detection ---
        // When currentSessionId changes (tab activation, closing other tabs that
        // triggers a switch, etc.), force scroll to bottom and reset all tracking
        // state. This ensures the new session's messages are always visible at bottom.
        const currSessionId = this._sessionCtx.state.currentSessionId;
        if (changed.has('_sessionCtx') && currSessionId !== this._prevSessionId) {
            this._prevSessionId = currSessionId;
            // Reset message tracking so the next _ctx update is seen as "first load"
            this._prevMsgIds = [];
            this._prevMsgCount = 0;
            this._shouldAutoScroll = true;
            this._userAtBottom = true;
            this._showNewBtn = false;
            // Defer scroll to allow message reload to complete
            this._scheduleScroll();
            return;
        }

        if (!changed.has('_ctx')) return;

        const msgs = this.messages;
        const currIds = msgs.map(m => m.clientId);
        const currCount = msgs.length;

        // --- Change detection ---
        const isFirstLoad = this._prevMsgCount === 0 && currCount > 0;
        const isGrowth = currCount > this._prevMsgCount;
        const isShrinkOrReplace = currCount < this._prevMsgCount ||
            (currCount > 0 && this._prevMsgCount > 0 && this._isCompleteReplacement(currIds));
        const isReorder = !isGrowth && !isShrinkOrReplace &&
            currCount > 1 && !this._arraysEqual(currIds, this._prevMsgIds);

        // --- Scroll decision ---
        if (isFirstLoad) {
            // First load of a session (including refresh/re-enter):
            // always scroll to bottom, reset follow intent.
            this._shouldAutoScroll = true;
            this._userAtBottom = true;
            this._showNewBtn = false;
            this._scheduleScroll();
        } else if (isGrowth && this._anchorInfo) {
            // Prepend (loadMore): preserve scroll position using anchor
            this._preserveScrollPosition();
            this._anchorInfo = null;
        } else if (isShrinkOrReplace) {
            // Fork/clear: always scroll to bottom, reset state
            this._shouldAutoScroll = true;
            this._userAtBottom = true;
            this._showNewBtn = false;
            this._scheduleScroll();
        } else if (isGrowth || isReorder) {
            // New messages or reorder: scroll only if user intends to follow
            if (this._shouldAutoScroll) {
                this._scheduleScroll();
            }
        }
        // Content-only updates (streaming) are handled by ResizeObserver

        // --- Update load-more button visibility ---
        this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();

        // --- Snapshot for next comparison ---
        this._prevMsgIds = currIds;
        this._prevMsgCount = currCount;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._scrollEl?.removeEventListener('scroll', this._onScroll);
        this._resizeObserver?.disconnect();
        clearTimeout(this._resizeDebounceTimer);
        document.removeEventListener('visibilitychange', this._boundOnVisibilityChange);
    }

    /**
     * Schedule a scroll-to-bottom after all pending renders complete.
     *
     * Uses a version counter for clean debouncing:
     * - Each call increments `_scrollVersion`
     * - The async callback captures its version
     * - If version is stale when callback runs, a newer request has superseded it
     * - No boolean flag, no blocking, no lost scrolls
     *
     * Two-phase wait:
     * 1. `this.updateComplete` -- this component's render is done
     * 2. All child `<rtc-message>` elements' `updateComplete` -- their render
     *    (including async Markdown) is done
     */
    private _scheduleScroll() {
        const version = ++this._scrollVersion;

        this.updateComplete.then(async () => {
            if (version !== this._scrollVersion) return;

            // Wait for all message children to finish their current update
            const msgEls = this.shadowRoot!.querySelectorAll('rtc-message, rtc-user-message');
            if (msgEls.length > 0) {
                await Promise.all(
                    Array.from(msgEls).map(el => (el as LitElement).updateComplete)
                );
            }

            // Second pass: catches the re-render triggered by async Markdown
            // setting `_renderedHtml` (which triggers another Lit update cycle).
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
        this._scrollEl.scrollTo({top: this._scrollEl.scrollHeight, behavior: 'auto'});
        // 主动滚动：同步恢复跟随意图，避免后续内容变化引起的 scroll 事件误判
        this._shouldAutoScroll = true;
        this._userAtBottom = true;
        this._showNewBtn = false;
        // 立即同步 tracking 字段，防止下一轮 _onScroll 把这次主动滚动误判为内容增长
        this._lastScrollTop = this._scrollEl.scrollTop;
    }

    private _onScroll = () => {
        if (!this._scrollEl) return;
        const {scrollHeight, scrollTop, clientHeight} = this._scrollEl;
        const atBottom = scrollHeight - scrollTop - clientHeight < 60;

        // Button visibility follows physical position
        this._userAtBottom = atBottom;
        this._showNewBtn = !atBottom;

        // Scroll-intent detection: flip `_shouldAutoScroll` only on deliberate
        // user action, ignoring passive scroll events caused by content growth.
        //
        // Heuristic via delta analysis against last observed scroll state:
        //   - scrollTop decreased meaningfully (user scrolled UP)  → stop following
        //   - user is back at the bottom                            → resume following
        //   - scrollTop unchanged + scrollHeight grew (thinking expand,
        //     streaming Markdown, tool-call render)                 → preserve prior intent
        //   - scrollTop increased (programmatic `_scrollToBottom`
        //     or user scrolling down)                                → preserve prior intent
        const scrollTopDelta = scrollTop - this._lastScrollTop;
        if (scrollTopDelta < -10) {
            this._shouldAutoScroll = false;
        } else if (atBottom) {
            this._shouldAutoScroll = true;
        }
        // else: preserve (content growth, programmatic scroll, minor jitter)

        this._lastScrollTop = scrollTop;

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

            // Second pass for async Markdown re-renders
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
            this._scrollEl.scrollTo({top: this._scrollEl.scrollHeight, behavior: 'smooth'});
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

    // ========== Change Detection Helpers ==========

    /** True if the current IDs share no overlap with previous IDs (fork/clear scenario). */
    private _isCompleteReplacement(currIds: string[]): boolean {
        if (this._prevMsgIds.length === 0) return false;
        const prevSet = new Set(this._prevMsgIds);
        return currIds.every(id => !prevSet.has(id));
    }

    /** True if two string arrays have the same elements in the same order. */
    private _arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-message-list': RtcMessageList;
    }
}
