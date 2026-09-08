/**
 * RTC Settings Panel Component
 *
 * Side drawer panel that wraps rtc-settings-layout.
 * Provides overlay, close button, and keyboard navigation (ESC).
 *
 * @element rtc-settings-panel
 * @fires close - When the panel is closed
 */
import {LitElement, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {styles} from './rtc-settings-panel.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import '../settings-layout/rtc-settings-layout.js';

@localized()
@customElement('rtc-settings-panel')
export class RtcSettingsPanel extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-settings-panel] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    private _handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            this._close();
        }
    }

    private _close() {
        this.dispatchEvent(new CustomEvent('close', {
            bubbles: true,
            composed: true,
        }));
    }

    render() {
        // Reference locale to ensure re-render on locale change
        void this._localeCtx.locale;

        return html`
            <div class="overlay" @click=${this._close}></div>
            <div class="panel" @keydown=${this._handleKeydown}>
                <div class="panel-header">
                    <h2>${msg('设置')}</h2>
                    <button class="close-btn" aria-label=${msg('关闭设置')} @click=${this._close}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 7.293l3.146-3.147a.5.5 0 01.708.708L8.707 8l3.147 3.146a.5.5 0 01-.708.708L8 8.707l-3.146 3.147a.5.5 0 01-.708-.708L7.293 8 4.146 4.854a.5.5 0 01.708-.708L8 7.293z"/>
                        </svg>
                    </button>
                </div>
                <div class="panel-content">
                    <rtc-settings-layout></rtc-settings-layout>
                </div>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-settings-panel': RtcSettingsPanel;
    }

    interface HTMLElementEventMap {
        'close': CustomEvent<void>;
    }
}
