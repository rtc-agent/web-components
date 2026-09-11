/**
 * RTC Login Page Component
 *
 * 居中展示 Logo、应用名称和 OAuth2 Provider 选择按钮。
 * 用户未登录时显示。
 *
 * @element rtc-login-page
 * @fires rtc-login-requested - 用户选择了 provider，detail 包含 {provider}
 * @csspart container - 登录容器
 * @csspart logo - Logo 区域
 * @csspart app-name - 应用名称文本
 * @csspart providers - Provider 按钮容器
 * @csspart provider-btn - 单个 Provider 按钮
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-login-page.styles.js';
import {renderLogo} from '../../icons/logo.js';
import {AUTH_CONFIG} from '../../config/auth.js';
import {OAuth2Client} from '@rtc-agent/client';

/** Provider 配置 */
interface ProviderConfig {
    name: string;
    label: string;
    icon: string;
    color: string;
}

/** 已知 provider 的配置 */
const PROVIDER_CONFIGS: Record<string, Omit<ProviderConfig, 'name'>> = {
    github: {
        label: 'GitHub',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`,
        color: '#24292e',
    },
    google: {
        label: 'Google',
        icon: `<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
        color: '#fff',
    },
    mock: {
        label: 'Mock (Test)',
        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
        color: '#6c757d',
    },
};

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

    @state() private _providers: ProviderConfig[] = [];
    @state() private _loadingProviders = true;

    private _oauth2Client: OAuth2Client | null = null;

    connectedCallback() {
        super.connectedCallback();
        this._oauth2Client = new OAuth2Client({
            serverUrl: AUTH_CONFIG.serverUrl,
            redirectUri: AUTH_CONFIG.redirectUri,
        });
        this._loadProviders();
    }

    private async _loadProviders() {
        if (!this._oauth2Client) return;

        try {
            const providerNames = await this._oauth2Client.getProviders();
            this._providers = providerNames
                .map(name => {
                    const config = PROVIDER_CONFIGS[name];
                    if (config) {
                        return { name, ...config };
                    }
                    // 未知 provider 使用默认配置
                    return {
                        name,
                        label: name.charAt(0).toUpperCase() + name.slice(1),
                        icon: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>`,
                        color: '#6c757d',
                    };
                })
                .filter(p => p.name);
        } catch (err) {
            console.error('[rtc-login-page] Failed to load providers:', err);
            // 回退到默认 mock provider
            this._providers = [{
                name: 'mock',
                ...PROVIDER_CONFIGS.mock,
            }];
        } finally {
            this._loadingProviders = false;
        }
    }

    private _handleProviderSelect(providerName: string) {
        // 发送事件，携带 provider 信息。<rtc-agent> 监听此事件并打开登录对话框。
        this.dispatchEvent(
            new CustomEvent('rtc-login-requested', {
                bubbles: true,
                composed: true,
                detail: { provider: providerName },
            })
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
            : this._renderProviders()}
      </div>
    `;
    }

    private _renderProviders() {
        if (this._loadingProviders) {
            return html`<div class="loading-text">${msg('Loading...')}</div>`;
        }

        if (this._providers.length === 0) {
            return html`<div class="error-text">${msg('No login providers available')}</div>`;
        }

        // 如果只有一个 provider，直接显示一个按钮
        if (this._providers.length === 1) {
            const provider = this._providers[0];
            return html`
                <button
                    class="provider-btn provider-btn-primary"
                    part="provider-btn"
                    style="--provider-color: ${provider.color}"
                    @click=${() => this._handleProviderSelect(provider.name)}
                >
                    <span class="provider-icon" .innerHTML=${provider.icon}></span>
                    <span>${msg('Sign in with')} ${provider.label}</span>
                </button>
            `;
        }

        // 多个 providers，显示列表
        return html`
            <div class="providers" part="providers">
                ${this._providers.map(provider => html`
                    <button
                        class="provider-btn"
                        part="provider-btn"
                        style="--provider-color: ${provider.color}"
                        @click=${() => this._handleProviderSelect(provider.name)}
                    >
                        <span class="provider-icon" .innerHTML=${provider.icon}></span>
                        <span>${provider.label}</span>
                    </button>
                `)}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-login-page': RtcLoginPage;
    }
}
