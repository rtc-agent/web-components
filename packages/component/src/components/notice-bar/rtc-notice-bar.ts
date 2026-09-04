/**
 * RTC Notice Bar Component
 *
 * Dismissible notice bar shown between content area and input area.
 *
 * @element rtc-notice-bar
 * @fires rtc-notice-dismissed - User clicked the close button
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {styles} from './rtc-notice-bar.styles.js';

@customElement('rtc-notice-bar')
export class RtcNoticeBar extends LitElement {
    static styles = styles;

    @property({type: String})
    message = '';

    @state()
    private _dismissed = false;

    private _handleClose() {
        this._dismissed = true;
        this.dispatchEvent(
            new CustomEvent('rtc-notice-dismissed', {bubbles: true, composed: true})
        );
    }

    render() {
        if (!this.message || this._dismissed) return nothing;

        return html`
      <div class="notice-bar">
        <span class="message">${this.message}</span>
        <button class="close-btn" title="Dismiss" @click=${this._handleClose}>&times;</button>
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-notice-bar': RtcNoticeBar;
    }
}
