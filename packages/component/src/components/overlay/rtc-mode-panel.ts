/**
 * RTC Mode Panel Component
 *
 * Floating panel showing available modes for selection.
 *
 * @element rtc-mode-panel
 * @fires rtc-mode-selected - User selected a mode (detail: { mode })
 * @fires rtc-mode-panel-close - User pressed Escape to close
 * @csspart list - The mode list container
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-mode-panel.styles.js';
import {MODE_CONFIGS} from '../../contexts/mode.js';
import {handIcon, codeIcon, planIcon, zapIcon, gearIcon, checkIcon} from '../../icons/index.js';

const MODE_ICONS: Record<string, ReturnType<typeof html>> = {
    manual: handIcon,
    edit: codeIcon,
    plan: planIcon,
    auto: zapIcon,
    bypass: gearIcon,
};

@localized()
@customElement('rtc-mode-panel')
export class RtcModePanel extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[RtcModePanel] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @property({type: Array})
    modes: string[] = [];

    @property({type: String, attribute: 'current-mode'})
    currentMode = '';

    private _handleSelect(mode: string) {
        this.dispatchEvent(
            new CustomEvent('rtc-mode-selected', {
                bubbles: true,
                composed: true,
                detail: {mode},
            })
        );
    }

    private _onKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            this.dispatchEvent(
                new CustomEvent('rtc-mode-panel-close', {
                    bubbles: true,
                    composed: true,
                })
            );
        }
    };

    connectedCallback() {
        super.connectedCallback();
        this.addEventListener('keydown', this._onKeydown);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener('keydown', this._onKeydown);
    }

    render() {
        void this._localeCtx.locale;
        return html`
      <div class="mode-list" part="list">
        ${this.modes.map(
            (m) => {
                const config = MODE_CONFIGS.find((c) => c.mode === m);
                const label = config?.label ? this._translateLabel(m, config.label) : m;
                const desc = config?.description ? this._translateDesc(m, config.description) : '';
                return html`
                <div
                  class="mode-item ${classMap({active: m === this.currentMode})}"
                  @click=${() => this._handleSelect(m)}
                >
                  <span class="mode-icon">${MODE_ICONS[m] ?? ''}</span>
                  <span class="mode-text">
                    <span class="mode-label">${label}</span>
                    ${desc ? html`<span class="mode-desc">${desc}</span>` : ''}
                  </span>
                  <span class="mode-check">${m === this.currentMode ? checkIcon : nothing}</span>
                </div>
              `;
            }
        )}
      </div>
    `;
    }

    private _translateLabel(mode: string, fallback: string): string {
        switch (mode) {
            case 'manual': return msg('手动');
            case 'edit': return msg('编辑');
            case 'plan': return msg('计划');
            case 'auto': return msg('自动');
            case 'bypass': return msg('绕过权限');
            default: return fallback;
        }
    }

    private _translateDesc(mode: string, fallback: string): string {
        switch (mode) {
            case 'manual': return msg('Claude 会在每次编辑前征求你的同意');
            case 'edit': return msg('Claude 会自动编辑你选中的文本或整个文件');
            case 'plan': return msg('Claude 会先探索代码并展示计划，然后再进行编辑');
            case 'auto': return msg('Claude 会自动执行通过安全检查的操作，对有风险的操作会暂停');
            case 'bypass': return msg('Claude 不会在执行潜在危险命令前征求同意');
            default: return fallback;
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-mode-panel': RtcModePanel;
    }
}
