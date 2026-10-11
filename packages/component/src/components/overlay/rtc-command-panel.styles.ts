import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    position: absolute;
    z-index: var(--rtc-z-overlay);
    background: var(--rtc-color-bg);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius-lg);
    box-shadow: var(--rtc-shadow-lg);
    width: 280px;
    /* top/left set by floating-ui via inline style */
  }

  .command-list {
    padding: var(--rtc-spacing-xs) 0;
  }

  .command-item {
    display: flex;
    align-items: center;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    cursor: pointer;
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text);
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
    gap: var(--rtc-spacing-sm);
  }

  .command-item:hover:not(.disabled) {
    background: var(--rtc-color-bg-hover);
  }

  .command-item.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .command-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--rtc-color-text-secondary);
  }

  .command-icon svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  .command-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .command-label {
    font-size: var(--rtc-font-size-sm);
    line-height: 1.4;
    font-family: var(--rtc-font-family-mono, monospace);
  }

  .command-desc {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-tertiary);
    line-height: 1.3;
    margin-top: 1px;
    white-space: normal;
    word-wrap: break-word;
  }

  .command-badge {
    flex-shrink: 0;
    font-size: var(--rtc-font-size-xs);
    padding: 2px 6px;
    border-radius: var(--rtc-border-radius-sm);
    background: var(--rtc-color-bg-secondary);
    color: var(--rtc-color-text-secondary);
  }

  .command-item.disabled .command-badge {
    background: var(--rtc-color-bg-tertiary);
    color: var(--rtc-color-text-tertiary);
  }

  /* ── Search container ── */
  .search-container {
    display: flex;
    align-items: center;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    border-bottom: 1px solid var(--rtc-color-border);
    gap: var(--rtc-spacing-xs);
  }

  .search-icon {
    flex-shrink: 0;
    display: inline-flex;
    color: var(--rtc-color-text-tertiary);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text);
    padding: var(--rtc-spacing-xs) 0;
  }

  .search-input::placeholder {
    color: var(--rtc-color-text-tertiary);
  }

  .clear-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: var(--rtc-border-radius-sm);
    background: transparent;
    color: var(--rtc-color-text-tertiary);
    cursor: pointer;
    transition: background var(--rtc-transition-duration), color var(--rtc-transition-duration);
  }

  .clear-btn:hover {
    background: var(--rtc-color-bg-hover);
    color: var(--rtc-color-text);
  }

  /* ── Command panel wrapper ── */
  .command-panel {
    display: flex;
    flex-direction: column;
  }

  /* ── Selected state ── */
  .command-item.selected {
    background: var(--rtc-color-bg-hover);
  }

  .command-item.selected:not(.disabled) {
    background: var(--rtc-color-primary-bg, rgba(39, 65, 254, 0.1));
  }

  /* ── No results message ── */
  .no-results {
    padding: var(--rtc-spacing-md) var(--rtc-spacing-lg);
    text-align: center;
    color: var(--rtc-color-text-tertiary);
    font-size: var(--rtc-font-size-sm);
  }

  /* ── Feedback bar ── */
  .feedback-bar {
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-md);
    background: var(--rtc-color-success-bg, #10b98120);
    color: var(--rtc-color-success, #10b981);
    font-size: var(--rtc-font-size-xs);
    text-align: center;
    border-top: 1px solid var(--rtc-color-border);
    animation: rtc-feedback-slide-in 0.2s ease-out;
  }

  @keyframes rtc-feedback-slide-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .command-item {
      transition: none;
    }
    .feedback-bar {
      animation: none;
    }
  }
`;
