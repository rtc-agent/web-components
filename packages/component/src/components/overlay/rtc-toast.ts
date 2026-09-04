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
import {customElement, property} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

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
      background: var(--rtc-color-info, #2196f3);
    }

    .toast-message {
      flex: 1;
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

  @property({type: Array})
  toasts: ToastItem[] = [];

  render() {
    if (this.toasts.length === 0) return nothing;

    return repeat(
      this.toasts,
      toast => toast.id,
      toast => html`
        <div class="toast-item" part="item" role="status" aria-live="polite">
          <span class="toast-icon ${toast.type}" part="icon">
            ${toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}
          </span>
          <span class="toast-message" part="message">${toast.message}</span>
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
