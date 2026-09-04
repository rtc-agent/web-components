/**
 * RTC User Message Component
 *
 * Renders a single user message bubble with sync-status visual states.
 *
 * Layout model:
 *   .user-message-wrapper (sticky container)
 *     ├── .user-message (bubble with max-height, overflow hidden)
 *     │     ├── .user-message-text (text content)
 *     │     ├── .show-more-btn     (bottom-right, visible on hover when overflowing)
 *     │     └── .more-btn          (top-right, visible on hover)
 *     └── <rtc-message-more-menu> (position:fixed, positioned via floating-ui)
 *
 * ## Sync-status visual matrix:
 *
 * | syncStatus | more-btn | menu contents          | border style |
 * |------------|----------|------------------------|--------------|
 * | pending    | ✓        | 复制,分叉 + timestamp  | glow breathing animation |
 * | synced     | ✓        | 复制,分叉 + timestamp  | static default border |
 * | failed     | ✓        | 复制,分叉,重试 + timestamp | static error border |
 *
 * ## Attributes (reflected for CSS targeting):
 * - `data-sync-status`  — "pending" | "synced" | "failed"
 * - `data-overflow`     — set when text overflows the bubble
 * - `data-expanded`     — set after user clicks "Show more"
 * - `data-show-more-menu` — set when more menu is visible
 *
 * @element rtc-user-message
 * @csspart wrapper - The sticky wrapper
 * @csspart bubble  - The message bubble
 * @csspart text    - The text content area
 * @csspart show-more - The "Show more" button
 * @csspart more    - The more button (⋯)
 */
import {LitElement, html} from 'lit';
import {customElement, property, state, query} from 'lit/decorators.js';
import {
    computePosition,
    flip,
    shift,
    offset,
    autoUpdate,
} from '@floating-ui/dom';
import {styles} from './rtc-user-message.styles.js';
import type {Message} from '../../types/index.js';
import {copyToClipboard} from '../../utils/clipboard.js';
import './rtc-message-more-menu.js';

@customElement('rtc-user-message')
export class RtcUserMessage extends LitElement {
    static styles = styles;

    @property({type: Object})
    message: Message = {
        clientId: '',
        role: 'user',
        content: {type: 'text', data: ''},
        timestamp: 0,
        syncStatus: 'synced',
    };

    @state() private _isOverflowing = false;
    @state() private _expanded = false;
    @state() private _showMoreMenu = false;

    @query('.more-btn')
    private _moreBtn?: HTMLElement;

    /**
     * more-menu portal 容器（teleport 到 shadow root 层级，脱离 wrapper 的 stacking context）
     */
    private _moreMenuEl: HTMLElement | null = null;

    private _resizeObserver?: ResizeObserver;
    private _textEl?: HTMLElement;
    private _cleanupPosition: (() => void) | null = null;

    private _onDocClick = (e: MouseEvent) => {
        if (!this._showMoreMenu) return;
        const path = e.composedPath();
        // Don't close if clicking inside this component (menu or trigger button)
        if (path.includes(this)) return;
        this._closeMoreMenu();
    };

    private _onDocKeydown = (e: KeyboardEvent) => {
        if (!this._showMoreMenu) return;
        if (e.key === 'Escape') {
            this._closeMoreMenu();
        }
    };

