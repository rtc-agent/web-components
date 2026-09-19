import {css} from 'lit';

export const styles = css`
  :host {
    /* In rtc-chat-layout: sized by position: absolute; inset: 0 (light DOM CSS).
     * In rtc-content-area: flex: 1 fills the flex column container.
     * display: flex is needed so .list-wrapper can use flex: 1 to stretch. */
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  /* Wrapper div between :host and lit-virtualizer.
   * Bridges the flex layout from :host down to the virtualizer. */
  .list-wrapper {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .message-list-scroll {
    box-sizing: border-box;
    /* Use flex: 1 instead of height: 100% to fill the flex container.
     * This avoids height resolution issues when parent height changes. */
    flex: 1;
    min-height: 0;
    width: 100%;
    /* 禁止水平滚动，防止内容宽度超出 */
    overflow-x: hidden;
    /* 不设 padding，避免内容宽度超出容器导致水平滚动 */
    background: var(--rtc-color-bg-secondary);
    /* Disable browser scroll anchoring: prevents the browser from adjusting
     * scrollTop when content above changes (e.g., async Markdown rendering).
     *
     * Note: "overflow-anchor: none" is not supported in Safari.
     * Safari may apply its own scroll anchoring (Scroll Anchoring / Scroll
     * Position Restoration), which could conflict with the virtualizer's scroll
     * management. If visual glitches occur in Safari when async content
     * (Markdown) renders above the viewport, consider implementing a JS-based
     * scroll anchor prevention or saving/restoring scrollTop around renders. */
    overflow-anchor: none;
    /* 禁用 Safari 橡皮筋回弹效果，防止虚拟滚动中 prepend 操作触发 bounce */
    overscroll-behavior: none;
  }

  /* lit-virtualizer 内部容器（shadow DOM 外的直接子 div） */
  .message-list-scroll > div {
    width: 100%;
    box-sizing: border-box;
  }

  /* 消息包装器：每条消息由 div.message-item 包裹。
   * 负责宽度、padding 和 box-sizing。 */
  .message-item {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0 var(--rtc-spacing-lg);
  }

  /* 确保所有消息组件都是块级元素并填充父容器宽度 */
  .message-item > rtc-message,
  .message-item > rtc-user-message,
  .message-item > rtc-toolcall-card,
  .message-item > rtc-error-message {
    display: block;
    width: 100%;
    box-sizing: border-box;
  }

  .new-message-btn {
    position: absolute;
    bottom: var(--rtc-spacing-md);
    left: 50%;
    transform: translateX(-50%);
    background: var(--rtc-color-primary);
    color: var(--rtc-color-text-inverse);
    border: none;
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-md);
    border-radius: var(--rtc-border-radius-lg);
    font-size: var(--rtc-font-size-sm);
    cursor: pointer;
    box-shadow: var(--rtc-shadow-md);
    transition: opacity var(--rtc-transition-duration) var(--rtc-transition-timing);
    z-index: var(--rtc-z-local-2);
  }

  .new-message-btn:hover {
    background: var(--rtc-color-primary-hover);
  }

  .new-message-btn[hidden] {
    display: none;
  }

  .load-more-btn {
    position: absolute;
    top: var(--rtc-spacing-md);
    left: 50%;
    transform: translateX(-50%);
    background: var(--rtc-color-primary);
    color: var(--rtc-color-text-inverse);
    border: none;
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-md);
    border-radius: var(--rtc-border-radius-lg);
    font-size: var(--rtc-font-size-sm);
    cursor: pointer;
    box-shadow: var(--rtc-shadow-md);
    transition: opacity var(--rtc-transition-duration) var(--rtc-transition-timing);
    z-index: var(--rtc-z-local-2);
  }

  .load-more-btn:hover:not(:disabled) {
    background: var(--rtc-color-primary-hover);
  }

  .load-more-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .load-more-btn[hidden] {
    display: none;
  }

  /* ── Density ── */
  :host([data-density='compact']) {
    --rtc-message-gap: var(--rtc-spacing-sm);
  }

  :host([data-density='comfortable']) {
    --rtc-message-gap: var(--rtc-spacing-md);
  }
`;
