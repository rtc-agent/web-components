/**
 * RTC Content Area Component
 *
 * Switches between empty state and message list based on messages.
 *
 * @element rtc-content-area
 * @csspart container - The content container
 */
import {LitElement, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {cache} from 'lit/directives/cache.js';
import {styles} from './rtc-content-area.styles.js';
import {MessageContext, type MessageContextValue} from '../../contexts/message.js';
import './rtc-message-list.js';
import '../empty-state/rtc-empty-state.js';

@customElement('rtc-content-area')
export class RtcContentArea extends LitElement {
    static styles = styles;

    @consume({context: MessageContext, subscribe: true})
    @state()
    private _ctx: MessageContextValue = {
        state: {messages: []},
        actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
    };

    private get _hasMessage(): boolean {
        return this._ctx.state.messages.length > 0;
    }

    render() {
        return html`
      <div class="content-container" part="container">
        ${cache(
            this._hasMessage
                ? html`<rtc-message-list></rtc-message-list>`
                : html`<rtc-empty-state></rtc-empty-state>`
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
