/**
 * RTC Error Message Component
 *
 * Renders an error feedback message with category-specific icon and color,
 * title, description, optional retry button, and collapsible raw error details.
 *
 * ## Layout model (时间线布局)
 *
 * Reuses the shared timeline layout (dot + vertical line) from timeline.styles.ts.
 * The dot color reflects the error category.
 *
 * ## XSS safety
 *
 * All text content is rendered via Lit's `html` template literal, which
 * auto-escapes HTML entities. The raw_error field is rendered inside a <pre>
 * element using text content interpolation (also auto-escaped by Lit).
 * No innerHTML or unsafeHTML is used anywhere.
 *
 * @element rtc-error-message
 * @csspart dot - The timeline dot (colored by error category)
 * @csspart content - The error content area
 */
import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {timelineStyles} from './timeline.styles.js';
import type {ErrorContent, ErrorCategory} from '@rtc-agent/protocol';
import type {Message} from '../../types/index.js';
import {formatTimestampCompact} from '../../utils/format.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('ErrorMessage');

/**
 * Category-specific configuration for icon, color, and label.
 */
interface CategoryConfig {
    icon: string;
    color: string;
    label: string;
}

/**
 * Maps ErrorCategory to visual configuration.
 *
 * Color semantics:
 *   - api: blue (external service issue)
 *   - timeout: yellow (transient, recoverable)
 *   - system: red (internal failure)
 *   - context: orange (resource limit)
 *   - network: purple (connectivity)
 *   - permission: red (auth/access)
 *   - stream: gray (transport)
 *   - tool: gray (tool execution)
 *
 * Note: labels are resolved via `_getCategoryLabel()` at render time so that
 * lit-localize can track them for i18n. Keeping them out of this static map
 * avoids the "msg() outside reactive context" pitfall.
 */
const CATEGORY_CONFIG: Record<ErrorCategory, Omit<CategoryConfig, 'label'>> = {
    api: {icon: '⚠️', color: '#2563eb'},
    timeout: {icon: '⏰', color: '#ca8a04'},
    system: {icon: '❌', color: '#dc2626'},
    context: {icon: '\u{1F4E6}', color: '#ea580c'},
    network: {icon: '\u{1F310}', color: '#7c3aed'},
    permission: {icon: '\u{1F512}', color: '#dc2626'},
    stream: {icon: '\u{1F4E1}', color: '#6b7280'},
    tool: {icon: '\u{1F527}', color: '#6b7280'},
};

const DEFAULT_CONFIG: Omit<CategoryConfig, 'label'> = {icon: '⚠️', color: '#6b7280'};

@localized()
@customElement('rtc-error-message')
export class RtcErrorMessage extends LitElement {
    static styles = [
        timelineStyles,
        css`
            :host {
                display: block;
            }

            /*
             * Error card container.
             * Bordered box with category-tinted left accent bar.
             */
            .error-card {
                border: 1px solid var(--rtc-color-border);
                border-radius: var(--rtc-border-radius);
                overflow: hidden;
                background: var(--rtc-color-bg-secondary);
            }

            .error-card-header {
                display: flex;
                align-items: flex-start;
                gap: var(--rtc-spacing-xs);
                padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
            }

            .error-icon {
                flex-shrink: 0;
                font-size: var(--rtc-font-size-lg);
                line-height: 1;
            }

            .error-body {
                flex: 1;
                min-width: 0;
            }

            .error-title {
                font-weight: var(--rtc-font-weight-semibold, 600);
                font-size: var(--rtc-font-size-base);
                color: var(--rtc-color-text);
                margin: 0 0 var(--rtc-spacing-xs) 0;
                line-height: var(--rtc-line-height-tight, 1.4);
            }

            .error-message {
                font-size: var(--rtc-font-size-sm);
                color: var(--rtc-color-text-secondary);
                line-height: var(--rtc-line-height-normal, 1.5);
                margin: 0;
                word-break: break-word;
            }

            /*
             * Category accent bar (left border).
             * Color is set inline via style attribute for dynamic category coloring.
             */
            .error-card[data-has-accent] {
                border-left-width: 3px;
            }

            /*
             * Action bar: retry button + raw error toggle.
             */
            .error-actions {
                display: flex;
                align-items: center;
                gap: var(--rtc-spacing-sm);
                padding: var(--rtc-spacing-xs) var(--rtc-spacing-md) var(--rtc-spacing-sm);
            }

            .error-retry-btn {
                display: inline-flex;
                align-items: center;
                gap: var(--rtc-spacing-xs);
                background: var(--rtc-color-primary);
                color: var(--rtc-color-text-inverse);
                border: none;
                padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
                border-radius: var(--rtc-border-radius-sm);
                font-size: var(--rtc-font-size-sm);
                cursor: pointer;
                transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
            }

            .error-retry-btn:hover {
                background: var(--rtc-color-primary-hover, var(--rtc-color-primary));
            }

            .error-raw-toggle {
                display: inline-flex;
                align-items: center;
                gap: var(--rtc-spacing-xs);
                background: none;
                border: none;
                color: var(--rtc-color-text-tertiary);
                font-size: var(--rtc-font-size-xs);
                cursor: pointer;
                padding: var(--rtc-spacing-xs) 0;
            }

            .error-raw-toggle:hover {
                color: var(--rtc-color-text-secondary);
            }

            /*
             * Raw error collapsible panel.
             * <pre> with text content — no innerHTML, XSS-safe.
             */
            .error-raw-panel {
                border-top: 1px solid var(--rtc-color-border);
                padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
                background: var(--rtc-color-bg-tertiary, var(--rtc-color-bg-secondary));
                max-height: 200px;
                overflow-y: auto;
            }

            .error-raw-panel pre {
                margin: 0;
                font-family: var(--rtc-font-family-mono);
                font-size: var(--rtc-font-size-xs);
                color: var(--rtc-color-text-secondary);
                white-space: pre-wrap;
                word-break: break-all;
            }

            /*
             * Category label badge.
             */
            .error-category-label {
                font-size: var(--rtc-font-size-xs);
                color: var(--rtc-color-text-tertiary);
                margin-left: auto;
                flex-shrink: 0;
            }
        `,
    ];

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /**
     * The full Message object (for timestamp, clientId, etc.).
     * The error content is extracted from message.content.data.
     */
    @property({type: Object})
    message: Message = {clientId: '', role: 'assistant', content: {type: 'error', data: {}}, timestamp: 0, syncStatus: 'synced'};

