/**
 * Status Bar Component
 *
 * VS Code 风格底部状态栏，显示当前编辑文件的状态信息。
 *
 * 布局：
 * ┌──────────────────────────────────────────┐
 * │ Markdown  │  UTF-8  │  行 8, 列 12  │  已保存  │
 * └──────────────────────────────────────────┘
 *
 * 纯 UI 组件：只接收 StatusBarInfo 渲染，不操作 VFS。
 * 状态由 StatusBarController 驱动（或 Debug HTML 手动驱动）。
 *
 * @element rtc-status-bar
 *
 * ## 样式
 * 使用项目 design tokens（--rtc-color-*），支持亮色/暗色主题。
 * VS Code 风格：蓝底白字，双主题同色。
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg, str} from '@lit/localize';
import {consume} from '@lit/context';
import {styles} from './rtc-status-bar.styles.js';
import type {StatusBarInfo} from '../../types/index.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';

@localized()
@customElement('rtc-status-bar')
export class RtcStatusBar extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Properties ── */

    /** 状态栏数据 */
    @property({type: Object, attribute: false})
    fileInfo: StatusBarInfo = {
        fileType: '',
        encoding: 'UTF-8',
        cursor: {line: 1, column: 1},
        saveStatus: 'none',
    };

    /** 主题 */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-status-bar] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Render ── */

    render() {
        // Reference locale to ensure re-render on locale change
        void this._localeCtx.locale;

        if (this.fileInfo.saveStatus === 'none') {
            return this._renderEmpty();
        }

        return this._renderItems();
    }

    private _renderEmpty() {
        return html`<span class="status-empty">${msg('未打开文件')}</span>`;
    }

    private _renderItems() {
        const {fileType, encoding, cursor, saveStatus} = this.fileInfo;

        // At this point, saveStatus is guaranteed to be 'saved' | 'unsaved' (not 'none')
        const displayStatus = saveStatus as 'saved' | 'unsaved';

        return html`
            <span class="status-item status-file-type">${fileType}</span>
            <span class="status-item status-encoding">${encoding}</span>
            <span class="status-item status-cursor">
                ${msg(str`行 ${cursor.line}, 列 ${cursor.column}`)}
            </span>
            <span class="status-spacer"></span>
            <span class="status-item status-save ${displayStatus === 'unsaved' ? 'status-save-unsaved' : ''}">
                ${this._renderSaveStatus(displayStatus)}
            </span>
        `;
    }

    private _renderSaveStatus(status: 'saved' | 'unsaved'): string {
        switch (status) {
            case 'saved':
                return msg('已保存');
            case 'unsaved':
                return msg('未保存');
            default:
                return '';
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-status-bar': RtcStatusBar;
    }
}
