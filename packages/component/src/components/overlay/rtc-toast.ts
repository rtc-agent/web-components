/**
 * RTC Toast Component
 *
 * 全局通知组件，用于显示操作反馈（复制成功、错误提示等）。
 *
 * ## 架构
 *
 * 事件驱动，不是全局 API：
 * 1. 子组件 dispatch `rtc-toast-requested` 事件
 * 2. `<rtc-agent>` 监听事件，将 toast 推入 `@state()` 数组
 * 3. 本组件响应式渲染 toast 列表
 *
 * ## 事件接口
 *
 * ```typescript
 * // 子组件触发
 * this.dispatchEvent(new CustomEvent('rtc-toast-requested', {
 *   bubbles: true,
 *   composed: true,
 *   detail: { message: '已复制', type: 'success' }
 * }));
 * ```
 *
 * @element rtc-toast
 */
import {LitElement, html, css, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

@localized()
@customElement('rtc-toast')
export class RtcToast extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      top: var(--rtc-spacing-xl, 32px);
      left: 50%;
      transform: translateX(-50%);
      z-index: var(--rtc-z-toast, 1000);
      display: flex;
      flex-direction: column;
      gap: var(--rtc-spacing-sm, 8px);
      pointer-events: none;
      /* 限制在父容器内 */
      max-width: calc(100% - var(--rtc-spacing-lg, 24px) * 2);
    }

    .toast-item {
      display: flex;
      align-items: center;
      gap: var(--rtc-spacing-sm, 8px);
      padding: var(--rtc-spacing-sm, 8px) var(--rtc-spacing-md, 16px);
      background: var(--rtc-color-bg, #ffffff);
      border: 1px solid var(--rtc-color-border, #e0e0e0);
      border-radius: var(--rtc-border-radius, 6px);
      box-shadow: var(--rtc-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.12));
      font-size: var(--rtc-font-size-sm, 13px);
      color: var(--rtc-color-text, #333333);
      pointer-events: auto;
      animation: toast-enter 0.2s ease-out;
      outline: none;
    }

    .toast-item:focus-visible {
      outline: 2px solid var(--rtc-color-border-focus, #2741fe);
      outline-offset: 2px;
    }

    .toast-action {
      flex-shrink: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: var(--rtc-font-size-sm, 13px);
      font-weight: 500;
      color: var(--rtc-color-primary, #2741fe);
      padding: 2px 8px;
      border-radius: 4px;
      transition: background 0.15s ease;
    }

    .toast-action:hover {
      background: var(--rtc-color-bg-hover, #f5f5f5);
      text-decoration: underline;
    }

    .toast-action:focus-visible {
      outline: 2px solid var(--rtc-color-border-focus, #2741fe);
      outline-offset: 1px;
    }

    .toast-item.exiting {
      animation: toast-exit 0.15s ease-in forwards;
    }

    .toast-icon {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      color: #ffffff;
    }

    .toast-icon.success {
      background: var(--rtc-color-success, #4caf50);
    }

    .toast-icon.error {
      background: var(--rtc-color-error, #f44336);
    }

    .toast-icon.info {
      background: var(--rtc-color-info, #2ac9ff);
    }

    .toast-message {
      flex: 1;
      /* 文本溢出处理：单行截断 */
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      /* 限制最大宽度，防止过长内容撑开容器 */
      max-width: 400px;
    }

    .toast-close {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: var(--rtc-color-text-secondary, #666666);
      padding: 0;
      border-radius: 2px;
      transition: background 0.15s ease;
    }

    .toast-close:hover {
      background: var(--rtc-color-bg-hover, #f5f5f5);
    }

    @keyframes toast-enter {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes toast-exit {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-10px);
      }
    }

    /* 无障碍：减弱动画 */
    @media (prefers-reduced-motion: reduce) {
      .toast-item,
      .toast-item.exiting {
        animation: none;
      }
    }
  `;

  @consume({context: localeContext, subscribe: true})
  @state()
  private _localeCtx: LocaleContextValue = {
      locale: sourceLocale,
      setLocale: async () => {
          console.warn('[RtcToast] Locale context not initialized');
      },
      locales: [sourceLocale, ...targetLocales],
  };

  @property({type: Array})
  toasts: ToastItem[] = [];

  private _handleClose(id: number) {
    this.dispatchEvent(
      new CustomEvent('rtc-toast-close', {
        bubbles: true,
        composed: true,
        detail: {id},
      })
    );
  }

  private _handleKeyDown(event: KeyboardEvent, toast: ToastItem) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (toast.action) {
        toast.action.onClick();
      }
      this._handleClose(toast.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this._handleClose(toast.id);
    }
  }

  render() {
    void this._localeCtx.locale;
    if (this.toasts.length === 0) return nothing;

    return repeat(
      this.toasts,
      toast => toast.id,
      toast => html`
        <div
          class="toast-item"
          part="item"
          role="status"
          aria-live="polite"
          tabindex="0"
          @keydown=${(e: KeyboardEvent) => this._handleKeyDown(e, toast)}
        >
          <span class="toast-icon ${toast.type}" part="icon">
            ${toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}
          </span>
          <span class="toast-message" part="message">${toast.message}</span>
          ${toast.action
            ? html`<button
                class="toast-action"
                part="action"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  toast.action!.onClick();
                  this._handleClose(toast.id);
                }}
                aria-label=${`${toast.action.label} ${toast.message}`}
              >
                ${toast.action.label}
              </button>`
            : nothing}
          <button class="toast-close" part="close" @click=${() => this._handleClose(toast.id)} aria-label=${msg('关闭')}>
            ×
          </button>
        </div>
      `
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-toast': RtcToast;
  }
}
