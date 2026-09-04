/**
 * RTC Overlay Manager Component
 *
 * Manages floating panels: tool confirm.
 *
 * Panel positioning:
 * - Tool confirm: centered (via its own CSS)
 * - Session panel: managed by rtc-session-header with @floating-ui/dom
 * - Mode panel: managed by rtc-input-area with @floating-ui/dom
 *
 * @element rtc-overlay-manager
 * @csspart container - The overlay container
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {styles} from './rtc-overlay-manager.styles.js';
import {ToolCallContext, type ToolCallContextValue} from '../../contexts/tool-call.js';
import './rtc-tool-confirm.js';

@customElement('rtc-overlay-manager')
export class RtcOverlayManager extends LitElement {
    static styles = styles;

    @consume({context: ToolCallContext, subscribe: true})
    @state()
    private _toolCallCtx: ToolCallContextValue = {
        state: {pendingCalls: []},
        actions: {approve: () => {}, approveAll: () => {}, deny: () => {}},
    };

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();
        this.addEventListener('rtc-tool-call-approved', this._handleApprove as EventListener);
        this.addEventListener('rtc-tool-call-denied', this._handleDeny as EventListener);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener('rtc-tool-call-approved', this._handleApprove as EventListener);
        this.removeEventListener('rtc-tool-call-denied', this._handleDeny as EventListener);
    }

    /* ── Event Handlers ── */

    private _handleApprove = (e: CustomEvent) => {
        const {toolCallId, allowAll} = e.detail;
        if (allowAll) {
            // Look up the toolName from pendingCalls before approving
            const toolCall = this._toolCallCtx.state.pendingCalls.find(tc => tc.id === toolCallId);
            if (toolCall) {
                this._toolCallCtx.actions.approveAll(toolCall.toolName);
            }
        } else {
            this._toolCallCtx.actions.approve(toolCallId);
        }
    };

    private _handleDeny = (e: CustomEvent) => {
        const {toolCallId} = e.detail;
        this._toolCallCtx.actions.deny(toolCallId);
    };

    /* ── Render ── */

    render() {
        const pendingCalls = this._toolCallCtx.state.pendingCalls;
        const hasToolConfirm = pendingCalls.length > 0;

        if (!hasToolConfirm) return nothing;

        return html`
      <div class="panel-host" part="container">
        <rtc-tool-confirm
          .toolCall=${pendingCalls[0]}
        ></rtc-tool-confirm>
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-overlay-manager': RtcOverlayManager;
    }
}
