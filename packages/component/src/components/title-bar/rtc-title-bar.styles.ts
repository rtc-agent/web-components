import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    position: relative;
    z-index: var(--rtc-z-title-bar);
    flex-shrink: 0;
  }

  .title-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    background: var(--rtc-color-bg-secondary);
    border-bottom: var(--rtc-border-width) solid var(--rtc-color-border);
    cursor: grab;
    user-select: none;
  }

  .title-bar:active {
    cursor: grabbing;
  }

  .title-bar:focus-visible {
    outline: 2px solid var(--rtc-color-border-focus, #007acc);
    outline-offset: -2px;
  }

  .app-label {
    display: inline-flex;
    align-items: center;
    gap: var(--rtc-spacing-xs, 4px);
    font-size: var(--rtc-font-size-sm);
    font-weight: var(--rtc-font-weight-medium);
    color: var(--rtc-color-text);
    background: var(--rtc-color-bg-tertiary);
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
    border-radius: var(--rtc-border-radius-sm);
  }

  /* ── 连接状态圆点 ── */
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.connected {
    background: var(--rtc-color-success);
  }

  .status-dot.connecting,
  .status-dot.reconnecting {
    background: var(--rtc-color-warning);
    animation: status-pulse 1.5s ease-in-out infinite;
  }

  .status-dot.disconnected {
    background: var(--rtc-color-error);
  }

  @keyframes status-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* 无障碍：减弱动画 */
  @media (prefers-reduced-motion: reduce) {
    .status-dot.connecting,
    .status-dot.reconnecting {
      animation: none;
    }
  }

  .window-controls {
    display: flex;
    gap: var(--rtc-spacing-sm);
  }

  .window-btn {
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--rtc-border-radius-sm);
    color: var(--rtc-color-text-secondary);
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
    padding: 0;
  }

  .window-btn:hover {
    background: var(--rtc-color-bg-active);
    color: var(--rtc-color-text);
  }

  .window-btn svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }
`;
