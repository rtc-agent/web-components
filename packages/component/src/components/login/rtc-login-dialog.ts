/**
 * RTC Login Dialog Component
 *
 * Displays the OAuth2 authorization page inside an iframe within a dialog.
 * Receives the callback via postMessage and exchanges the authorization code for tokens.
 *
 * @element rtc-login-dialog
 * @property {string} provider - OAuth2 provider name (e.g. 'github', 'google', 'mock')
 * @fires rtc-login-complete - Login succeeded; detail contains tokens
 * @fires rtc-login-dialog-close - Dialog closed
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {styles} from './rtc-login-dialog.styles.js';
import {AUTH_CONFIG, STORAGE_KEYS} from '../../config/auth.js';
import {getOrCreateDeviceId, getDeviceName} from '../../utils/device.js';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {OAuth2Client} from '@rtc-agent/client';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('LoginDialog');

/** Delay before auto-closing the dialog after successful login (ms). */
const LOGIN_SUCCESS_CLOSE_DELAY_MS = 800;

type LoginStatus = 'opening' | 'waiting' | 'exchanging' | 'success' | 'error';

@localized()
@customElement('rtc-login-dialog')
export class RtcLoginDialog extends LitElement {
    static styles = styles;

    /** OAuth2 provider name */
    @property({type: String})
    provider = 'mock';

    @state() private _status: LoginStatus = 'opening';
    @state() private _errorMessage = '';
    @state() private _authUrl = '';

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    private _oauth2Client: OAuth2Client | null = null;
    private _messageHandler: ((event: MessageEvent) => void) | null = null;
    private _loginStarted = false;
    private _popup: Window | null = null;
    private _popupCheckInterval: ReturnType<typeof setInterval> | null = null;
    /** Timer for auto-closing after successful login (cleared on disconnect to prevent stale execution). */
    private _closeTimer?: ReturnType<typeof setTimeout>;

    connectedCallback() {
        super.connectedCallback();
        this._oauth2Client = new OAuth2Client({
            serverUrl: AUTH_CONFIG.serverUrl,
            redirectUri: AUTH_CONFIG.redirectUri,
        });
    }

    render() {
        // Reference locale to ensure re-render on locale change
        void this._localeCtx.locale;

        return html`
      <div
        class="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        @keydown=${this._handleKeydown}
      >
        <div class="dialog">
          <div class="dialog-header">
            <div class="title" id="dialog-title">${this._getTitle()}</div>
            <button class="close-btn" @click=${this._close} aria-label=${msg('关闭')}>×</button>
          </div>
          <div class="status">${this._getStatusMessage()}</div>
          ${this._renderContent()}
          ${this._errorMessage ? html`<div class="error">${this._errorMessage}</div>` : null}
        </div>
      </div>
    `;
    }

    private _getTitle(): string {
        switch (this._status) {
            case 'success':
                return msg('登录成功');
            case 'error':
                return msg('登录失败');
            default:
                return msg('登录');
        }
    }

    private _getStatusMessage(): string {
        switch (this._status) {
            case 'opening':
                return msg('正在准备授权...');
            case 'waiting':
                return msg('请在下方完成授权');
            case 'exchanging':
                return msg('正在验证身份...');
            case 'success':
                return msg('即将自动关闭...');
            case 'error':
                return '';
            default:
                return '';
        }
    }

    private _renderContent() {
        const isError = this._status === 'error';
        const isSuccess = this._status === 'success';
        const isLoading = this._status === 'opening' || this._status === 'exchanging';

        if (isError) {
            return html`
        <button class="button button-primary" @click=${this._startLogin}>
          ${msg('重试')}
        </button>
      `;
        }

        if (isSuccess) {
            return html`<div class="button-row"><span class="spinner"></span></div>`;
        }

        if (isLoading) {
            return html`<div class="button-row"><span class="spinner"></span></div>`;
        }

        // waiting state - popup opened, waiting for user to complete authorization
        if (this._status === 'waiting') {
            return html`
        <div class="waiting-container">
          <p>${msg('请在弹出的窗口中完成授权')}</p>
          <button class="button button-secondary" @click=${this._reopenPopup}>
            ${msg('重新打开授权窗口')}
          </button>
        </div>
      `;
        }

        return nothing;
    }

    /** Auto-start login when dialog is mounted */
    firstUpdated() {
        this._startLogin();
    }

