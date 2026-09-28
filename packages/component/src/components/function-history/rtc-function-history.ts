/**
 * Function History Component
 *
 * Bottom drawer that slides up to reveal execution history.
 * The overall drawer is collapsible; each history item is also collapsible,
 * expanding to show the original parameters, logs, and result.
 *
 * @element rtc-function-history
 */
import {LitElement, html, nothing, type TemplateResult} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-function-history.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {FunctionDebugContext, type FunctionDebugContextValue} from '../../contexts/function-debug.js';
import type {DebugHistoryItem, LogEntry} from '../../types/functions-debug.js';
import {chevronRightIcon, chevronDownIcon} from '../../icons/index.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('FunctionHistory');

/**
 * Format relative time (e.g., "2 分钟前", "1 小时前")
 */
function relativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return msg('刚刚');
    if (minutes < 60) return msg(`${minutes} 分钟前`);
    if (hours < 24) return msg(`${hours} 小时前`);
    return msg(`${days} 天前`);
}

@localized()
@customElement('rtc-function-history')
export class RtcFunctionHistory extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /** Theme (inherited from parent) */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    @consume({context: FunctionDebugContext, subscribe: true})
    @property({attribute: false})
    private _debugCtx: FunctionDebugContextValue | undefined;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /** Whether the drawer is open */
    @state()
    private _drawerOpen = false;

    /** Set of expanded history item IDs */
    @state()
    private _expandedItems = new Set<string>();

    private _toggleDrawer() {
        this._drawerOpen = !this._drawerOpen;
    }

    private _toggleItem(id: string) {
        const next = new Set(this._expandedItems);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        this._expandedItems = next;
    }

    private _handleRunClick(e: Event, item: DebugHistoryItem) {
        e.stopPropagation();
        if (this._debugCtx) {
            this._debugCtx.actions.executeFromHistory(item);
        }
    }

    private _handleRestoreClick(e: Event, item: DebugHistoryItem) {
        e.stopPropagation();
        if (this._debugCtx) {
            this._debugCtx.actions.loadFromHistory(item);
        }
    }

    /**
     * Render a log entry with level-specific styling
     */
    private _renderLogEntry(entry: LogEntry): TemplateResult {
        const levelClass = entry.level;
        const dataStr = entry.data !== undefined
            ? (typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2))
            : '';
        return html`
            <div class="log-entry ${levelClass}">
                <span class="log-level">${entry.level.toUpperCase()}</span>
                <span class="log-message">${entry.message}</span>
                ${dataStr ? html`<pre class="log-data">${dataStr}</pre>` : nothing}
            </div>
        `;
    }

    /**
     * Render expanded details for a history item: params, logs, result
     */
    private _renderItemDetails(item: DebugHistoryItem): TemplateResult {
        return html`
            <div class="item-details" @click=${(e: Event) => e.stopPropagation()}>
                <!-- Params -->
                <div class="detail-section">
                    <div class="detail-label">${msg('参数')}</div>
                    <pre class="detail-content params-content">${item.params || '{}'}</pre>
                </div>

                <!-- Logs -->
                ${item.logs && item.logs.length > 0 ? html`
                    <div class="detail-section">
                        <div class="detail-label">${msg('日志')}</div>
                        <div class="detail-content logs-content">
                            ${item.logs.map(entry => this._renderLogEntry(entry))}
                        </div>
                    </div>
                ` : nothing}

                <!-- Result -->
                ${item.result !== undefined ? html`
                    <div class="detail-section">
                        <div class="detail-label">${msg('结果')}</div>
                        <pre class="detail-content result-content ${item.success ? 'success' : 'error'}">${typeof item.result === 'string' ? item.result : JSON.stringify(item.result, null, 2)}</pre>
                    </div>
                ` : nothing}

                <!-- Error message -->
                ${item.errorMessage ? html`
                    <div class="detail-section">
                        <div class="detail-label">${msg('错误')}</div>
                        <pre class="detail-content result-content error">${item.errorMessage}</pre>
                    </div>
                ` : nothing}

                <!-- Actions -->
                <div class="detail-actions">
                    <button class="detail-btn" @click=${(e: Event) => this._handleRestoreClick(e, item)}>
                        ${msg('恢复')}
                    </button>
                    <button class="detail-btn primary" @click=${(e: Event) => this._handleRunClick(e, item)}>
                        ▶ ${msg('重新运行')}
                    </button>
                </div>
            </div>
        `;
    }

    private _renderHistoryItem(item: DebugHistoryItem): TemplateResult {
        const isExpanded = this._expandedItems.has(item.id);
        return html`
            <div class="history-item ${isExpanded ? 'expanded' : ''}" @click=${() => this._toggleItem(item.id)}>
                <div class="item-header">
                    <span class="item-chevron">
                        ${isExpanded ? chevronDownIcon : chevronRightIcon}
                    </span>
                    <span class="history-status ${item.success ? 'success' : 'error'}">
                        ${item.success ? '✓' : '✗'}
                    </span>
                    <div class="history-info">
                        <span class="history-name">${item.functionName}</span>
                        <div class="history-meta">
                            <span>${relativeTime(item.timestamp)}</span>
                            <span>${item.durationMs}ms</span>
                        </div>
                    </div>
                </div>
                ${isExpanded ? this._renderItemDetails(item) : nothing}
            </div>
        `;
    }

    render() {
        void this._localeCtx.locale;

        const history = this._debugCtx?.state.history ?? [];
        const count = history.length;

        return html`
            <div class="history-drawer ${this._drawerOpen ? 'open' : ''}">
                <div class="drawer-header" @click=${this._toggleDrawer}>
                    <span class="drawer-title">
                        <span class="chevron ${this._drawerOpen ? 'expanded' : ''}">${chevronRightIcon}</span>
                        ${msg('历史记录')}
                        <span class="history-count">(${count})</span>
                    </span>
                    <div class="header-actions" @click=${(e: Event) => e.stopPropagation()}>
                        ${count > 0 ? html`
                            <button class="clear-btn" @click=${() => this._debugCtx?.actions.clearHistory()}>
                                ${msg('清空')}
                            </button>
                        ` : nothing}
                    </div>
                </div>
                <div class="drawer-body">
                    ${count === 0
                        ? html`<div class="empty-history">${msg('暂无历史记录')}</div>`
                        : history.map(item => this._renderHistoryItem(item))}
                </div>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-function-history': RtcFunctionHistory;
    }
}
