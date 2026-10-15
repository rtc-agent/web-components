/**
 * RTC Notice Bar Component
 *
 * Dismissible notice bar shown between content area and input area.
 *
 * @element rtc-notice-bar
 * @fires rtc-notice-dismissed - User clicked the close button
 */

import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { createLogger } from '@rtc-agent/protocol';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  type LocaleContextValue,
  localeContext,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import { styles } from './rtc-notice-bar.styles.js';

const log = createLogger('NoticeBar');

@localized()
@customElement('rtc-notice-bar')
export class RtcNoticeBar extends LitElement {
  static styles = styles;

  @consume({ context: localeContext, subscribe: true })
  @state()
  private _localeCtx: LocaleContextValue = {
    locale: sourceLocale,
    setLocale: async () => {
      log.warn('Locale context not initialized');
    },
    locales: [sourceLocale, ...targetLocales],
  };

  @property({ type: String })
  message = '';

  @state()
  private _dismissed = false;

  private _handleClose() {
    this._dismissed = true;
    this.dispatchEvent(
      new CustomEvent('rtc-notice-dismissed', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    void this._localeCtx.locale;
    if (!this.message || this._dismissed) return nothing;

    return html`
      <div class="notice-bar">
        <span class="message">${this.message}</span>
        <button class="close-btn" title=${msg('关闭')} @click=${this._handleClose}>&times;</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-notice-bar': RtcNoticeBar;
  }
}
