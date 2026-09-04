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
import {customElement, property} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
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

@customElement('rtc-mode-panel')
export class RtcModePanel extends LitElement {
    static styles = styles;

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
        return html`
      <div class="mode-list" part="list">
        ${this.modes.map(
            (m) => {
                const config = MODE_CONFIGS.find((c) => c.mode === m);
                const label = config?.label || m;
                const desc = config?.description || '';
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
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-mode-panel': RtcModePanel;
    }
}
