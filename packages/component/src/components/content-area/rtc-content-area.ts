/**
 * RTC Content Area Component
 *
 * Hosts rtc-message-list instances. In the multi-instance architecture, each
 * `<rtc-message-list>` subscribes directly to the MessageRepository for its
 * own sessionId, so session switching is handled by the component lifecycle
 * (connect/disconnect) rather than by data-level caching in the parent.
 *
 * @deprecated This component is part of the legacy single-instance architecture.
 * Use `<rtc-chat-layout>` instead, which provides a more flexible multi-instance
 * architecture with independent session subscriptions.
 *
 * This component is kept for backward compatibility only. It is still referenced
 * by `<rtc-content-wrapper>` (which itself is deprecated), but new code should
 * migrate to `<rtc-chat-layout>`.
 *
 * @element rtc-content-area
 * @csspart container - The content container
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-content-area.styles.js';
import type {MessageController} from '../../controllers/message.controller.js';
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
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-content-area': RtcContentArea;
    }
}
