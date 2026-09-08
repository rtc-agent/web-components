/**
 * Session Tab Bar 容器组件
 *
 * VS Code 风格 Tab 标签栏，组合 rtc-session-tab 叶子组件。
 * 横向排列，超出时横向滚动。
 *
 * 通过 SessionTabContext 消费 Tab 数据和切换/关闭操作。
 *
 * @element rtc-session-tab-bar
 * @fires rtc-session-tab-bar-activate - 切换 Tab (detail: { sessionId })
 * @fires rtc-session-tab-bar-close - 关闭 Tab (detail: { sessionId })
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-session-tab-bar.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {SessionTabContext, type SessionTabContextValue} from '../../contexts/session-tab.js';

// 子组件（副作用导入）
import './rtc-session-tab.js';

@localized()
@customElement('rtc-session-tab-bar')
export class RtcSessionTabBar extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[RtcSessionTabBar] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ─ */

    /** 主题（继承自父级） */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Context ── */

    @consume({context: SessionTabContext, subscribe: true})
    @property({attribute: false})
    private _tabCtx: SessionTabContextValue = {
        state: {tabs: [], activeSessionId: null},
        actions: {
            openOrActivate: () => {},
            closeTab: () => {},
            setActiveTab: () => {},
            clearAll: () => {},
            updateTabTitles: () => {},
            syncTabStatuses: () => {},
            markSaved: () => {},
            findUnsavedTab: () => undefined,
            updateTabStatus: () => {},
        },
    };

    /* ── Event Handlers ── */

    private _handleActivate(e: CustomEvent) {
        const {sessionId} = e.detail;
        this._tabCtx.actions.setActiveTab(sessionId);
        this.dispatchEvent(
            new CustomEvent('rtc-session-tab-bar-activate', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    private _handleClose(e: CustomEvent) {
        const {sessionId} = e.detail;
        this._tabCtx.actions.closeTab(sessionId);
        this.dispatchEvent(
            new CustomEvent('rtc-session-tab-bar-close', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    /* ── Render ── */

    render() {
        void this._localeCtx.locale;
        const {tabs, activeSessionId} = this._tabCtx.state;

        return html`
            <div class="tabs-bar">
                ${tabs.map(tab => html`
                    <rtc-session-tab
                        session-id=${tab.sessionId}
                        title=${tab.title}
                        status=${tab.status ?? 'idle'}
                        ?active=${tab.sessionId === activeSessionId}
                        ?dirty=${tab.isUnsaved === true}
                        theme=${this.theme}
                        @rtc-session-tab-activate=${this._handleActivate}
                        @rtc-session-tab-close=${this._handleClose}
                    ></rtc-session-tab>
                `)}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-session-tab-bar': RtcSessionTabBar;
    }

    interface HTMLElementEventMap {
        'rtc-session-tab-bar-activate': CustomEvent<{sessionId: string}>;
        'rtc-session-tab-bar-close': CustomEvent<{sessionId: string}>;
    }
}