    /**
     * Whether the raw error detail panel is expanded.
     * Default collapsed to avoid overwhelming the user with technical details.
     */
    @state()
    private _rawErrorExpanded = false;

    /**
     * Extract ErrorContent from the message's content data.
     */
    private get _errorData(): ErrorContent | null {
        const data = this.message?.content?.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            return data as ErrorContent;
        }
        return null;
    }

    /**
     * Look up the visual configuration for the current error category.
     *
     * Labels are resolved through lit-localize's `msg()` so they update when
     * the user switches locale. Each case is a separate `msg()` call so the
     * extractor can pick them up as translation keys.
     */
    private _getCategoryConfig(category: string | undefined): CategoryConfig {
        const base = (category && category in CATEGORY_CONFIG)
            ? CATEGORY_CONFIG[category as ErrorCategory]
            : DEFAULT_CONFIG;
        return {...base, label: this._getCategoryLabel(category)};
    }

    /**
     * Resolve the localized label for an error category.
     *
     * A switch with one `msg()` per case is required: lit-localize's extractor
     * needs static string arguments and cannot follow dynamic lookups.
     */
    private _getCategoryLabel(category: string | undefined): string {
        switch (category) {
            case 'api': return msg('API 错误');
            case 'timeout': return msg('超时');
            case 'system': return msg('系统错误');
            case 'context': return msg('上下文错误');
            case 'network': return msg('网络错误');
            case 'permission': return msg('权限错误');
            case 'stream': return msg('流错误');
            case 'tool': return msg('工具错误');
            default: return msg('错误');
        }
    }

    private _toggleRawError() {
        this._rawErrorExpanded = !this._rawErrorExpanded;
    }

    private _handleRetry() {
        this.dispatchEvent(new CustomEvent('rtc-error-retry', {
            bubbles: true,
            composed: true,
            detail: {clientId: this.message.clientId},
        }));
    }

    render() {
        void this._localeCtx.locale;
        const errorData = this._errorData;
        if (!errorData) return nothing;

        const config = this._getCategoryConfig(errorData.category);

        return html`
            <div class="timeline-item">
                <div
                    class="timeline-dot"
                    part="dot"
                    style="background: ${config.color}"
                    data-timestamp=${formatTimestampCompact(this.message.timestamp)}
                ></div>
                <div class="timeline-content" part="content">
                    <div
                        class="error-card"
                        data-has-accent
                        style="border-left-color: ${config.color}"
                    >
                        <div class="error-card-header">
                            <span class="error-icon">${config.icon}</span>
                            <div class="error-body">
                                <p class="error-title">${errorData.title}</p>
                                <p class="error-message">${errorData.message}</p>
                            </div>
                            <span class="error-category-label">${config.label}</span>
                        </div>
                        ${errorData.retryable || (errorData.show_raw_error && errorData.raw_error)
                            ? html`
                                <div class="error-actions">
                                    ${errorData.retryable
                                        ? html`<button class="error-retry-btn" @click=${this._handleRetry} aria-label=${msg('重试')}>${msg('重试')}</button>`
                                        : null}
                                    ${errorData.show_raw_error && errorData.raw_error
                                        ? html`<button class="error-raw-toggle" @click=${this._toggleRawError} aria-expanded=${this._rawErrorExpanded}>
                                            ${this._rawErrorExpanded ? '▾' : '▸'} ${msg('原始错误')}
                                        </button>`
                                        : null}
                                </div>
                            `
                            : null}
                        ${this._rawErrorExpanded && errorData.raw_error
                            ? html`
                                <div class="error-raw-panel">
                                    <pre>${errorData.raw_error}</pre>
                                </div>
                            `
                            : null}
                    </div>
                </div>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-error-message': RtcErrorMessage;
    }
}
