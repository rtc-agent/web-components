/**
 * Function Console Component
 *
 * Real-time log output console for function execution.
 * Features: level-based coloring, auto-scroll, expandable data objects.
 *
 * @element rtc-function-console
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-function-console.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {FunctionDebugContext, type FunctionDebugContextValue} from '../../contexts/function-debug.js';
import type {LogEntry} from '../../types/functions-debug.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('FunctionConsole');

/**
 * Format a timestamp to HH:mm:ss.mmm
 */
function formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}

@localized()
@customElement('rtc-function-console')
export class RtcFunctionConsole extends LitElement {
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

    /** Set of expanded data indices */
    @state()
    private _expandedData = new Set<number>();

    private _consoleBody: HTMLDivElement | null = null;

    updated(changed: Map<string, unknown>) {
        super.updated(changed);

        // Auto-scroll to bottom when logs change
        if (changed.has('_debugCtx') && this._consoleBody) {
            this._consoleBody.scrollTop = this._consoleBody.scrollHeight;
        }
    }

    private _toggleData(index: number) {
        const newExpanded = new Set(this._expandedData);
        if (newExpanded.has(index)) {
            newExpanded.delete(index);
        } else {
            newExpanded.add(index);
        }
        this._expandedData = newExpanded;
    }

    private _formatData(data: unknown): string {
        try {
            return JSON.stringify(data, null, 2);
        } catch {
            return String(data);
        }
    }

    private _renderLogEntry(entry: LogEntry, index: number) {
        const hasData = entry.data !== undefined;
        const isExpanded = this._expandedData.has(index);

        return html`
            <div class="log-entry">
                <span class="log-timestamp" title="${new Date(entry.timestamp).toISOString()}">
                    ${formatTime(entry.timestamp)}
                </span>
                <span class="log-level ${entry.level}">[${entry.level}]</span>
                <span class="log-message">
                    ${entry.message}
                    ${hasData ? html`
                        <div
                            class="log-data ${isExpanded ? '' : 'collapsed'}"
                            @click=${() => this._toggleData(index)}
                            title=${isExpanded ? msg('点击折叠') : msg('点击展开')}
                        >${this._formatData(entry.data)}</div>
                    ` : nothing}
                </span>
            </div>
        `;
    }

    render() {
        void this._localeCtx.locale;

        const logs = this._debugCtx?.state.logs ?? [];

        return html`
            <div class="console-header">
                <span class="console-label">${msg('控制台')}</span>
                <button class="clear-btn" @click=${() => this._debugCtx?.actions.clearLogs()}>
                    ${msg('清空')}
                </button>
            </div>
            <div class="console-body" ${((el: HTMLDivElement) => { this._consoleBody = el; }) as any}>
                ${logs.length === 0
                    ? html`<div class="empty-console">${msg('暂无日志输出')}</div>`
                    : logs.map((entry, i) => this._renderLogEntry(entry, i))}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-function-console': RtcFunctionConsole;
    }
}
