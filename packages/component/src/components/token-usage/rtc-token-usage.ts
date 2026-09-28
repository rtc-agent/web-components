/**
 * Token Usage Component
 *
 * Circular progress bar showing session token usage.
 * Embedded in rtc-input-area's toolbar.
 *
 * Data sources:
 * - estimatedNext: estimated next turn token count (real-time from backend)
 * - totalTokens: cumulative total token count
 * - details: per-item token data
 *
 * @element rtc-token-usage
 *
 * ## Styling
 * - Circular progress: SVG circle + stroke-dasharray
 * - Color thresholds: 50% yellow, 70% red
 * - Hover shows detail panel
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens } from '../../styles/tokens.js';
import { lightTheme } from '../../styles/themes/light.js';
import { darkTheme } from '../../styles/themes/dark.js';
import { baseStyles } from '../../styles/base.js';

/** Default progress bar total (fallback when compressionThreshold is not provided) */
const DEFAULT_TOKEN_BUDGET = 1_000_000;

@customElement('rtc-token-usage')
export class RtcTokenUsage extends LitElement {
    static styles = [
        tokens,
        lightTheme,
        darkTheme,
        baseStyles,
        css`
            :host {
                display: inline-flex;
                align-items: center;
                position: relative;
            }

            .token-circle {
                width: 24px;
                height: 24px;
                cursor: pointer;
                position: relative;
            }

            .token-circle svg {
                width: 100%;
                height: 100%;
                transform: rotate(-90deg);
            }

            .circle-bg {
                fill: none;
                stroke: var(--rtc-color-bg-tertiary);
                stroke-width: 3;
            }

            .circle-progress {
                fill: none;
                stroke: var(--rtc-color-primary);
                stroke-width: 3;
                stroke-linecap: round;
                transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
            }

            .circle-progress.warning {
                stroke: var(--rtc-color-warning);
            }

            .circle-progress.danger {
                stroke: var(--rtc-color-error);
            }

            /* Hover panel */
            .token-tooltip {
                display: none;
                position: absolute;
                bottom: calc(100% + 8px);
                left: 50%;
                transform: translateX(-50%);
                min-width: 200px;
                padding: 12px;
                background: var(--rtc-color-bg);
                border: 1px solid var(--rtc-color-border);
                border-radius: var(--rtc-border-radius-lg);
                box-shadow: var(--rtc-shadow-lg);
                z-index: var(--rtc-z-local-3);
                font-family: var(--rtc-font-family-base);
                font-size: var(--rtc-font-size-xs);
                color: var(--rtc-color-text);
            }

            :host(:hover) .token-tooltip {
                display: block;
            }

            .tooltip-header {
                font-weight: 600;
                margin-bottom: 8px;
                color: var(--rtc-color-text);
            }

            .tooltip-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 0;
                color: var(--rtc-color-text-secondary);
            }

            .tooltip-row .label {
                color: var(--rtc-color-text-tertiary);
            }

            .tooltip-row .value {
                font-family: var(--rtc-font-family-mono);
                font-weight: 500;
            }

            .tooltip-divider {
                height: 1px;
                background: var(--rtc-color-border);
                margin: 8px 0;
            }

            .tooltip-summary {
                display: flex;
                justify-content: space-between;
                font-weight: 600;
                color: var(--rtc-color-text);
            }

            .tooltip-compression {
                margin-top: 8px;
                padding: 6px 8px;
                background: var(--rtc-color-bg-secondary);
                border-radius: var(--rtc-border-radius-sm);
                font-size: 11px;
                color: var(--rtc-color-text-secondary);
            }

            .tooltip-compression.warning {
                color: var(--rtc-color-warning);
            }
        `,
    ];

    /* ── Properties ── */

    /** Theme mode */
    @property({ type: String, reflect: true })
    theme: 'light' | 'dark' | 'system' = 'system';

    /** Estimated next turn token count */
    @property({ type: Number, attribute: false })
    estimatedNext = 0;

    /** Cumulative total token count */
    @property({ type: Number, attribute: false })
    totalTokens = 0;

    /** Cumulative cost in USD */
    @property({ type: Number, attribute: false })
    totalCostUsd = 0;

    /** Compression trigger threshold (pushed from backend, used as circular progress denominator) */
    @property({ type: Number, attribute: false })
    compressionThreshold = 0;

    /** Compression progress (0-100) */
    @property({ type: Number, attribute: false })
    compressionProgress = 0;

    /** Rounds until compression (-1 = threshold already exceeded) */
    @property({ type: Number, attribute: false })
    roundsUntilCompression = -1;

