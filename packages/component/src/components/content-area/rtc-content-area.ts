/**
 * RTC Content Area Component
 *
 * Switches between empty state and message list based on messages.
 * Each `<rtc-content-area>` receives a `sessionId` and `messageController`
 * from its parent, passing them down to `<rtc-message-list>`.
 *
 * @element rtc-content-area
 * @csspart container - The content container
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {cache} from 'lit/directives/cache.js';
import {styles} from './rtc-content-area.styles.js';
import type {MessageController} from '../../controllers/message.controller.js';
import './rtc-message-list.js';
import '../empty-state/rtc-empty-state.js';

@customElement('rtc-content-area')
export class RtcContentArea extends LitElement {
    static styles = styles;

    @property({type: String, attribute: 'theme'})
    theme: 'light' | 'dark' | 'system' = 'system';

    /** Session ID for the message list instance. */
    @property({type: String})
    sessionId: string | null = null;

    /** Message controller for repository access. */
    @property({attribute: false})
    messageController?: MessageController;

    render() {
        return html`
      <div class="content-container" part="container">
        ${cache(
            this.sessionId
                ? html`<rtc-message-list
                    .sessionId=${this.sessionId}
                    .messageController=${this.messageController}
                  ></rtc-message-list>`
                : html`<rtc-empty-state theme=${this.theme}></rtc-empty-state>`
        )}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-content-area': RtcContentArea;
    }
}
