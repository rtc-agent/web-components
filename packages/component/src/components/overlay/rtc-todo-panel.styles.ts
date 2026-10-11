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
    max-height: var(--rtc-overlay-panel-max-height, 320px);
    overflow-y: auto;
    width: 280px;
    /* top/left set by floating-ui via inline style */
  }

  .todo-list {
    padding: var(--rtc-spacing-xs) 0;
  }

  .todo-item {
    display: flex;
    align-items: flex-start;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    gap: var(--rtc-spacing-sm);
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .todo-item:hover {
    background: var(--rtc-color-bg-hover);
  }

  .todo-status-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .todo-status-icon svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .todo-status-icon--pending {
    color: var(--rtc-color-text-tertiary);
  }

  .todo-status-icon--in-progress {
    color: var(--rtc-color-accent, var(--rtc-color-text-info, #0969da));
  }

  .todo-status-icon--completed {
    color: var(--rtc-color-text-success, #1a7f37);
  }

  .todo-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .todo-content {
    font-size: var(--rtc-font-size-base);
    color: var(--rtc-color-text);
    line-height: 1.4;
    word-break: break-word;
  }

  .todo-item--completed .todo-content {
    text-decoration: line-through;
    color: var(--rtc-color-text-tertiary);
  }

  .todo-active-form {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-secondary);
    margin-top: 2px;
    font-style: italic;
  }

  .empty-text {
    padding: var(--rtc-spacing-md);
    text-align: center;
    color: var(--rtc-color-text-tertiary);
    font-size: var(--rtc-font-size-sm);
  }

  .empty-filter {
    padding: var(--rtc-spacing-md);
    text-align: center;
    color: var(--rtc-color-text-tertiary);
    font-size: var(--rtc-font-size-sm);
    font-style: italic;
  }

  /* ── Progress bar ── */
  .progress-section {
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    border-bottom: 1px solid var(--rtc-color-border);
  }

  .progress-bar {
    height: 4px;
    background: var(--rtc-color-bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: var(--rtc-spacing-xs);
  }

  .progress-fill {
    height: 100%;
    background: var(--rtc-color-success, #10b981);
    border-radius: 2px;
    transition: width 0.3s ease-out;
  }

  .progress-stats {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .progress-text {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-secondary);
  }

  .progress-percent {
    font-size: var(--rtc-font-size-xs);
    font-weight: var(--rtc-font-weight-medium);
    color: var(--rtc-color-success, #10b981);
  }

  /* ── Filter bar ── */
  .filter-bar {
    display: flex;
    gap: var(--rtc-spacing-xs);
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    border-bottom: 1px solid var(--rtc-color-border);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .filter-bar::-webkit-scrollbar {
    display: none;
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--rtc-spacing-xs);
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
    border: 1px solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius-lg);
    background: transparent;
    color: var(--rtc-color-text-secondary);
    font-size: var(--rtc-font-size-xs);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .filter-chip:hover {
    background: var(--rtc-color-bg-hover);
    border-color: var(--rtc-color-border-hover);
  }

  .filter-chip.active {
    background: var(--rtc-color-primary-bg, rgba(39, 65, 254, 0.1));
    border-color: var(--rtc-color-primary);
    color: var(--rtc-color-primary);
  }

  .filter-count {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 10px;
    background: var(--rtc-color-bg-tertiary);
    color: var(--rtc-color-text-tertiary);
    font-weight: var(--rtc-font-weight-medium);
  }

  .filter-chip.active .filter-count {
    background: var(--rtc-color-primary);
    color: var(--rtc-color-text-inverse);
  }

  @media (prefers-reduced-motion: reduce) {
    .todo-item {
      transition: none;
    }
    .progress-fill {
      transition: none;
    }
    .filter-chip {
      transition: none;
    }
  }
`;
