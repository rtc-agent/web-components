/**
 * RTC Export Dialog Component
 *
 * Modal dialog for configuring session export options before exporting.
 * Provides controls for:
 * - Message limit (range slider with steps: 0, 100, 200...2000, MAX; default 200)
 * - Tool call inclusion (radio: include/exclude)
 * - Thinking content inclusion (radio: include/exclude)
 *
 * @element rtc-export-dialog
 * @fires rtc-export-confirm - User confirmed export with options
 *   detail: { limit: number, includeToolCalls: boolean, includeThinking: boolean }
 * @fires rtc-export-cancel - User cancelled the export
 * @csspart backdrop - The backdrop overlay
 * @csspart dialog - The dialog card
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-export-dialog.styles.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('ExportDialog');

/** Slider step increment. */
const LIMIT_STEP = 100;

/** Minimum limit value. */
const LIMIT_MIN = 100;

/** Maximum explicit limit value before MAX. */
const LIMIT_MAX_EXPLICIT = 2000;

/** Default limit value. */
const LIMIT_DEFAULT = 200;

/** Export options collected from the dialog form. */
export interface ExportOptions {
    /** Max messages to export. 0 = all messages. */
    limit: number;
    /** Whether to include tool call messages. */
    includeToolCalls: boolean;
    /** Whether to include thinking messages. */
    includeThinking: boolean;
}

@localized()
@customElement('rtc-export-dialog')
export class RtcExportDialog extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /** Total number of messages available for export. */
    @property({type: Number})
    totalMessages = 0;

    /** Current limit value (0 = all). */
    @state()
    private _limit = LIMIT_DEFAULT;

    /** Whether to include tool call messages. */
    @state()
    private _includeToolCalls = false;

    /** Whether to include thinking messages. */
    @state()
    private _includeThinking = false;

    /** Computed max value for the slider (at least LIMIT_MAX_EXPLICIT or totalMessages). */
    private get _sliderMax(): number {
        return Math.max(LIMIT_MAX_EXPLICIT, this.totalMessages);
    }

    /** Effective limit value (clamped to totalMessages, 0 means all). */
    private get _effectiveLimit(): number {
        if (this._limit >= this.totalMessages) {
            return 0; // All messages
        }
        return this._limit;
    }

    private _onLimitChange(e: Event) {
        const input = e.target as HTMLInputElement;
        this._limit = parseInt(input.value, 10);
    }

    private _setToolCalls(value: boolean) {
        this._includeToolCalls = value;
    }

    private _setThinking(value: boolean) {
        this._includeThinking = value;
    }

    private _confirm() {
        this.dispatchEvent(
            new CustomEvent<ExportOptions>('rtc-export-confirm', {
                bubbles: true,
                composed: true,
                detail: {
                    limit: this._effectiveLimit,
                    includeToolCalls: this._includeToolCalls,
                    includeThinking: this._includeThinking,
                },
            })
        );
    }

    private _cancel() {
        this.dispatchEvent(
            new CustomEvent('rtc-export-cancel', {
                bubbles: true,
                composed: true,
            })
        );
    }

    private _onBackdropClick(e: Event) {
        if ((e.target as HTMLElement).classList.contains('backdrop')) {
            this._cancel();
        }
    }

    render() {
        void this._localeCtx.locale;
        // Display logic: show "全部" only at the rightmost position (slider max),
        // otherwise show the numeric value
        const limitDisplay = this._limit >= this._sliderMax ? msg('全部') : String(this._limit);
        return html`
      <div class="backdrop" part="backdrop" @click=${this._onBackdropClick}></div>
      <div class="dialog" part="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div class="dialog-title" id="dialog-title">${msg('导出选项')}</div>

        <div class="form-group">
          <label class="form-label" for="limit-slider">
            ${msg('消息数量限制')}
          </label>
          <div class="range-wrapper">
            <input
              id="limit-slider"
              class="range-slider"
              type="range"
              min="${LIMIT_MIN}"
              max="${this._sliderMax}"
              step="${LIMIT_STEP}"
              .value="${String(this._limit)}"
              @input=${this._onLimitChange}
            />
            <span class="range-value">${limitDisplay}</span>
          </div>
          <div class="form-hint">
            ${msg('拖动滑块选择导出的消息数量')}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${msg('工具调用')}</label>
          <div class="radio-group">
            <div
              class="radio-option ${this._includeToolCalls ? 'selected' : ''}"
              @click=${() => this._setToolCalls(true)}
            >
              <span class="radio-indicator"></span>
              ${msg('包括')}
            </div>
            <div
              class="radio-option ${!this._includeToolCalls ? 'selected' : ''}"
              @click=${() => this._setToolCalls(false)}
            >
              <span class="radio-indicator"></span>
              ${msg('不包括')}
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${msg('推理过程')}</label>
          <div class="radio-group">
            <div
              class="radio-option ${this._includeThinking ? 'selected' : ''}"
              @click=${() => this._setThinking(true)}
            >
              <span class="radio-indicator"></span>
              ${msg('包括')}
            </div>
            <div
              class="radio-option ${!this._includeThinking ? 'selected' : ''}"
              @click=${() => this._setThinking(false)}
            >
              <span class="radio-indicator"></span>
              ${msg('不包括')}
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="action-btn" @click=${this._cancel}>${msg('取消')}</button>
          <button class="action-btn primary" @click=${this._confirm}>${msg('导出')}</button>
        </div>
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-export-dialog': RtcExportDialog;
    }

    interface HTMLElementEventMap {
        'rtc-export-confirm': CustomEvent<ExportOptions>;
        'rtc-export-cancel': CustomEvent;
    }
}
