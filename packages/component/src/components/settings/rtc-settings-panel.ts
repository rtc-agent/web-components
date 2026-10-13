/**
 * RTC Settings Panel Component
 *
 * Side drawer panel that wraps rtc-settings-layout.
 * Provides overlay, close button, and keyboard navigation (ESC).
 *
 * @element rtc-settings-panel
 * @fires close - When the panel is closed
 */
import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { consume } from '@lit/context';
import { styles } from './rtc-settings-panel.styles.js';
import { tokens } from '../../styles/tokens.js';
import { lightTheme } from '../../styles/themes/light.js';
import { darkTheme } from '../../styles/themes/dark.js';
import { baseStyles } from '../../styles/base.js';
import {
  localeContext,
  type LocaleContextValue,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import '../settings-layout/rtc-settings-layout.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('SettingsPanel');

@localized()
@customElement('rtc-settings-panel')
export class RtcSettingsPanel extends LitElement {
  static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

  @consume({ context: localeContext, subscribe: true })
  @state()
  private _localeCtx: LocaleContextValue = {
    locale: sourceLocale,
    setLocale: async () => {
      log.warn('Locale context not initialized');
    },
    locales: [sourceLocale, ...targetLocales],
  };

  private _handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this._close();
    }
  }

  private _close() {
    this.dispatchEvent(
      new CustomEvent('close', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleLocaleChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    const newLocale = select.value as typeof this._localeCtx.locale;
    this._localeCtx.setLocale(newLocale).catch((err) => {
      log.error('Failed to switch locale:', err);
    });
  }

  render() {
    // Reference locale to ensure re-render on locale change
    void this._localeCtx.locale;

    return html`
            <div class="overlay" @click=${this._close}></div>
            <div class="panel" @keydown=${this._handleKeydown}>
                <div class="panel-header">
                    <h2>${msg('Settings')}</h2>
                    <button class="close-btn" aria-label=${msg('Close settings')} @click=${this._close}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 7.293l3.146-3.147a.5.5 0 01.708.708L8.707 8l3.147 3.146a.5.5 0 01-.708.708L8 8.707l-3.146 3.147a.5.5 0 01-.708-.708L7.293 8 4.146 4.854a.5.5 0 01.708-.708L8 7.293z"/>
                        </svg>
                    </button>
                </div>
                <div class="panel-content">
                    <div class="settings-section">
                        <h3>${msg('Language')}</h3>
                        <div class="setting-item">
                            <label for="locale-select">${msg('Interface language')}</label>
                            <select
                                id="locale-select"
                                class="locale-select"
                                @change=${this._handleLocaleChange}
                                .value=${this._localeCtx.locale}
                            >
                                ${this._localeCtx.locales.map(
                                  (locale) => html`
                                    <option value=${locale} ?selected=${locale === this._localeCtx.locale}>
                                        ${this._getLocaleDisplayName(locale)}
                                    </option>
                                  `,
                                )}
                            </select>
                        </div>
                    </div>
                    <rtc-settings-layout></rtc-settings-layout>
                </div>
            </div>
        `;
  }

  /**
   * Get the human-readable display name for a locale.
   */
  private _getLocaleDisplayName(locale: string): string {
    const names: Record<string, string> = {
      'zh-CN': msg('简体中文') as string,
      'en-US': msg('English (US)') as string,
    };
    return names[locale] ?? locale;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-settings-panel': RtcSettingsPanel;
  }

  interface HTMLElementEventMap {
    close: CustomEvent<void>;
  }
}
