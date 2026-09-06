import {css} from 'lit';

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

  @media (prefers-reduced-motion: reduce) {
    .todo-item {
      transition: none;
    }
  }
`;