    /** Per-item token data */
    @property({ type: Object, attribute: false })
    details?: {
        input?: number;
        output?: number;
        cachedRead?: number;
        cachedWrite?: number;
        reasoning?: number;
    };

    /* ── Computed ── */

    /** Calculate progress percentage: estimatedNext / compressionThreshold */
    private get _percentage(): number {
        const budget = this.compressionThreshold > 0 ? this.compressionThreshold : DEFAULT_TOKEN_BUDGET;
        return Math.min((this.estimatedNext / budget) * 100, 100);
    }

    /** Calculate color class name */
    private get _progressClass(): string {
        if (this._percentage >= 70) return 'danger';
        if (this._percentage >= 50) return 'warning';
        return '';
    }

    /** Calculate cache hit rate: cachedRead / (cachedRead + input), capped at 99% */
    private get _cacheHitRate(): number | null {
        if (!this.details) return null;
        const cachedRead = this.details.cachedRead ?? 0;
        const input = this.details.input ?? 0;
        const denominator = cachedRead + input;
        if (denominator === 0) return null;
        return Math.min(99, Math.round((cachedRead / denominator) * 100));
    }

    /** SVG circle parameters */
    private get _circleParams() {
        const radius = 9;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (this._percentage / 100) * circumference;
        return { radius, circumference, offset };
    }

    /* ── Render ── */

    render() {
        const { radius, circumference, offset } = this._circleParams;
        const percentageDisplay = Math.round(this._percentage);

        return html`
            <div class="token-circle" title="Token 使用情况">
                <svg viewBox="0 0 24 24">
                    <circle
                        class="circle-bg"
                        cx="12"
                        cy="12"
                        r=${radius}
                    ></circle>
                    <circle
                        class="circle-progress ${this._progressClass}"
                        cx="12"
                        cy="12"
                        r=${radius}
                        stroke-dasharray=${circumference}
                        stroke-dashoffset=${offset}
                    ></circle>
                </svg>
            </div>

            <div class="token-tooltip">
                <div class="tooltip-header">Token 使用详情</div>

                ${this.details
                    ? html`
                          ${this.details.input != null
                              ? html`<div class="tooltip-row">
                                    <span class="label">输入</span>
                                    <span class="value"
                                        >${this._formatNumber(
                                            this.details.input,
                                        )}</span
                                    >
                                </div>`
                              : ''}
                          ${this.details.output != null
                              ? html`<div class="tooltip-row">
                                    <span class="label">输出</span>
                                    <span class="value"
                                        >${this._formatNumber(
                                            this.details.output,
                                        )}</span
                                    >
                                </div>`
                              : ''}
                          ${this.details.cachedRead != null || this.details.cachedWrite != null
                              ? html`<div class="tooltip-row">
                                    <span class="label">缓存</span>
                                    <span class="value"
                                        >${this._formatNumber(
                                            (this.details.cachedRead ?? 0) + (this.details.cachedWrite ?? 0),
                                        )}</span
                                    >
                                </div>`
                              : ''}
                          ${this._cacheHitRate != null
                              ? html`<div class="tooltip-row">
                                    <span class="label">缓存命中率</span>
                                    <span class="value">${this._cacheHitRate}%</span>
                                </div>`
                              : ''}
                          ${this.details.reasoning != null
                              ? html`<div class="tooltip-row">
                                    <span class="label">推理</span>
                                    <span class="value">${this._formatNumber(this.details.reasoning)}</span>
                                </div>`
                              : ''}
                      `
                    : ''}

                <div class="tooltip-divider"></div>

                <div class="tooltip-summary">
                    <span>总计</span>
                    <span>${this._formatNumber(this.totalTokens)}</span>
                </div>

                <div class="tooltip-row">
                    <span class="label">预估下轮</span>
                    <span class="value"
                        >${this._formatNumber(this.estimatedNext)}
                        (${percentageDisplay}%)</span
                    >
                </div>

                ${this.roundsUntilCompression >= 0 &&
                this.roundsUntilCompression <= 3
                    ? html`<div
                          class="tooltip-compression ${this
                              .roundsUntilCompression <= 1
                              ? 'warning'
                              : ''}"
                      >
                          ${this.roundsUntilCompression} 轮后压缩
                          (${Math.round(this.compressionProgress)}%)
                      </div>`
                    : ''}
            </div>
        `;
    }

    /* ── Helpers ── */

    private _formatNumber(n: number): string {
        if (n >= 1_000_000) {
            return `${(n / 1_000_000).toFixed(1)}M`;
        }
        if (n >= 1_000) {
            return `${(n / 1_000).toFixed(1)}K`;
        }
        return String(n);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-token-usage': RtcTokenUsage;
    }
}
