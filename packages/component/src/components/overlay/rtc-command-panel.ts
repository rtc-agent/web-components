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
 * @csspart search - The search input
 */
import { LitElement, html, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { localized, msg, str } from '@lit/localize';
import { consume } from '@lit/context';
import {
  localeContext,
  type LocaleContextValue,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import { styles } from './rtc-command-panel.styles.js';
import {
  gearIcon,
  clockIcon,
  checklistIcon,
  saveIcon,
} from '../../icons/index.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('CommandPanel');

/** Search icon (inline SVG since it's not in the icons module) */
const searchIcon = html`
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
    <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982a6 6 0 0 1 8.982 7.928l3.04 3.04a.749.749 0 0 1-.326 1.275a.749.749 0 0 1-.734-.215ZM11.5 6.5a5 5 0 1 0-10 0a5 5 0 0 0 10 0Z"/>
  </svg>
`;

/** Command configuration */
export interface CommandConfig {
  /** Command name (without /) */
  name: string;
  /** Display label (with /) */
  label: string;
  /** Description (getter for dynamic translation) */
  get description(): string;
  /** Whether the command is available */
  available: boolean;
  /** Icon template */
  icon: ReturnType<typeof html>;
  /** Keywords for search matching (optional) */
  keywords?: string[];
}

/** Static config for all commands */
export const COMMAND_CONFIGS: CommandConfig[] = [
  {
    name: 'compact',
    label: '/compact',
    get description() {
      return msg('压缩上下文，减少 token 消耗');
    },
    available: true,
    icon: gearIcon,
    keywords: ['compress', 'context', 'token', '压缩'], // Multi-language search keywords
  },
  {
    name: 'loop',
    label: '/loop',
    get description() {
      return msg('循环执行任务');
    },
    available: true,
    icon: clockIcon,
    keywords: ['repeat', 'cycle', '循环', '重复'], // Multi-language search keywords
  },
  {
    name: 'goal',
    label: '/goal',
    get description() {
      return msg('设定目标，持续工作直到达成');
    },
    available: true,
    icon: checklistIcon,
    keywords: ['target', 'objective', '目标', '任务'], // Multi-language search keywords
  },
  {
    name: 'export',
    label: '/export',
    get description() {
      return msg('导出当前对话为 HTML 文件');
    },
    available: true,
    icon: saveIcon,
    keywords: ['download', 'save', 'html', '导出', '下载'], // Multi-language search keywords
  },
];

@localized()
@customElement('rtc-command-panel')
export class RtcCommandPanel extends LitElement {
  static styles = styles;

  @consume({ context: localeContext, subscribe: true })
  @state()
  private _localeCtx: LocaleContextValue = {
    locale: sourceLocale,
    setLocale: async () => {
      log.warn('Locale context not initialized');
    },
    locales: [sourceLocale, ...targetLocales],
  };

  @property({ type: Array })
  commands: CommandConfig[] = COMMAND_CONFIGS;

  /** Search query for filtering commands */
  @state()
  private _searchQuery = '';

  /** Index of currently selected command (for keyboard navigation) */
  @state()
  private _selectedIndex = 0;

  /** Feedback message shown after command selection */
  @state()
  private _feedbackMessage = '';

  @query('.search-input')
  private _searchInput!: HTMLInputElement;

  /** Feedback timer for clearing the message */
  private _feedbackTimer?: number;

  /**
   * Filtered commands based on search query.
   * Matches against name, label, description, and keywords.
   */
  private get _filteredCommands(): CommandConfig[] {
    const query = this._searchQuery.toLowerCase().trim();
    if (!query) return this.commands;

    return this.commands.filter((cmd) => {
      // Match against name
      if (cmd.name.toLowerCase().includes(query)) return true;
      // Match against label (without /)
      if (cmd.label.toLowerCase().replace('/', '').includes(query)) return true;
      // Match against description
      if (cmd.description.toLowerCase().includes(query)) return true;
      // Match against keywords
      if (cmd.keywords?.some((kw) => kw.toLowerCase().includes(query))) {
        return true;
      }
      return false;
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('keydown', this._onKeydown);
    // Focus search input on connect
    this.updateComplete.then(() => {
      this._searchInput?.focus();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this._onKeydown);
    clearTimeout(this._feedbackTimer);
  }

  private _handleSearchInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this._searchQuery = input.value;
    this._selectedIndex = 0; // Reset selection when search changes
  }

  private _clearSearch() {
    this._searchQuery = '';
    this._selectedIndex = 0;
    this._searchInput?.focus();
  }

  private _handleSelect(command: CommandConfig) {
    if (!command.available) {
      this._showFeedback(msg('该命令即将推出'));
      return;
    }

    this._showFeedback(msg(str`已选择 ${command.label}`));

    this.dispatchEvent(
      new CustomEvent('rtc-command-selected', {
        bubbles: true,
        composed: true,
        detail: { command: command.name },
      }),
    );
  }

  private _showFeedback(message: string) {
    this._feedbackMessage = message;
    clearTimeout(this._feedbackTimer);
    this._feedbackTimer = window.setTimeout(() => {
      this._feedbackMessage = '';
    }, 2000);
  }

  private _onKeydown = (e: KeyboardEvent) => {
    const filtered = this._filteredCommands;

    if (e.key === 'Escape') {
      e.stopPropagation();
      this.dispatchEvent(
        new CustomEvent('rtc-command-panel-close', {
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    // Arrow key navigation
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._selectedIndex = Math.min(this._selectedIndex + 1, filtered.length - 1);
      this._scrollSelectedIntoView();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
      this._scrollSelectedIntoView();
      return;
    }

    // Enter to select
    if (e.key === 'Enter' && filtered[this._selectedIndex]) {
      e.preventDefault();
      this._handleSelect(filtered[this._selectedIndex]);
      return;
    }

    // Focus search on any printable character
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // If not already in search input, focus it and let the character through
      const target = e.target as HTMLElement;
      if (!target.classList.contains('search-input')) {
        this._searchInput?.focus();
      }
    }
  };

  private _scrollSelectedIntoView() {
    this.updateComplete.then(() => {
      const selectedEl = this.shadowRoot?.querySelector(
        `.command-item.selected`,
      ) as HTMLElement;
      selectedEl?.scrollIntoView({ block: 'nearest' });
    });
  }

  render() {
    void this._localeCtx.locale;
    const filtered = this._filteredCommands;
    const hasSearch = this._searchQuery.length > 0;
    const noResults = filtered.length === 0 && hasSearch;

    return html`
      <div class="command-panel">
        <div class="search-container" part="search">
          <span class="search-icon">${searchIcon}</span>
          <input
            class="search-input"
            type="text"
            placeholder=${msg('搜索命令...')}
            .value=${this._searchQuery}
            @input=${this._handleSearchInput}
          >
          ${hasSearch
            ? html`<button class="clear-btn" @click=${this._clearSearch} aria-label=${msg('清除')}>
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
                </svg>
              </button>`
            : nothing}
        </div>
        <div class="command-list" part="list" role="listbox">
          ${noResults
            ? html`<div class="no-results">${msg('未找到匹配的命令')}</div>`
            : filtered.map((cmd, i) => {
                const isSelected = i === this._selectedIndex;
                return html`
                  <div
                    class=${classMap({
                      'command-item': true,
                      disabled: !cmd.available,
                      selected: isSelected,
                    })}
                    role="option"
                    aria-selected=${isSelected}
                    @click=${() => this._handleSelect(cmd)}
                    @mouseenter=${() => (this._selectedIndex = i)}
                    title=${cmd.available ? cmd.description : msg('即将推出')}
                  >
                    <span class="command-icon">${cmd.icon}</span>
                    <span class="command-text">
                      <span class="command-label">${cmd.label}</span>
                      <span class="command-desc">${cmd.description}</span>
                    </span>
                    ${!cmd.available
                      ? html`<span class="command-badge">${msg('即将推出')}</span>`
                      : nothing}
                  </div>
                `;
              })}
        </div>
        ${this._feedbackMessage
          ? html`<div class="feedback-bar">${this._feedbackMessage}</div>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-command-panel': RtcCommandPanel;
  }
}
