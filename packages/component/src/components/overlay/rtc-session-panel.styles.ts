import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    background: var(--rtc-color-bg);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius-lg);
    box-shadow: var(--rtc-shadow-lg);
    max-height: var(--rtc-overlay-panel-max-height, 320px);
    overflow-y: auto;
    width: 100%;
  }

  /* 浮动模式（默认）：绝对定位 + 固定宽度 */
  :host(:not([sidebar])) {
    position: absolute;
    z-index: var(--rtc-z-overlay);
    width: 280px;
    /* top/left set by floating-ui via inline style */
  }

  .session-list {
    padding: var(--rtc-spacing-xs) 0;
  }

  .session-item {
    display: flex;
    align-items: center;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    cursor: pointer;
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
    gap: var(--rtc-spacing-sm);
  }

  .session-item:hover {
    background: var(--rtc-color-bg-hover);
  }

  .session-item.active {
    background: var(--rtc-color-bg-hover);
  }

  .session-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .session-title {
    font-size: var(--rtc-font-size-base);
    font-weight: var(--rtc-font-weight-medium);
    color: var(--rtc-color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-time {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-tertiary);
    margin-top: 2px;
  }

  .session-actions {
    display: flex;
    gap: var(--rtc-spacing-xs);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .session-item:hover .session-actions {
    opacity: 1;
  }

  /* Rename mode: always show action buttons (confirm/cancel) */
  .rename-actions {
    opacity: 1;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    font-size: var(--rtc-font-size-base);
    font-weight: var(--rtc-font-weight-medium);
    color: var(--rtc-color-text);
    background: var(--rtc-color-bg-secondary);
    border: 1px solid var(--rtc-color-border-focus, var(--rtc-color-primary));
    border-radius: var(--rtc-border-radius-sm);
    padding: 2px var(--rtc-spacing-xs);
    outline: none;
    font-family: inherit;
    line-height: 1.4;
  }

  .rename-input:focus {
    box-shadow: 0 0 0 1px var(--rtc-color-primary);
  }

  .session-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--rtc-border-radius-sm);
    background: transparent;
    color: var(--rtc-color-text-tertiary);
    cursor: pointer;
    padding: 0;
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .session-action-btn:hover {
    background: var(--rtc-color-bg);
    color: var(--rtc-color-text);
  }

  .confirm-btn:hover {
    color: var(--rtc-color-success, #2da44e);
  }

  .cancel-btn:hover {
    color: var(--rtc-color-danger, #cf222e);
  }

  .session-action-btn svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .empty-text {
    padding: var(--rtc-spacing-md);
    text-align: center;
    color: var(--rtc-color-text-tertiary);
    font-size: var(--rtc-font-size-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .session-item,
    .session-actions,
    .session-action-btn {
      transition: none;
    }
  }
`;
