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
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-empty-state.styles.js';
import {renderLogo} from '../../icons/logo.js';

@localized()
@customElement('rtc-empty-state')
export class RtcEmptyState extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-empty-state] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @property({type: String, attribute: 'hint-text'})
    hintText = msg('Type /goal <your objective> — AI plans, executes, and self-checks until done.');

    @property({type: String, attribute: 'theme'})
    theme = 'light';

    render() {
        void this._localeCtx.locale;
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
