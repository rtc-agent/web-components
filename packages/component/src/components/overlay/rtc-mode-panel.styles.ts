import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    position: fixed;
    z-index: var(--rtc-z-overlay);
    background: var(--rtc-color-bg);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius-lg);
    box-shadow: var(--rtc-shadow-lg);
    width: 260px;
    /* top/left set by floating-ui via inline style */
  }

  .mode-list {
    padding: var(--rtc-spacing-xs) 0;
  }

  .mode-item {
    display: flex;
    align-items: center;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    cursor: pointer;
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text);
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
    gap: var(--rtc-spacing-sm);
  }

  .mode-item:hover {
    background: var(--rtc-color-bg-hover);
  }

  .mode-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--rtc-color-text-secondary);
  }

  .mode-icon svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  .mode-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .mode-label {
    font-size: var(--rtc-font-size-sm);
    line-height: 1.4;
  }

  .mode-desc {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-tertiary);
    line-height: 1.3;
    margin-top: 1px;
    white-space: normal;
    word-wrap: break-word;
  }

  .mode-item.active .mode-label {
    color: var(--rtc-color-primary);
    font-weight: var(--rtc-font-weight-medium);
  }

  .mode-item.active .mode-icon {
    color: var(--rtc-color-primary);
  }

  .mode-check {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--rtc-color-primary);
    visibility: hidden;
  }

  .mode-check svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .mode-item.active .mode-check {
    visibility: visible;
  }

  @media (prefers-reduced-motion: reduce) {
    .mode-item {
      transition: none;
    }
  }
`;
