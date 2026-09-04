/**
 * RTC Empty State Component
 *
 * Displays a centered logo and hint text when there are no messages.
 *
 * @element rtc-empty-state
 * @csspart logo - The logo container
 * @csspart hint - The hint text
 */
import {LitElement, html, svg} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-empty-state.styles.js';

const defaultLogo = svg`
  <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <path d="M32 8 L32 12 L28 12 L28 16 L24 16 L24 20 L20 20 L20 24 L16 24 L16 28 L16 36 L20 36 L20 40 L24 40 L24 44 L28 44 L28 48 L36 48 L36 44 L40 44 L40 40 L44 40 L44 36 L48 36 L48 28 L48 24 L44 24 L44 20 L40 20 L40 16 L36 16 L36 12 L32 12 Z M24 24 L28 24 L28 28 L24 28 Z M36 24 L40 24 L40 28 L36 28 Z M28 32 L36 32 L36 40 L28 40 Z"/>
  </svg>
`;

@customElement('rtc-empty-state')
export class RtcEmptyState extends LitElement {
    static styles = styles;

    @property({type: String, attribute: 'hint-text'})
    hintText = 'Type /model to pick the right tool for the job.';

    render() {
        return html`
      <div class="logo-container" part="logo">${defaultLogo}</div>
      <div class="empty-hint" part="hint">${this.hintText}</div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-empty-state': RtcEmptyState;
    }
}
