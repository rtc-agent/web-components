/**
 * Status Bar Component
 *
 * VS Code-style bottom status bar displaying current editor file status information.
 *
 * Layout:
 * ┌──────────────────────────────────────────┐
 * │ Markdown  │  UTF-8  │  Ln 8, Col 12  │  Saved  │
 * └──────────────────────────────────────────┘
 *
 * Pure UI component: only receives StatusBarInfo for rendering, does not operate VFS.
 * State is driven by StatusBarController (or Debug HTML for manual driving).
 *
 * @element rtc-status-bar
 *
 * ## Styles
 * Uses project design tokens (--rtc-color-*), supports light/dark themes.
 * VS Code style: blue background with white text, same colors in both themes.
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
import { createLogger } from '@rtc-agent/client';

const log = createLogger('StatusBar');

@localized()
@customElement('rtc-status-bar')
export class RtcStatusBar extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Properties ── */

    /** Status bar data */
    @property({type: Object, attribute: false})
    fileInfo: StatusBarInfo = {
        fileType: '',
        encoding: 'UTF-8',
        cursor: {line: 1, column: 1},
        saveStatus: 'none',
    };

    /** Theme */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
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
