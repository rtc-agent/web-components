/**
 * RTC Login Dialog Component
 *
 * Displays OAuth2 authorization page inside an iframe within the dialog.
 * Receives callback via postMessage and exchanges code for tokens.
 *
 * @element rtc-login-dialog
 * @fires rtc-login-complete - Login successful, detail contains tokens
 * @fires rtc-login-dialog-close - Dialog closed
 */
import {LitElement, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {styles} from './rtc-login-dialog.styles.js';
import {AUTH_CONFIG, STORAGE_KEYS} from '../../config/auth.js';
import {getOrCreateDeviceId, getDeviceName} from '../../utils/device.js';

type LoginStatus = 'opening' | 'waiting' | 'exchanging' | 'success' | 'error';

interface OAuth2AuthorizeResponse {
    redirect_url: string;
    state: string;
}

interface OAuth2TokenExchangeResponse {
    access_token: string;
    refresh_token: string;
    user_id: string;
    expires_in: number;
}

@customElement('rtc-login-dialog')
export class RtcLoginDialog extends LitElement {
    static styles = styles;

    @state() private _status: LoginStatus = 'opening';
    @state() private _errorMessage = '';
    @state() private _authUrl = '';

    private _messageHandler: ((event: MessageEvent) => void) | null = null;
    private _loginStarted = false;

    render() {
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
            <button class="close-btn" @click=${this._close} aria-label="关闭">×</button>
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
                return '登录成功';
            case 'error':
                return '登录失败';
            default:
                return '登录';
        }
    }

    private _getStatusMessage(): string {
        switch (this._status) {
            case 'opening':
                return '正在准备授权...';
            case 'waiting':
                return '请在下方完成授权';
            case 'exchanging':
                return '正在验证身份...';
            case 'success':
                return '即将自动关闭...';
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
          重试
        </button>
      `;
        }

        if (isSuccess) {
            return html`<div class="button-row"><span class="spinner"></span></div>`;
        }

        if (isLoading) {
            return html`<div class="button-row"><span class="spinner"></span></div>`;
        }

        // waiting state - show iframe
        if (this._authUrl) {
            return html`
        <div class="iframe-container">
          <iframe
            class="auth-iframe"
            src=${this._authUrl}
            title="授权页面"
            allow="credentials"
          ></iframe>
        </div>
      `;
        }

        return null;
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
        // Don't restart if already started (guard against multiple clicks)
        if (this._loginStarted) {
            return;
        }
        this._loginStarted = true;

        this._status = 'opening';
        this._errorMessage = '';
        this._authUrl = '';

        try {
            // 1. Get authorization URL
            const authzUrl = new URL(`${AUTH_CONFIG.serverUrl}/oauth2/authorize`);
            authzUrl.searchParams.set('provider', AUTH_CONFIG.provider);
            authzUrl.searchParams.set('redirect_uri', AUTH_CONFIG.redirectUri);

            const response = await fetch(authzUrl.toString());
            if (!response.ok) {
                throw new Error(`获取授权 URL 失败: ${response.status}`);
            }

            const authz: OAuth2AuthorizeResponse = await response.json();

            // 2. Save state for validation
            sessionStorage.setItem(STORAGE_KEYS.oauthState, authz.state);

            // 3. Set iframe URL and start listening for messages
            this._authUrl = authz.redirect_url;
            this._status = 'waiting';

            // 4. Listen for postMessage from iframe
            this._messageHandler = this._handleCallback.bind(this);
            window.addEventListener('message', this._messageHandler);

        } catch (error) {
            this._status = 'error';
            this._errorMessage = error instanceof Error ? error.message : '未知错误';
            this._loginStarted = false; // Allow retry
        }
    }

    private async _handleCallback(event: MessageEvent) {
        // Validate origin
        if (event.origin !== window.location.origin) {
            return;
        }

        // Validate message type
        if (event.data?.type !== 'oauth-callback') {
            return;
        }

        const {code, state, error} = event.data;

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
            this._errorMessage = 'State 校验失败，请重试';
            this._loginStarted = false;
            return;
        }

        // Token exchange
        this._status = 'exchanging';

        try {
            const response = await fetch(`${AUTH_CONFIG.serverUrl}/oauth2/token`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    code,
                    state,
                    redirect_uri: AUTH_CONFIG.redirectUri,
                    device_id: getOrCreateDeviceId(),
                    device_name: getDeviceName(),
                    user_agent: navigator.userAgent,
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error_description || `Token 交换失败: ${response.status}`);
            }

            const tokens: OAuth2TokenExchangeResponse = await response.json();

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

            // Close after delay
            setTimeout(() => this._close(), 800);

        } catch (error) {
            this._status = 'error';
            this._errorMessage = error instanceof Error ? error.message : '未知错误';
            this._loginStarted = false;
        }

        this._cleanup();
    }

    private _cleanup() {
        if (this._messageHandler) {
            window.removeEventListener('message', this._messageHandler);
            this._messageHandler = null;
        }
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
