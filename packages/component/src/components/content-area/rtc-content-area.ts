/**
 * RTC Content Area Component
 *
 * Hosts a single rtc-message-list instance. Session switching is handled by
 * the MessageController's data-level caching (LRU message state cache) and
 * scroll position cache — not by DOM-level instance caching.
 *
 * When sessionId changes (tab switch), willUpdate() saves the current scroll
 * position before the context update propagates. The message-list restores
 * the saved position after rendering the new session's data.
 *
 * @element rtc-content-area
 * @csspart container - The content container
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {query} from 'lit/decorators/query.js';
import {styles} from './rtc-content-area.styles.js';
import type {MessageController} from '../../controllers/message.controller.js';
import type {RtcMessageList} from './rtc-message-list.js';
import './rtc-message-list.js';
import '../empty-state/rtc-empty-state.js';

@customElement('rtc-content-area')
export class RtcContentArea extends LitElement {
    static styles = styles;

    @property({type: String, attribute: 'theme'})
    theme: 'light' | 'dark' | 'system' = 'system';

    @property({type: String})
    sessionId: string | null = null;

    @property({attribute: false})
    messageController?: MessageController;

    @query('rtc-message-list')
    private _messageList?: RtcMessageList;

    protected willUpdate(changed: Map<string, unknown>) {
        if (changed.has('sessionId')) {
            const prevSessionId = changed.get('sessionId') as string | null;
            if (prevSessionId) {
                this._saveScrollPosition(prevSessionId);
            }
        }
    }

    render() {
        if (!this.sessionId) {
            return html`<rtc-empty-state theme=${this.theme}></rtc-empty-state>`;
        }

        return html`
            <div class="content-container" part="container">
                <rtc-message-list
                    .sessionId=${this.sessionId}
                    .messageController=${this.messageController}
                    .theme=${this.theme}
                ></rtc-message-list>
            </div>
        `;
    }

    /**
     * Save the current message list's scroll position before session switch.
     *
     * Called from willUpdate() BEFORE the context update propagates to the
     * message list. At this point, the lit-virtualizer still holds the old
     * session's DOM, so firstVisibleIndex is valid.
     */
    private _saveScrollPosition(oldSessionId: string) {
        if (!this.messageController || !this._messageList) return;

        const virtualizer = this._messageList.getVirtualizer();
        if (!virtualizer) return;

        const index = virtualizer.firstVisibleIndex;
        if (index == null || index < 0) return;

        const items = this._messageList.getRenderItems();
        if (index >= items.length) return;

        this.messageController.saveScrollPosition(
            oldSessionId,
            index,
            items[index].key,
        );
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-content-area': RtcContentArea;
    }
}
