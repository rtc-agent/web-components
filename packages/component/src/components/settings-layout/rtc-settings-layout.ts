/**
 * RTC Settings Layout Component
 *
 * Two-column layout: left column for category navigation + right column for settings content.
 * Consumes SettingsContext to get/modify settings state.
 *
 * @element rtc-settings-layout
 *
 * @attr {string} [theme=system] - Theme: 'light' | 'dark' | 'system'
 *
 * ## Styles
 * Uses project design tokens (--rtc-color-*), supports light/dark themes.
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg, str} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales, switchLocale, type SupportedLocale} from '../../core/i18n.js';
import {styles} from './rtc-settings-layout.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {SettingsContext} from '../../contexts/settings.js';
import type {SettingsContextValue} from '../../contexts/settings.js';
import {AuthContext} from '../../contexts/auth.js';
import type {AuthContextValue} from '../../contexts/auth.js';
import '../logo/rtc-logo.js';
import type {SettingsCategory} from './rtc-settings-nav.js';
import './rtc-settings-nav.js';
import '../drawer/rtc-drawer.js';

// Import types (TypeScript only)
import type {SettingsState} from '../../contexts/settings.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('SettingsLayout');

/** Panel title mapping */
function panelTitle(category: SettingsCategory): string {
    switch (category) {
        case 'appearance':
            return msg('外观');
        case 'chat':
            return msg('聊天');
        case 'files':
            return msg('文件');
        case 'notifications':
            return msg('通知');
        case 'account':
            return msg('账户');
        case 'about':
            return msg('关于');
    }
}

