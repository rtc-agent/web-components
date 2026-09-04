/**
 * RTC Tool Confirm Component
 *
 * Modal dialog asking user to approve/deny a tool call.
 * Three actions: Yes (approve once), Yes-allow (approve all), No (deny).
 *
 * @element rtc-tool-confirm
 * @fires rtc-tool-call-approved - User approved (detail: { toolCallId, allowAll })
 * @fires rtc-tool-call-denied - User denied (detail: { toolCallId })
 * @csspart backdrop - The backdrop overlay
 * @csspart dialog - The dialog card
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-tool-confirm.styles.js';
import type {ToolCall} from '../../types/index.js';

@customElement('rtc-tool-confirm')
export class RtcToolConfirm extends LitElement {
    static styles = styles;

    @property({type: Object})
    toolCall: ToolCall = {id: '', toolName: '', status: 'pending', parameters: {}};

    private _approve(allowAll: boolean) {
        this.dispatchEvent(
            new CustomEvent('rtc-tool-call-approved', {
                bubbles: true,
                composed: true,
                detail: {toolCallId: this.toolCall.id, allowAll},
            })
        );
    }

    private _deny() {
        this.dispatchEvent(
            new CustomEvent('rtc-tool-call-denied', {
                bubbles: true,
                composed: true,
                detail: {toolCallId: this.toolCall.id},
            })
        );
    }

    private _onBackdropClick(e: Event) {
        // Only close if the backdrop itself was clicked (not the dialog)
        if ((e.target as HTMLElement).classList.contains('backdrop')) {
            this._deny();
        }
    }

    private _renderParams(): string {
        try {
            return JSON.stringify(this.toolCall.parameters, null, 2);
        } catch {
            return String(this.toolCall.parameters);
        }
    }

    render() {
        return html`
      <div class="backdrop" part="backdrop" @click=${this._onBackdropClick}></div>
      <div class="dialog" part="dialog" role="dialog" aria-modal="true">
        <div class="dialog-title">Allow this tool call?</div>
        <div class="dialog-desc">The AI wants to use a tool. Review the details below.</div>
        <div class="tool-info">
          <div class="tool-name">${this.toolCall.toolName}</div>
          <div class="tool-params">${this._renderParams()}</div>
        </div>
        <div class="actions">
          <button class="action-btn primary" data-action="yes" @click=${() => this._approve(false)}>Yes</button>
<!--          <button class="action-btn" data-action="yes-allow">Yes, allow all</button>-->
          <button class="action-btn danger" data-action="no" @click=${() => this._deny()}>No</button>
        </div>
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-tool-confirm': RtcToolConfirm;
    }
}
