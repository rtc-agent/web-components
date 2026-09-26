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
import '../logo/rtc-logo.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('EmptyState');

@localized()
@customElement('rtc-empty-state')
export class RtcEmptyState extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @property({type: String, attribute: 'hint-text'})
    hintText = msg('输入 /goal <你的目标> — AI 会自动规划、执行并自我检查直到完成');

    @property({type: String, attribute: 'theme'})
    theme = 'light';

    render() {
        void this._localeCtx.locale;
        return html`
      <div class="logo-container" part="logo"><rtc-logo theme=${this.theme}></rtc-logo></div>
      <div class="empty-hint" part="hint">${this.hintText}</div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-empty-state': RtcEmptyState;
    }
}
