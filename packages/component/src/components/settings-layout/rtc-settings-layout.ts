/**
 * RTC Settings Layout Component
 *
 * 两栏布局：左栏分类导航 + 右栏设置内容。
 * 消费 SettingsContext 获取/修改设置状态。
 *
 * @element rtc-settings-layout
 *
 * @attr {string} [theme=system] - Theme: 'light' | 'dark' | 'system'
 *
 * ## 样式
 * 使用项目 design tokens（--rtc-color-*），支持亮色/暗色主题。
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {styles} from './rtc-settings-layout.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {SettingsContext} from '../../contexts/settings.js';
import type {SettingsContextValue} from '../../contexts/settings.js';
import {AuthContext} from '../../contexts/auth.js';
import type {AuthContextValue} from '../../contexts/auth.js';
import {renderLogo} from '../../icons/logo.js';
import type {SettingsCategory} from './rtc-settings-nav.js';
import './rtc-settings-nav.js';

// 导入类型（仅用于 TypeScript）
import type {SettingsState} from '../../contexts/settings.js';

/** 面板标题映射 */
const PANEL_TITLES: Record<SettingsCategory, string> = {
    appearance: '外观',
    chat: '聊天',
    files: '文件',
    notifications: '通知',
    account: '账户',
    about: '关于',
};

