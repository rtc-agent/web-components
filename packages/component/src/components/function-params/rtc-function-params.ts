/**
 * Function Params Component
 *
 * JSON parameter editor for function debugging.
 * Features: monospace font, line numbers, auto-format on blur, JSON validation.
 *
 * @element rtc-function-params
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-function-params.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {FunctionDebugContext, type FunctionDebugContextValue} from '../../contexts/function-debug.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('FunctionParams');

@localized()
@customElement('rtc-function-params')
export class RtcFunctionParams extends LitElement {
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

    /** Whether the current JSON is valid */
    @state()
    private _isValid = true;

    /** Line count for line numbers */
    @state()
    private _lineCount = 1;

    private _handleInput(e: Event) {
        const value = (e.target as HTMLTextAreaElement).value;
        this._updateLineCount(value);
        this._validate(value);

        if (this._debugCtx) {
            this._debugCtx.actions.updateParams(value);
        }
    }

    private _handleBlur(e: Event) {
        const textarea = e.target as HTMLTextAreaElement;
        const value = textarea.value.trim();

        // Auto-format valid JSON on blur
        if (value) {
            try {
                const parsed = JSON.parse(value);
                const formatted = JSON.stringify(parsed, null, 2);
                textarea.value = formatted;
                this._updateLineCount(formatted);
                this._isValid = true;

                if (this._debugCtx) {
                    this._debugCtx.actions.updateParams(formatted);
                }
            } catch {
                // Invalid JSON, leave as-is
            }
        }
    }

    private _handleKeydown(e: KeyboardEvent) {
        // Support Tab key for indentation (instead of focus switching)
        if (e.key === 'Tab') {
            e.preventDefault();
            const textarea = e.target as HTMLTextAreaElement;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;
            const newValue = value.substring(0, start) + '  ' + value.substring(end);
            textarea.value = newValue;
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            this._updateLineCount(newValue);

            if (this._debugCtx) {
                this._debugCtx.actions.updateParams(newValue);
            }
        }
    }

    private _validate(value: string) {
        if (!value.trim()) {
            this._isValid = true;
            return;
        }
        try {
            JSON.parse(value);
            this._isValid = true;
        } catch {
            this._isValid = false;
        }
    }

    private _updateLineCount(value: string) {
        this._lineCount = Math.max(1, value.split('\n').length);
    }

    render() {
        void this._localeCtx.locale;

        const params = this._debugCtx?.state.currentParams ?? '{}';
        const lineNumbers = Array.from({length: this._lineCount}, (_, i) => i + 1);

        return html`
            <div class="params-header">
                <span class="params-label">${msg('参数 (JSON)')}</span>
                ${!this._isValid ? html`<span class="params-error">${msg('Invalid JSON')}</span>` : ''}
            </div>
            <div class="params-editor ${this._isValid ? '' : 'invalid'}">
                <div class="line-numbers">
                    ${lineNumbers.map(n => html`<span>${n}</span>`)}
                </div>
                <textarea
                    .value=${params}
                    @input=${this._handleInput}
                    @blur=${this._handleBlur}
                    @keydown=${this._handleKeydown}
                    spellcheck="false"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    placeholder='{"key": "value"}'
                ></textarea>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-function-params': RtcFunctionParams;
    }
}
