/**
 * RTC Empty State Component
 *
 * Displays a centered logo and hint text when there are no messages.
 *
 * @element rtc-empty-state
 * @csspart logo - The logo container
 * @csspart hint - The hint text
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-empty-state.styles.js';
import {renderLogo} from '../../icons/logo.js';

@customElement('rtc-empty-state')
export class RtcEmptyState extends LitElement {
    static styles = styles;

    @property({type: String, attribute: 'hint-text'})
    hintText = 'Type /goal <your objective> — AI plans, executes, and self-checks until done.';

    @property({type: String, attribute: 'theme'})
    theme = 'light';

    render() {
        return html`
      <div class="logo-container" part="logo">${renderLogo(this.theme === 'dark')}</div>
      <div class="empty-hint" part="hint">${this.hintText}</div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-empty-state': RtcEmptyState;
    }
}
