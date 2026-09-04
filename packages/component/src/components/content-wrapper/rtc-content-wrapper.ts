/**
 * RTC Content Wrapper Component
 *
 * Vertical flex layout composing the normal (logged-in) UI:
 *   session-header → content-area → notice-bar → input-area
 * Also contains overlay-manager (positioned absolutely).
 *
 * @element rtc-content-wrapper
 */
import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';
import {styles} from './rtc-content-wrapper.styles.js';

// Child component registrations
import '../session-header/rtc-session-header.js';
import '../content-area/rtc-content-area.js';
import '../notice-bar/rtc-notice-bar.js';
import '../input-area/rtc-input-area.js';
import '../overlay/rtc-overlay-manager.js';

@customElement('rtc-content-wrapper')
export class RtcContentWrapper extends LitElement {
    static styles = styles;

    /* ── Render ── */

    render() {
        return html`
      <rtc-session-header></rtc-session-header>
      <rtc-content-area></rtc-content-area>
      <rtc-notice-bar></rtc-notice-bar>
      <rtc-input-area></rtc-input-area>
      <rtc-overlay-manager></rtc-overlay-manager>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-content-wrapper': RtcContentWrapper;
    }
}
