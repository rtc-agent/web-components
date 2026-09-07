/**
 * RTC Command Panel Component
 *
 * Floating panel showing available slash commands.
 * Similar to rtc-mode-panel but for slash commands.
 *
 * @element rtc-command-panel
 * @fires rtc-command-selected - User selected a command (detail: { command, args? })
 * @fires rtc-command-panel-close - User pressed Escape or clicked outside
 * @csspart list - The command list container
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {styles} from './rtc-command-panel.styles.js';
import {gearIcon, clockIcon, checklistIcon} from '../../icons/index.js';

/** Command configuration */
export interface CommandConfig {
    /** Command name (without /) */
    name: string;
    /** Display label (with /) */
    label: string;
    /** Description */
    description: string;
    /** Whether the command is available */
    available: boolean;
    /** Icon template */
    icon: ReturnType<typeof html>;
}

/** Static config for all commands */
export const COMMAND_CONFIGS: CommandConfig[] = [
    {
        name: 'compact',
        label: '/compact',
        description: '压缩上下文，减少 token 消耗',
        available: true,
        icon: gearIcon,
    },
    {
        name: 'loop',
        label: '/loop',
        description: '循环执行任务',
        available: false,
        icon: clockIcon,
    },
    {
        name: 'goal',
        label: '/goal',
        description: '设定目标，持续工作直到达成',
        available: false,
        icon: checklistIcon,
    },
];

@customElement('rtc-command-panel')
export class RtcCommandPanel extends LitElement {
    static styles = styles;

    @property({type: Array})
    commands: CommandConfig[] = COMMAND_CONFIGS;

    private _handleSelect(command: CommandConfig) {
        if (!command.available) return;

        this.dispatchEvent(
            new CustomEvent('rtc-command-selected', {
                bubbles: true,
                composed: true,
                detail: {command: command.name},
            })
        );
    }

    private _onKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            this.dispatchEvent(
                new CustomEvent('rtc-command-panel-close', {
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
      <div class="command-list" part="list">
        ${this.commands.map(
            (cmd) => html`
                <div
                  class="command-item ${classMap({disabled: !cmd.available})}"
                  @click=${() => this._handleSelect(cmd)}
                  title=${cmd.available ? cmd.description : '即将推出'}
                >
                  <span class="command-icon">${cmd.icon}</span>
                  <span class="command-text">
                    <span class="command-label">${cmd.label}</span>
                    <span class="command-desc">${cmd.description}</span>
                  </span>
                  ${!cmd.available ? html`<span class="command-badge">即将推出</span>` : ''}
                </div>
              `
        )}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-command-panel': RtcCommandPanel;
    }
}