    private _closeMoreMenu() {
        this._showMoreMenu = false;
        this.removeAttribute('data-show-more-menu');
        this._removeMenu();
    }

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();
        // Reflect initial sync status
        this.setAttribute('data-sync-status', this.message.syncStatus);
        // Listen for outside clicks to close more menu
        document.addEventListener('mousedown', this._onDocClick, true);
        document.addEventListener('keydown', this._onDocKeydown, true);
    }

    firstUpdated() {
        this._textEl = this.shadowRoot!.querySelector('.user-message-text') as HTMLElement;
        if (this._textEl) {
            this._resizeObserver = new ResizeObserver(() => this._checkOverflow());
            this._resizeObserver.observe(this._textEl);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._resizeObserver?.disconnect();
        this._stopPositioning();
        this._removeMenu();
        document.removeEventListener('mousedown', this._onDocClick, true);
        document.removeEventListener('keydown', this._onDocKeydown, true);
    }

    updated(changed: Map<string, unknown>) {
        super.updated(changed);
        if (changed.has('message')) {
            // Reflect sync-status attribute for CSS targeting
            this.setAttribute('data-sync-status', this.message.syncStatus);
            // Re-check overflow on message change
            this._checkOverflow();
        }
    }

    /* ── Overflow detection ── */

    private _checkOverflow() {
        if (!this._textEl) return;
        const bubble = this._textEl.parentElement as HTMLElement;
        if (!bubble) return;

        // When expanded the bubble has `max-height: none`, so its
        // clientHeight equals the full content height and can no longer
        // be used to detect overflow.  In that case compare against the
        // CSS variable that defines the collapsed max-height instead.
        let effectiveMaxHeight: number;
        if (this._expanded) {
            const cssVar = getComputedStyle(bubble)
                .getPropertyValue('--rtc-user-message-max-height')
                .trim();
            effectiveMaxHeight = parseFloat(cssVar);
            if (isNaN(effectiveMaxHeight)) effectiveMaxHeight = 120;
        } else {
            effectiveMaxHeight = bubble.clientHeight;
        }

        const isOverflowing = this._textEl.scrollHeight > effectiveMaxHeight;
        this._isOverflowing = isOverflowing;
        if (isOverflowing) {
            this.setAttribute('data-overflow', '');
        } else {
            this.removeAttribute('data-overflow');
        }
    }

    /* ── Helpers ── */

    private _getTextContent(): string {
        const content = this.message?.content;
        if (!content) return '';

        // Handle different content types
        switch (content.type) {
            case 'text':
            case 'markdown':
            case 'thinking':
                return typeof content.data === 'string' ? content.data : JSON.stringify(content.data);
            case 'summary':
                return '[消息已被压缩]';
            default:
                return typeof content.data === 'string' ? content.data : JSON.stringify(content.data);
        }
    }

    /* ── Event handlers ── */

    private _handleShowMore() {
        this._expanded = !this._expanded;
        if (this._expanded) {
            this.setAttribute('data-expanded', '');
        } else {
            this.removeAttribute('data-expanded');
        }
        this.dispatchEvent(
            new CustomEvent('rtc-user-message-show-more', {
                bubbles: true,
                composed: true,
                detail: {clientId: this.message.clientId},
            })
        );
    }

    private _handleMoreClick() {
        this._showMoreMenu = !this._showMoreMenu;
        if (this._showMoreMenu) {
            this.setAttribute('data-show-more-menu', '');
            this._teleportMenu();
        } else {
            this.removeAttribute('data-show-more-menu');
            this._removeMenu();
        }
    }

    /**
     * 将 more-menu teleport 到 shadow root 层级（脱离 wrapper 的 stacking context）。
     * floating-ui 使用 position: fixed（相对 viewport），坐标不受影响。
     */
    private async _teleportMenu() {
        if (!this.shadowRoot || this._moreMenuEl) return;

        const menu = document.createElement('rtc-message-more-menu') as HTMLElement;
        (menu as unknown as {syncStatus: string}).syncStatus = this.message.syncStatus;
        (menu as unknown as {timestamp: number}).timestamp = this.message.timestamp;
        menu.addEventListener('rtc-message-more-menu-select', ((e: Event) => {
            this._handleMenuSelect(e as CustomEvent);
        }) as EventListener);

        this.shadowRoot.appendChild(menu);
        this._moreMenuEl = menu;

        await this.updateComplete;
        this._startPositioning();
    }

    /**
     * 移除 teleported more-menu
     */
    private _removeMenu() {
        this._stopPositioning();
        if (this._moreMenuEl) {
            this._moreMenuEl.remove();
            this._moreMenuEl = null;
        }
    }

    private async _startPositioning() {
        const btn = this._moreBtn;
        const menu = this._moreMenuEl;
        if (!btn || !menu) return;

        this._cleanupPosition?.();
        this._cleanupPosition = autoUpdate(btn, menu, () => this._updatePosition());
    }

    private async _updatePosition() {
        const btn = this._moreBtn;
        const menu = this._moreMenuEl;
        if (!btn || !menu) return;

        const {x, y} = await computePosition(btn, menu, {
            placement: 'bottom-end',
            middleware: [
                offset(6),
                flip({padding: 8}),
                shift({padding: 8}),
            ],
        });
        Object.assign(menu.style, {
            left: `${x}px`,
            top: `${y}px`,
        });
    }

    private _stopPositioning() {
        this._cleanupPosition?.();
        this._cleanupPosition = null;
    }

    private _handleMenuSelect(event: CustomEvent) {
        const action = event.detail?.action as string;
        this._showMoreMenu = false;
        this.removeAttribute('data-show-more-menu');
        this._removeMenu();

        switch (action) {
            case 'copy':
                this._handleCopy();
                break;
            case 'fork':
                this._handleFork();
                break;
            case 'retry':
                this._handleResend();
                break;
        }
    }

    /**
     * 复制消息内容到剪贴板
     */
    private async _handleCopy() {
        const text = this._getTextContent();
        if (!text) return;

        const success = await copyToClipboard(text);
        this.dispatchEvent(new CustomEvent('rtc-toast-requested', {
            bubbles: true,
            composed: true,
            detail: {
                message: success ? '已复制到剪贴板' : '复制失败',
                type: success ? 'success' : 'error',
            },
        }));
    }

    /**
     * 分叉逻辑：派发自定义事件，由根组件处理
     */
    private _handleFork() {
        this.dispatchEvent(
            new CustomEvent('rtc-fork-requested', {
                bubbles: true,
                composed: true,
                detail: {
                    oldMessageClientId: this.message.clientId,
                    content: this._getTextContent(),
                },
            })
        );
    }

    private _handleResend() {
        this.dispatchEvent(
            new CustomEvent('rtc-user-message-resend', {
                bubbles: true,
                composed: true,
                detail: {message: this.message},
            })
        );
    }

    /* ── Render ── */

    render() {
        const text = this._getTextContent();

        return html`
      <div class="user-message-wrapper" part="wrapper">
        <div class="user-message" part="bubble">
          <div class="user-message-text" part="text">${text}</div>

          ${this._isOverflowing
            ? html`<button
                class="show-more-btn"
                part="show-more"
                @click=${this._handleShowMore}
              >${this._expanded ? 'Show less' : 'Show more'}</button>`
            : null}

          <button
            class="more-btn"
            part="more"
            title="More"
            @click=${this._handleMoreClick}
          >⋯</button>
        </div>
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-user-message': RtcUserMessage;
    }
}