    /** ESC key closes the dialog */
    private _handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            // Don't allow closing during waiting states
            if (['opening', 'waiting', 'exchanging'].includes(this._status)) {
                return;
            }
            this._close();
        }
    }

    private async _startLogin() {
        if (!this._oauth2Client) return;

        // Don't restart if already started (guard against multiple clicks)
        if (this._loginStarted) {
            return;
        }
        this._loginStarted = true;

        this._status = 'opening';
        this._errorMessage = '';
        this._authUrl = '';

        try {
            // 1. Get authorization URL using OAuth2Client
            const authz = await this._oauth2Client.getAuthorizationUrl(this.provider);

            // 2. Save state for validation
            sessionStorage.setItem(STORAGE_KEYS.oauthState, authz.state);

            // 3. Open popup window
            this._authUrl = authz.redirect_url;
            this._openPopup(authz.redirect_url);

            // 4. Listen for postMessage from popup
            this._messageHandler = this._handleCallback.bind(this);
            window.addEventListener('message', this._messageHandler);

            this._status = 'waiting';

        } catch (error) {
            this._status = 'error';
            this._errorMessage = error instanceof Error ? error.message : msg('未知错误');
            this._loginStarted = false; // Allow retry
        }
    }

    /** Open the authorization popup window. */
    private _openPopup(url: string) {
        // Close any existing popup
        this._closePopup();

        // Popup size and position
        const width = 500;
        const height = 600;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        this._popup = window.open(
            url,
            'oauth2-popup',
            `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
        );

        // Detect popup close
        this._popupCheckInterval = setInterval(() => {
            if (this._popup?.closed) {
                this._closePopup();
                // Still in waiting state means user closed popup without completing auth
                if (this._status === 'waiting') {
                    this._status = 'error';
                    this._errorMessage = msg('授权已取消');
                    this._loginStarted = false;
                }
            }
        }, 500);
    }

    /** Close the popup window. */
    private _closePopup() {
        if (this._popupCheckInterval) {
            clearInterval(this._popupCheckInterval);
            this._popupCheckInterval = null;
        }
        if (this._popup && !this._popup.closed) {
            this._popup.close();
        }
        this._popup = null;
    }

    /** Re-open the authorization popup window. */
    private _reopenPopup() {
        if (this._authUrl) {
            this._openPopup(this._authUrl);
            this._status = 'waiting';
            this._errorMessage = '';
            this._loginStarted = true;
        }
    }

    private async _handleCallback(event: MessageEvent) {
        if (!this._oauth2Client) return;

        // Validate origin
        if (event.origin !== window.location.origin) {
            return;
        }

        // Validate message type
        if (event.data?.type !== 'oauth-callback') {
            return;
        }

        const {code, state, error} = event.data;

        // Use try/finally to ensure message listener cleanup on all paths
        try {
            // Handle error from callback page
            if (error) {
                this._status = 'error';
                this._errorMessage = error;
                this._loginStarted = false;
                return;
            }

            // Validate state
            const savedState = sessionStorage.getItem(STORAGE_KEYS.oauthState);
            if (state !== savedState) {
                this._status = 'error';
                this._errorMessage = msg('State 校验失败，请重试');
                this._loginStarted = false;
                return;
            }

            // Token exchange
            this._status = 'exchanging';

            const tokens = await this._oauth2Client.exchangeToken(
                code,
                state,
                getOrCreateDeviceId(),
                getDeviceName(),
                navigator.userAgent,
            );

            // Clear state
            sessionStorage.removeItem(STORAGE_KEYS.oauthState);

            // Notify parent
            this._status = 'success';
            this.dispatchEvent(new CustomEvent('rtc-login-complete', {
                detail: {
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                    userId: tokens.user_id,
                    expiresIn: tokens.expires_in,
                },
                bubbles: true,
                composed: true,
            }));

            // Close after delay (tracked so disconnectedCallback can cancel it)
            this._closeTimer = setTimeout(() => {
                this._closeTimer = undefined;
                this._close();
            }, LOGIN_SUCCESS_CLOSE_DELAY_MS);

        } catch (err) {
            this._status = 'error';
            this._errorMessage = err instanceof Error ? err.message : msg('未知错误');
            this._loginStarted = false;
        } finally {
            this._cleanup();
        }
    }

    private _cleanup() {
        if (this._messageHandler) {
            window.removeEventListener('message', this._messageHandler);
            this._messageHandler = null;
        }
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = undefined;
        }
        this._closePopup();
    }

    private _close() {
        this._cleanup();
        this.dispatchEvent(new CustomEvent('rtc-login-dialog-close', {
            bubbles: true,
            composed: true,
        }));
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._cleanup();
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-login-dialog': RtcLoginDialog;
    }
}
