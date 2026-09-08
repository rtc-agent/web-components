/**
 * RTC Login Page Component
 *
 * Displays centered logo, app name, login button with loading/error states.
 * Shown when user is not authenticated.
 *
 * @element rtc-login-page
 * @fires rtc-login-requested - User clicked login
 * @csspart container - The login container
 * @csspart logo - The logo area
 * @csspart app-name - The app name text
 * @csspart login-btn - The login button
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-login-page.styles.js';
import {renderLogo} from '../../icons/logo.js';

@localized()
@customElement('rtc-login-page')
export class RtcLoginPage extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-login-page] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @property({type: String, attribute: 'app-name'})
    appName = 'RTC Agent';

    @property({type: Boolean, reflect: true})
    loading = false;

    @property({type: String, attribute: 'error-message'})
    errorMessage = '';

    @property({type: String, attribute: 'theme'})
    theme = 'light';

    private _handleLogin() {
        // Dispatch event directly. <rtc-agent> listens for this and opens the login dialog.
        this.dispatchEvent(
            new CustomEvent('rtc-login-requested', {bubbles: true, composed: true})
        );
    }

    render() {
        void this._localeCtx.locale;
        return html`
      <div class="login-container" part="container">
        <div class="logo" part="logo">${renderLogo(this.theme === 'dark')}</div>
        <div class="app-name" part="app-name">${this.appName}</div>
        <div class="app-desc">${msg('Sign in to continue')}</div>
        ${this.errorMessage
            ? html`<div class="error-text">${this.errorMessage}</div>`
            : nothing}
        ${this.loading
            ? html`<div class="loading-text">${msg('Authorizing...')}</div>`
            : html`<button class="login-btn" part="login-btn" @click=${this._handleLogin}>${msg('Login')}</button>`}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-login-page': RtcLoginPage;
    }
}