@customElement('rtc-settings-layout')
export class RtcSettingsLayout extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /** delegatesFocus: true — 支持键盘焦点委托 */
    static shadowRootOptions = {
        ...LitElement.shadowRootOptions,
        delegatesFocus: true,
    };

    /** 主题属性 */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /** 消费 SettingsContext */
    @consume({context: SettingsContext, subscribe: true})
    @property({attribute: false})
    private _settingsCtx: SettingsContextValue | undefined;

    /** 消费 AuthContext（账户面板使用） */
    @consume({context: AuthContext, subscribe: true})
    @property({attribute: false})
    private _authCtx: AuthContextValue | undefined;

    /** 当前选中的分类 */
    @state()
    private _activeCategory: SettingsCategory = 'appearance';

    /** aria-live 消息（屏幕阅读器反馈） */
    @state()
    private _liveMessage = '';

    /** 处理分类切换 */
    private _handleCategoryChange(e: CustomEvent<{category: SettingsCategory}>) {
        this._activeCategory = e.detail.category;
    }

    /** 更新设置并发送 aria-live 反馈 */
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

    /** 渲染外观设置 */
    private _renderAppearance() {
        const s = this._settingsCtx?.state.appearance;
        if (!s) return nothing;

        return html`
            <div class="panel-header" id="panel-header-appearance">${PANEL_TITLES.appearance}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="theme-select">主题</label>
                    <span class="setting-desc">选择界面的配色方案</span>
                </div>
                <div class="setting-control">
                    <select
                        id="theme-select"
                        .value=${s.theme}
                        @change=${(e: Event) =>
                            this._updateSetting(
                                'appearance',
                                {theme: (e.target as HTMLSelectElement).value},
                                `主题已切换为 ${(e.target as HTMLSelectElement).value}`
                            )}
                    >
                        <option value="light">浅色</option>
                        <option value="dark">深色</option>
                        <option value="system">跟随系统</option>
                    </select>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="font-size-input">字体大小</label>
                    <span class="setting-desc">调整界面文字大小（12–24px）</span>
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
                                    `字体大小已设为 ${clamped}px`
                                );
                            }}
                        />
                        <span class="number-unit">px</span>
                    </div>
                </div>
            </div>
        `;
    }

    /** 渲染聊天设置 */
    private _renderChat() {
        const s = this._settingsCtx?.state.chat;
        if (!s) return nothing;

        return html`
            <div class="panel-header" id="panel-header-chat">${PANEL_TITLES.chat}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="send-shortcut-select">发送快捷键</label>
                    <span class="setting-desc">选择发送消息的键盘快捷键</span>
                </div>
                <div class="setting-control">
                    <select
                        id="send-shortcut-select"
                        .value=${s.sendShortcut}
                        @change=${(e: Event) =>
                            this._updateSetting(
                                'chat',
                                {sendShortcut: (e.target as HTMLSelectElement).value as 'Enter' | 'Ctrl+Enter'},
                                `发送快捷键已切换为 ${(e.target as HTMLSelectElement).value}`
                            )}
                    >
                        <option value="Enter">Enter</option>
                        <option value="Ctrl+Enter">Ctrl+Enter</option>
                    </select>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="density-select">消息密度</label>
                    <span class="setting-desc">调整聊天消息的间距</span>
                </div>
                <div class="setting-control">
                    <select
                        id="density-select"
                        .value=${s.density}
                        @change=${(e: Event) =>
                            this._updateSetting(
                                'chat',
                                {density: (e.target as HTMLSelectElement).value as 'compact' | 'comfortable'},
                                `消息密度已切换为 ${(e.target as HTMLSelectElement).value}`
                            )}
                    >
                        <option value="compact">紧凑</option>
                        <option value="comfortable">舒适</option>
                    </select>
                </div>
            </div>
        `;
    }

    /** 渲染文件设置 */
    private _renderFiles() {
        const s = this._settingsCtx?.state.files;
        if (!s) return nothing;

        return html`
            <div class="panel-header" id="panel-header-files">${PANEL_TITLES.files}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="auto-save-toggle">自动保存</label>
                    <span class="setting-desc">编辑文件时自动保存更改</span>
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
                                    `自动保存已${(e.target as HTMLInputElement).checked ? '启用' : '禁用'}`
                                )}
                        />
                        <span class="toggle-track"></span>
                        <span class="toggle-thumb"></span>
                    </label>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="view-mode-select">默认视图模式</label>
                    <span class="setting-desc">选择文件编辑器的默认显示模式</span>
                </div>
                <div class="setting-control">
                    <select
                        id="view-mode-select"
                        .value=${s.defaultViewMode}
                        @change=${(e: Event) =>
                            this._updateSetting(
                                'files',
                                {defaultViewMode: (e.target as HTMLSelectElement).value as 'edit' | 'preview' | 'split'},
                                `默认视图已切换为 ${(e.target as HTMLSelectElement).value}`
                            )}
                    >
                        <option value="edit">编辑</option>
                        <option value="preview">预览</option>
                        <option value="split">分屏</option>
                    </select>
                </div>
            </div>
        `;
    }

    /** 渲染通知设置 */
    private _renderNotifications() {
        const s = this._settingsCtx?.state.notifications;
        if (!s) return nothing;

        return html`
            <div class="panel-header" id="panel-header-notifications">${PANEL_TITLES.notifications}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="sound-toggle">启用声音</label>
                    <span class="setting-desc">收到消息时播放提示音</span>
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
                                    `声音通知已${(e.target as HTMLInputElement).checked ? '启用' : '禁用'}`
                                )}
                    />
                        <span class="toggle-track"></span>
                        <span class="toggle-thumb"></span>
                    </label>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label for="toast-toggle">启用 Toast</label>
                    <span class="setting-desc">显示桌面通知弹窗</span>
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
                                    `Toast 通知已${(e.target as HTMLInputElement).checked ? '启用' : '禁用'}`
                                )}
                    />
                        <span class="toggle-track"></span>
                        <span class="toggle-thumb"></span>
                    </label>
                </div>
            </div>
        `;
    }

    /** 渲染账户面板 */
    private _renderAccount() {
        const auth = this._authCtx;
        const userId = auth?.state.userId ?? '未登录';

        return html`
            <div class="panel-header" id="panel-header-account">${PANEL_TITLES.account}</div>
            <div class="setting-row">
                <div class="setting-label">
                    <label>用户 ID</label>
                    <span class="setting-desc">当前登录的用户标识</span>
                </div>
                <div class="setting-control">
                    <span class="info-value">${userId}</span>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label>登出</label>
                    <span class="setting-desc">清除登录状态并返回登录页</span>
                </div>
                <div class="setting-control">
                    <button
                        class="danger"
                        aria-label="登出"
                        ?disabled=${!auth?.state.isLoggedIn}
                        @click=${() => auth?.logout()}
                    >登出</button>
                </div>
            </div>
        `;
    }

    /** 渲染关于页面 */
    private _renderAbout() {
        return html`
            <div class="panel-header" id="panel-header-about">${PANEL_TITLES.about}</div>
            <div class="about-brand">
                <div class="about-logo">${renderLogo(this.theme === 'dark')}</div>
                <div class="about-name">RTC Agent</div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label>版本号</label>
                </div>
                <div class="setting-control">
                    <span class="info-value">0.1.0</span>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-label">
                    <label>文档</label>
                </div>
                <div class="setting-control">
                    <span class="info-value">https://docs.rtc-agent.dev</span>
                </div>
            </div>
        `;
    }

    /** 根据当前分类渲染对应的面板 */
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
        return html`
            <rtc-settings-nav
                .active=${this._activeCategory}
                @settings-nav-change=${this._handleCategoryChange}
            ></rtc-settings-nav>
            <div
                class="main"
                role="tabpanel"
                aria-labelledby="panel-header-${this._activeCategory}"
            >
                ${this._renderPanel()}
            </div>
            <!-- 屏幕阅读器实时反馈 -->
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
