/**
 * RTC Message More Menu Component
 *
 * A context menu that appears when the user clicks the more button on a
 * user message bubble. Provides options: copy, fork, and retry (failed only).
 *
 * Layout:
 *   ┌──────────────────┐
 *   │ 复制             │
 *   │ 分叉             │
 *   │ 重试  (failed)   │
 *   ├──────────────────┤
 *   │ MM-DD HH:mm      │
 *   └──────────────────┘
 *
 * @element rtc-message-more-menu
 */
import {LitElement, html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import type {SyncStatus} from '../../types/index.js';
import {formatTimestampCompact} from '../../utils/format.js';

@customElement('rtc-message-more-menu')
export class RtcMessageMoreMenu extends LitElement {
    static styles = css`
      :host {
        display: block;
        position: fixed;
        z-index: var(--rtc-z-overlay, 1000);
        /* top/left set by floating-ui via inline style */
      }

      .more-menu {
        background: var(--rtc-color-bg, #ffffff);
        border: 1px solid var(--rtc-color-border, #e5e7eb);
        border-radius: 8px;
        box-shadow: var(--rtc-shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
        padding: 4px 0;
        min-width: 140px;
      }

      .more-menu button {
        display: block;
        width: 100%;
        padding: 8px 12px;
        background: none;
        border: none;
        text-align: left;
        cursor: pointer;
        font-size: var(--rtc-font-size-sm, 13px);
        color: var(--rtc-color-text, #111827);
        box-sizing: border-box;
      }

      .more-menu button:hover:not([disabled]) {
        background: var(--rtc-color-bg-secondary, #f3f4f6);
      }

      .more-menu button[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .more-menu .divider {
        height: 1px;
        margin: 4px 0;
        background: var(--rtc-color-border, #e5e7eb);
      }

      .more-menu .footer {
        padding: 6px 12px;
        font-size: var(--rtc-font-size-xs, 11px);
        color: var(--rtc-color-text-tertiary, #9ca3af);
        text-align: center;
        user-select: none;
      }
    `;

    @property({type: String})
    syncStatus: SyncStatus = 'synced';

    @property({type: Number})
    timestamp = 0;

    /** 格式化时间戳为紧凑格式（委托给共享工具函数） */
    private get _formattedTimestamp(): string {
        return formatTimestampCompact(this.timestamp);
    }

    private _handleSelect(action: string) {
        this.dispatchEvent(
            new CustomEvent('rtc-message-more-menu-select', {
                bubbles: true,
                composed: true,
                detail: {action},
            })
        );
    }

    render() {
        return html`
      <div class="more-menu">
        <button @click=${() => this._handleSelect('copy')}>复制</button>
        <button
          ?disabled=${this.syncStatus !== 'synced'}
          @click=${() => this._handleSelect('fork')}
        >分叉</button>
        ${this.syncStatus === 'failed'
            ? html`<button @click=${() => this._handleSelect('retry')}>重试</button>`
            : null}
        <div class="divider"></div>
        <div class="footer">${this._formattedTimestamp}</div>
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-message-more-menu': RtcMessageMoreMenu;
    }
}
