/**
 * Token Usage Component
 *
 * 圆形进度条显示 Session Token 使用情况。
 * 嵌入 rtc-input-area 的 toolbar 中。
 *
 * 数据来源：
 * - estimatedNext：预估下一轮 token 数（后端实时计算）
 * - totalTokens：累计总 token 数
 * - details：分项 token 数据
 *
 * @element rtc-token-usage
 *
 * ## 样式
 * - 圆形进度条：SVG circle + stroke-dasharray
 * - 颜色阈值：50% 黄色，70% 红色
 * - Hover 显示详细面板
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens } from '../../styles/tokens.js';
import { lightTheme } from '../../styles/themes/light.js';
import { darkTheme } from '../../styles/themes/dark.js';
import { baseStyles } from '../../styles/base.js';

/** 默认进度条总量（compressionThreshold 未传入时的兜底值） */
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
                stroke: var(--rtc-color-bg-tertiary, #e8e8e8);
                stroke-width: 3;
            }

            .circle-progress {
                fill: none;
                stroke: var(--rtc-color-primary, #2741FE);
                stroke-width: 3;
                stroke-linecap: round;
                transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
            }

            .circle-progress.warning {
                stroke: var(--rtc-color-warning, #F97802);
            }

            .circle-progress.danger {
                stroke: var(--rtc-color-error, #F44336);
            }

            /* Hover 面板 */
            .token-tooltip {
                display: none;
                position: absolute;
                bottom: calc(100% + 8px);
                left: 50%;
                transform: translateX(-50%);
                min-width: 200px;
                padding: 12px;
                background: var(--rtc-color-bg, #ffffff);
                border: 1px solid var(--rtc-color-border, #e0e0e0);
                border-radius: var(--rtc-border-radius-lg, 8px);
                box-shadow: var(--rtc-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.12));
                z-index: var(--rtc-z-local-3, 10);
                font-family: var(--rtc-font-family-base);
                font-size: var(--rtc-font-size-xs, 12px);
                color: var(--rtc-color-text, #1a1a2e);
            }

            :host(:hover) .token-tooltip {
                display: block;
            }

            .tooltip-header {
                font-weight: 600;
                margin-bottom: 8px;
                color: var(--rtc-color-text, #1a1a2e);
            }

            .tooltip-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 0;
                color: var(--rtc-color-text-secondary, #555570);
            }

            .tooltip-row .label {
                color: var(--rtc-color-text-tertiary, #8888a0);
            }

            .tooltip-row .value {
                font-family: var(--rtc-font-family-mono);
                font-weight: 500;
            }

            .tooltip-divider {
                height: 1px;
                background: var(--rtc-color-border, #e0e0e0);
                margin: 8px 0;
            }

            .tooltip-summary {
                display: flex;
                justify-content: space-between;
                font-weight: 600;
                color: var(--rtc-color-text, #1a1a2e);
            }

            .tooltip-compression {
                margin-top: 8px;
                padding: 6px 8px;
                background: var(--rtc-color-bg-secondary, #f5f5f5);
                border-radius: var(--rtc-border-radius-sm, 4px);
                font-size: 11px;
                color: var(--rtc-color-text-secondary, #555570);
            }

            .tooltip-compression.warning {
                color: var(--rtc-color-warning, #F97802);
            }
        `,
    ];

    /* ── Properties ── */

    /** 预估下一轮 token 数 */
    @property({ type: Number, attribute: false })
    estimatedNext = 0;

    /** 累计总 token 数 */
    @property({ type: Number, attribute: false })
    totalTokens = 0;

    /** 累计成本美元 */
    @property({ type: Number, attribute: false })
    totalCostUsd = 0;

    /** 压缩触发阈值（后端推送，用于圆环进度分母） */
    @property({ type: Number, attribute: false })
    compressionThreshold = 0;

    /** 压缩进度（0-100） */
    @property({ type: Number, attribute: false })
    compressionProgress = 0;

    /** 距离压缩的轮次（-1 = 已超过阈值） */
    @property({ type: Number, attribute: false })
    roundsUntilCompression = -1;

    /** 分项 token 数据 */
    @property({ type: Object, attribute: false })
    details?: {
        input?: number;
        output?: number;
        cachedRead?: number;
        cachedWrite?: number;
        reasoning?: number;
    };

    /* ── Computed ── */

    /** 计算进度百分比：estimatedNext / compressionThreshold */
    private get _percentage(): number {
        const budget = this.compressionThreshold > 0 ? this.compressionThreshold : DEFAULT_TOKEN_BUDGET;
        return Math.min((this.estimatedNext / budget) * 100, 100);
    }

    /** 计算颜色类名 */
    private get _progressClass(): string {
        if (this._percentage >= 70) return 'danger';
        if (this._percentage >= 50) return 'warning';
        return '';
    }

    /** 计算缓存命中率：cachedRead / (cachedRead + input)，上限 99% */
    private get _cacheHitRate(): number | null {
        if (!this.details) return null;
        const cachedRead = this.details.cachedRead ?? 0;
        const input = this.details.input ?? 0;
        const denominator = cachedRead + input;
        if (denominator === 0) return null;
        return Math.min(99, Math.round((cachedRead / denominator) * 100));
    }

    /** SVG circle 参数 */
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