@localized()
@customElement('rtc-settings-layout')
export class RtcSettingsLayout extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /** delegatesFocus: true — supports keyboard focus delegation */
    static shadowRootOptions = {
        ...LitElement.shadowRootOptions,
        delegatesFocus: true,
    };

    /** Theme property */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /** Version number (passed from parent) */
    @property({type: String, attribute: 'version'})
    version = '0.2.6';

    /**
     * Whether the settings navigation drawer is visible
     *
     * Passed through from parent rtc-agent based on ActivityController.sidebarVisible.
     * Uses <rtc-drawer> overlay drawer mode, does not push the main content area.
     */
    @property({type: Boolean, attribute: false})
    sidebarVisible = false;

    /** Consumes SettingsContext */
    @consume({context: SettingsContext, subscribe: true})
    @property({attribute: false})
    private _settingsCtx: SettingsContextValue | undefined;

    /** Consumes AuthContext (used by account panel) */
    @consume({context: AuthContext, subscribe: true})
    @property({attribute: false})
    private _authCtx: AuthContextValue | undefined;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /** Currently selected category */
    @state()
    private _activeCategory: SettingsCategory = 'appearance';

    /** aria-live message (screen reader feedback) */
    @state()
    private _liveMessage = '';

    /** Handle category switch */
    private _handleCategoryChange(e: CustomEvent<{category: SettingsCategory}>) {
        this._activeCategory = e.detail.category;
    }

    /** Update settings and send aria-live feedback */
    private _updateSetting(
        group: 'appearance' | 'chat' | 'files' | 'notifications',
        partial: Record<string, unknown>,
        message: string
    ) {
        if (!this._settingsCtx) return;
        const actions = this._settingsCtx.actions;
        switch (group) {
            case 'appearance':
                actions.updateAppearance(partial as Partial<SettingsState['appearance']>);
                break;
            case 'chat':
                actions.updateChat(partial as Partial<SettingsState['chat']>);
                break;
            case 'files':
                actions.updateFiles(partial as Partial<SettingsState['files']>);
                break;
            case 'notifications':
                actions.updateNotifications(partial as Partial<SettingsState['notifications']>);
                break;
        }
        this._liveMessage = message;
    }

    /** Render appearance settings */
    private _renderAppearance() {
        const s = this._settingsCtx?.state.appearance;
        if (!s) return nothing;

        return html`
            <div class="panel-header" id="panel-header-appearance">${panelTitle('appearance')}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="theme-select">${msg('主题')}</label>
                    <span class="setting-desc">${msg('选择界面的配色方案')}</span>
                </div>
                <div class="setting-control">
                    <select
                        id="theme-select"
                        .value=${s.theme}
                        @change=${(e: Event) =>
                            this._updateSetting(
                                'appearance',
                                {theme: (e.target as HTMLSelectElement).value},
                                msg(str`主题已切换为 ${(e.target as HTMLSelectElement).value}`)
                            )}
                    >
                        <option value="light">${msg('浅色')}</option>
                        <option value="dark">${msg('深色')}</option>
                        <option value="system">${msg('跟随系统')}</option>
                    </select>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="locale-select">${msg('语言')}</label>
                    <span class="setting-desc">${msg('选择界面显示语言')}</span>
                </div>
                <div class="setting-control">
                    <select
                        id="locale-select"
                        .value=${this._localeCtx.locale}
                        @change=${async (e: Event) => {
                            const locale = (e.target as HTMLSelectElement).value as SupportedLocale;
                            await switchLocale(locale);
                            this._liveMessage = msg(str`语言已切换为 ${locale}`);
                        }}
                    >
                        <option value="zh-CN">简体中文</option>
                        <option value="en-US">English</option>
                    </select>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="font-size-input">${msg('字体大小')}</label>
                    <span class="setting-desc">${msg('调整界面文字大小（12–24px）')}</span>
                </div>
                <div class="setting-control">
                    <div class="number-input">
                        <input
                            type="number"
                            id="font-size-input"
                            min="12"
                            max="24"
                            step="1"
                            .value=${String(s.fontSize)}
                            @change=${(e: Event) => {
                                const raw = Number((e.target as HTMLInputElement).value);
                                const clamped = Math.min(24, Math.max(12, raw));
                                this._updateSetting(
                                    'appearance',
                                    {fontSize: clamped},
                                    msg(str`字体大小已设为 ${clamped}px`)
                                );
                            }}
                        />
                        <span class="number-unit">px</span>
                    </div>
                </div>
            </div>
        `;
    }

    /** Render chat settings */
    private _renderChat() {
        const s = this._settingsCtx?.state.chat;
        if (!s) return nothing;

        return html`
            <div class="panel-header" id="panel-header-chat">${panelTitle('chat')}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="send-shortcut-select">${msg('发送快捷键')}</label>
                    <span class="setting-desc">${msg('选择发送消息的键盘快捷键')}</span>
                </div>
                <div class="setting-control">
                    <select
                        id="send-shortcut-select"
                        .value=${s.sendShortcut}
                        @change=${(e: Event) =>
                            this._updateSetting(
                                'chat',
                                {sendShortcut: (e.target as HTMLSelectElement).value as 'Enter' | 'Ctrl+Enter'},
                                msg(str`发送快捷键已切换为 ${(e.target as HTMLSelectElement).value}`)
                            )}
                    >
                        <option value="Enter">Enter</option>
                        <option value="Ctrl+Enter">Ctrl+Enter</option>
                    </select>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="density-select">${msg('消息密度')}</label>
                    <span class="setting-desc">${msg('调整聊天消息的间距')}</span>
                </div>
                <div class="setting-control">
                    <select
                        id="density-select"
                        .value=${s.density}
                        @change=${(e: Event) =>
                            this._updateSetting(
                                'chat',
                                {density: (e.target as HTMLSelectElement).value as 'compact' | 'comfortable'},
                                msg(str`消息密度已切换为 ${(e.target as HTMLSelectElement).value}`)
                            )}
                    >
                        <option value="compact">${msg('紧凑')}</option>
                        <option value="comfortable">${msg('舒适')}</option>
                    </select>
                </div>
            </div>
        `;
    }

    /** Render file settings */
    private _renderFiles() {
        const s = this._settingsCtx?.state.files;
        if (!s) return nothing;

        return html`
            <div class="panel-header" id="panel-header-files">${panelTitle('files')}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="auto-save-toggle">${msg('自动保存')}</label>
                    <span class="setting-desc">${msg('编辑文件时自动保存更改')}</span>
                </div>
                <div class="setting-control">
                    <label class="toggle">
                        <input
                            type="checkbox"
                            id="auto-save-toggle"
                            .checked=${s.autoSave}
                            @change=${(e: Event) =>
                                this._updateSetting(
                                    'files',
                                    {autoSave: (e.target as HTMLInputElement).checked},
                                    (e.target as HTMLInputElement).checked ? msg('自动保存已启用') : msg('自动保存已禁用')
                                )}
                        />
                        <span class="toggle-track"></span>
                        <span class="toggle-thumb"></span>
                    </label>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="view-mode-select">${msg('默认视图模式')}</label>
                    <span class="setting-desc">${msg('选择文件编辑器的默认显示模式')}</span>
                </div>
                <div class="setting-control">
                    <select
                        id="view-mode-select"
                        .value=${s.defaultViewMode}
                        @change=${(e: Event) =>
                            this._updateSetting(
                                'files',
                                {defaultViewMode: (e.target as HTMLSelectElement).value as 'edit' | 'preview' | 'split'},
                                msg(str`默认视图已切换为 ${(e.target as HTMLSelectElement).value}`)
                            )}
                    >
                        <option value="edit">${msg('编辑')}</option>
                        <option value="preview">${msg('预览')}</option>
                        <option value="split">${msg('分屏')}</option>
                    </select>
                </div>
            </div>
        `;
    }

    /** Render notification settings */
    private _renderNotifications() {
        const s = this._settingsCtx?.state.notifications;
        if (!s) return nothing;

        return html`
            <div class="panel-header" id="panel-header-notifications">${panelTitle('notifications')}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="sound-toggle">${msg('启用声音')}</label>
                    <span class="setting-desc">${msg('收到消息时播放提示音')}</span>
                </div>
                <div class="setting-control">
                    <label class="toggle">
                        <input
                            type="checkbox"
                            id="sound-toggle"
                            .checked=${s.soundEnabled}
                            @change=${(e: Event) =>
                                this._updateSetting(
                                    'notifications',
                                    {soundEnabled: (e.target as HTMLInputElement).checked},
                                    (e.target as HTMLInputElement).checked ? msg('声音通知已启用') : msg('声音通知已禁用')
                                )}
                    />
                        <span class="toggle-track"></span>
                        <span class="toggle-thumb"></span>
                    </label>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="toast-toggle">${msg('启用 Toast')}</label>
                    <span class="setting-desc">${msg('显示桌面通知弹窗')}</span>
                </div>
                <div class="setting-control">
                    <label class="toggle">
                        <input
                            type="checkbox"
                            id="toast-toggle"
                            .checked=${s.toastEnabled}
                            @change=${(e: Event) =>
                                this._updateSetting(
                                    'notifications',
                                    {toastEnabled: (e.target as HTMLInputElement).checked},
                                    (e.target as HTMLInputElement).checked ? msg('Toast 通知已启用') : msg('Toast 通知已禁用')
                                )}
                    />
                        <span class="toggle-track"></span>
                        <span class="toggle-thumb"></span>
                    </label>
                </div>
            </div>
        `;
    }

    /** Render account panel */
    private _renderAccount() {
        const auth = this._authCtx;
        const userId = auth?.state.userId ?? msg('未登录');

        return html`
            <div class="panel-header" id="panel-header-account">${panelTitle('account')}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label>${msg('用户 ID')}</label>
                    <span class="setting-desc">${msg('当前登录的用户标识')}</span>
                </div>
                <div class="setting-control">
                    <span class="info-value">${userId}</span>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label>${msg('登出')}</label>
                    <span class="setting-desc">${msg('清除登录状态并返回登录页')}</span>
                </div>
                <div class="setting-control">
                    <button
                        class="danger"
                        aria-label="${msg('登出')}"
                        ?disabled=${!auth?.state.isLoggedIn}
                        @click=${() => auth?.logout()}
                    >${msg('登出')}</button>
                </div>
            </div>
        `;
    }

    /** Render about page */
    private _renderAbout() {
        return html`
            <div class="panel-header" id="panel-header-about">${panelTitle('about')}</div>
            <div class="about-brand">
                <div class="about-logo"><rtc-logo theme=${this.theme}></rtc-logo></div>
                <div class="about-name">RTC Agent</div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label>${msg('版本号')}</label>
                </div>
                <div class="setting-control">
                    <span class="info-value">${this.version}</span>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label>${msg('文档')}</label>
                </div>
                <div class="setting-control">
                    <a href="https://rtc-agent.github.io/docs/" target="_blank" rel="noopener" class="info-value info-link">
                        https://rtc-agent.github.io/docs/
                    </a>
                </div>
            </div>
        `;
    }

    /** Render the corresponding panel based on current category */
    private _renderPanel() {
        switch (this._activeCategory) {
            case 'appearance':
                return this._renderAppearance();
            case 'chat':
                return this._renderChat();
            case 'files':
                return this._renderFiles();
            case 'notifications':
                return this._renderNotifications();
            case 'account':
                return this._renderAccount();
            case 'about':
                return this._renderAbout();
            default:
                return nothing;
        }
    }

    render() {
        void this._localeCtx.locale;
        return html`
            <!-- Settings navigation drawer (overlay mode, does not push main content area) -->
            <rtc-drawer ?open=${this.sidebarVisible}>
                <rtc-settings-nav
                    .active=${this._activeCategory}
                    @settings-nav-change=${this._handleCategoryChange}
                ></rtc-settings-nav>
            </rtc-drawer>
            <div
                class="main"
                role="tabpanel"
                aria-labelledby="panel-header-${this._activeCategory}"
            >
                ${this._renderPanel()}
            </div>
            <!-- Screen reader live feedback -->
            <div class="sr-only" aria-live="polite" aria-atomic="true">
                ${this._liveMessage}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-settings-layout': RtcSettingsLayout;
    }
}
