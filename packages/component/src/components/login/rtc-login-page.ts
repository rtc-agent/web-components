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
import {LitElement, html, nothing, svg} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {styles} from './rtc-login-page.styles.js';
import {AuthContext, type AuthContextValue} from '../../contexts/auth.js';

const logoSvg = svg`
  <svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
    <path d="M36 9 L36 14 L31 14 L31 18 L26 18 L26 22 L21 22 L21 27 L16 27 L16 31 L16 41 L21 41 L21 45 L26 45 L26 49 L31 49 L31 54 L41 54 L41 49 L46 49 L46 45 L51 45 L51 41 L56 41 L56 31 L56 27 L51 27 L51 22 L46 22 L46 18 L41 18 L41 14 L36 14 Z M26 26 L31 26 L31 31 L26 31 Z M41 26 L46 26 L46 31 L41 31 Z M31 36 L41 36 L41 45 L31 45 Z"/>
  </svg>
`;

@customElement('rtc-login-page')
export class RtcLoginPage extends LitElement {
    static styles = styles;

    @consume({context: AuthContext})
    @state()
    private _authCtx: AuthContextValue = {
        state: {isLoggedIn: false},
        login: () => {},
        logout: () => {},
    };

    @property({type: String, attribute: 'app-name'})
    appName = 'RTC Agent';

    @property({type: Boolean, reflect: true})
    loading = false;

    @property({type: String, attribute: 'error-message'})
    errorMessage = '';

    private _handleLogin() {
        // Dispatch event directly. <rtc-agent> listens for this and opens the login dialog.
        this.dispatchEvent(
            new CustomEvent('rtc-login-requested', {bubbles: true, composed: true})
        );
    }

    render() {
        return html`
      <div class="login-container" part="container">
        <div class="logo" part="logo">${logoSvg}</div>
        <div class="app-name" part="app-name">${this.appName}</div>
        <div class="app-desc">Sign in to continue</div>
        ${this.errorMessage
            ? html`<div class="error-text">${this.errorMessage}</div>`
            : nothing}
        ${this.loading
            ? html`<div class="loading-text">Authorizing...</div>`
            : html`<button class="login-btn" part="login-btn" @click=${this._handleLogin}>Login</button>`}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-login-page': RtcLoginPage;
    }
}
