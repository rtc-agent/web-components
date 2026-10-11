/**
 * RTC Tool Confirm Component
 *
 * Modal dialog asking user to approve/deny a tool call.
 * Three actions: Yes (approve once), Yes-allow (approve all), No (deny).
 *
 * Keyboard shortcuts:
 * - Y: Approve (Yes)
 * - A: Approve all (when available)
 * - N / Escape: Deny
 * - Enter: Approve (Yes)
 *
 * @element rtc-tool-confirm
 * @fires rtc-tool-call-approved - User approved (detail: { toolCallId, allowAll })
 * @fires rtc-tool-call-denied - User denied (detail: { toolCallId })
 * @csspart backdrop - The backdrop overlay
 * @csspart dialog - The dialog card
 * @csspart params - The tool parameters display
 */
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import {
  localeContext,
  type LocaleContextValue,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import { styles } from './rtc-tool-confirm.styles.js';
import type { ToolCall } from '../../types/index.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('ToolConfirm');

@localized()
@customElement('rtc-tool-confirm')
export class RtcToolConfirm extends LitElement {
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

  @property({ type: Object })
  toolCall: ToolCall = {
    id: '',
    tool_name: '',
    input: '',
  };

  /** Whether the "allow all" option is shown */
  @property({ type: Boolean, attribute: 'show-allow-all' })
  showAllowAll = false;

  connectedCallback() {
    super.connectedCallback();
    // Focus the deny button by default (safer default)
    this.updateComplete.then(() => {
      const denyBtn = this.shadowRoot?.querySelector(
        '.action-btn.danger',
      ) as HTMLElement;
      denyBtn?.focus();
    });
  }

  private _approve(allowAll: boolean) {
    this.dispatchEvent(
      new CustomEvent('rtc-tool-call-approved', {
        bubbles: true,
        composed: true,
        detail: { toolCallId: this.toolCall.id, allowAll },
      }),
    );
  }

  private _deny() {
    this.dispatchEvent(
      new CustomEvent('rtc-tool-call-denied', {
        bubbles: true,
        composed: true,
        detail: { toolCallId: this.toolCall.id },
      }),
    );
  }

  private _onBackdropClick(e: Event) {
    // Only close if the backdrop itself was clicked (not the dialog)
    if ((e.target as HTMLElement).classList.contains('backdrop')) {
      this._deny();
    }
  }

  private _onKeyDown = (e: KeyboardEvent) => {
    // Don't handle keys if user is interacting with params scroll
    const target = e.target as HTMLElement;
    if (target.classList.contains('tool-params')) return;

    switch (e.key.toLowerCase()) {
      case 'escape':
      case 'n':
        e.preventDefault();
        this._deny();
        break;
      case 'y':
        e.preventDefault();
        this._approve(false);
        break;
      case 'a':
        if (this.showAllowAll) {
          e.preventDefault();
          this._approve(true);
        }
        break;
      case 'enter':
        e.preventDefault();
        this._approve(false);
        break;
    }
  };

  private _renderParams(): string {
    try {
      // input is a JSON string from the protocol, parse it for display
      const parsed = JSON.parse(this.toolCall.input);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // If parsing fails, return the raw input string
      return this.toolCall.input || '';
    }
  }

  /**
   * Format tool name for display with nice capitalization.
   */
  private _formatToolName(name: string): string {
    if (!name) return 'Tool';
    // Convert camelCase to spaced words
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }

  /**
   * Get a human-readable description of the tool's purpose.
   */
  private _getToolDescription(name: string): string {
    if (!name) return msg('执行工具操作');
    const descriptions: Record<string, string> = {
      read: msg('读取文件内容'),
      write: msg('写入文件内容'),
      ls: msg('列出目录内容'),
      grep: msg('搜索文件内容'),
      find: msg('查找文件'),
      script: msg('执行脚本'),
      todowrite: msg('更新任务列表'),
    };
    return descriptions[name.toLowerCase()] || msg('执行工具操作');
  }

  render() {
    void this._localeCtx.locale;
    const params = this._renderParams();
    const toolDescription = this._getToolDescription(this.toolCall.tool_name);

    return html`
      <div class="backdrop" part="backdrop" @click=${this._onBackdropClick}></div>
      <div
        class="dialog"
        part="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-desc"
        @keydown=${this._onKeyDown}
      >
        <div class="dialog-header">
          <svg class="dialog-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div>
            <div id="dialog-title" class="dialog-title">${msg('工具调用确认')}</div>
            <div id="dialog-desc" class="dialog-desc">
              ${msg('AI 想要执行以下操作，请确认是否允许。')}
            </div>
          </div>
        </div>

        <div class="tool-info">
          <div class="tool-info-header">
            <span class="tool-name">${this._formatToolName(this.toolCall.tool_name)}</span>
            <span class="tool-description">${toolDescription}</span>
          </div>
          <div class="tool-params-wrapper">
            <label class="params-label">${msg('参数详情')}</label>
            <pre class="tool-params" part="params" tabindex="0">${params}</pre>
          </div>
        </div>

        <div class="actions">
          <button class="action-btn danger" data-action="no" @click=${() => this._deny()}>
            ${msg('拒绝')} <span class="shortcut-hint">(N)</span>
          </button>
          <div class="action-group">
            <button class="action-btn primary" data-action="yes" @click=${() => this._approve(false)}>
              ${msg('允许')} <span class="shortcut-hint">(Y)</span>
            </button>
            ${this.showAllowAll
              ? html`
                <button class="action-btn" data-action="yes-allow" @click=${() => this._approve(true)}>
                  ${msg('全部允许')} <span class="shortcut-hint">(A)</span>
                </button>
              `
              : ''}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-tool-confirm': RtcToolConfirm;
  }
}
