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
import {repeat} from 'lit/directives/repeat.js';
import {styles} from './rtc-message-list.styles.js';
import {MessageContext, type MessageContextValue} from '../../contexts/message.js';
import type {Message} from '../../types/index.js';
import './rtc-message.js';
import './rtc-user-message.js';
import './rtc-toolcall-card.js';
import type {ToolCallPair} from './rtc-toolcall-card.js';

@customElement('rtc-message-list')
export class RtcMessageList extends LitElement {
    static styles = styles;

    @consume({context: MessageContext, subscribe: true})
    @state()
    private _ctx: MessageContextValue = {
        state: {messages: []},
        actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
    };

    @state()
    private _showNewBtn = false;

    @state()
    private _userAtBottom = true;

    private _scrollEl?: HTMLElement;
    private _resizeObserver?: ResizeObserver;

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

        // ResizeObserver: pure safety net for post-render content growth.
        // Fires when inner container size changes (streaming chunks, late Markdown).
        // No decision logic -- just "if at bottom, scroll."
        const inner = this.shadowRoot!.querySelector('.message-list-inner') as HTMLElement;
        if (inner) {
            this._resizeObserver = new ResizeObserver(() => {
                if (this._userAtBottom) {
                    this._scrollToBottom();
                }
            });
            this._resizeObserver.observe(inner);
        }
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
        if (!changed.has('_ctx')) return;

        const msgs = this.messages;
        const currIds = msgs.map(m => m.clientId);
        const currCount = msgs.length;

        // --- Change detection ---
        const isGrowth = currCount > this._prevMsgCount;
        const isShrinkOrReplace = currCount < this._prevMsgCount ||
            (currCount > 0 && this._prevMsgCount > 0 && this._isCompleteReplacement(currIds));
        const isReorder = !isGrowth && !isShrinkOrReplace &&
            currCount > 1 && !this._arraysEqual(currIds, this._prevMsgIds);

        // --- Scroll decision ---
        if (isShrinkOrReplace) {
            // Fork/clear: always scroll to bottom, reset user state
            this._userAtBottom = true;
            this._showNewBtn = false;
            this._scheduleScroll();
        } else if (isGrowth || isReorder) {
            // New messages or reorder: scroll if user is at bottom
            if (this._userAtBottom) {
                this._scheduleScroll();
            }
        }
        // Content-only updates (streaming) are handled by ResizeObserver

        // --- Snapshot for next comparison ---
        this._prevMsgIds = currIds;
        this._prevMsgCount = currCount;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._scrollEl?.removeEventListener('scroll', this._onScroll);
        this._resizeObserver?.disconnect();
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
    }

    private _onScroll = () => {
        if (!this._scrollEl) return;
        const {scrollHeight, scrollTop, clientHeight} = this._scrollEl;
        const atBottom = scrollHeight - scrollTop - clientHeight < 60;
        this._userAtBottom = atBottom;
        this._showNewBtn = !atBottom;
    };

    private _handleNewBtnClick() {
        if (this._scrollEl) {
            this._scrollEl.scrollTo({top: this._scrollEl.scrollHeight, behavior: 'smooth'});
        }
        this._showNewBtn = false;
        this._userAtBottom = true;
    }

    render() {
        const msgs = this.messages;
        const items = this._buildRenderItems(msgs);
        // The last rendered item's key determines which component gets is-last
        const lastRenderedKey = items.length > 0 ? items[items.length - 1].key : '';

        return html`
      <div class="message-list-scroll" part="scroll">
        <div class="message-list-inner" part="inner">
          ${repeat(
            items,
            (item) => item.key,
            (item) => {
              if (item.type === 'user') {
                return html`<rtc-user-message .message=${item.message}></rtc-user-message>`;
              }
              if (item.type === 'toolcall') {
                return html`<rtc-toolcall-card .pair=${item.pair}></rtc-toolcall-card>`;
              }
              return html`<rtc-message
                .message=${item.message}
                ?is-last=${item.key === lastRenderedKey}
              ></rtc-message>`;
            }
          )}
        </div>
      </div>
      <button
        class="new-message-btn"
        ?hidden=${!this._showNewBtn}
        @click=${this._handleNewBtnClick}
      >↓ New messages</button>
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
