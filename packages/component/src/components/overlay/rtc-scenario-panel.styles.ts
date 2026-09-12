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
    min-width: 200px;
    max-width: 320px;
    max-height: 300px;
    overflow-y: auto;
    /* top/left set by floating-ui via inline style */
  }

  .scenario-list {
    padding: var(--rtc-spacing-xs) 0;
  }

  .scenario-item {
    display: flex;
    align-items: flex-start;
    gap: var(--rtc-spacing-sm);
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    cursor: pointer;
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .scenario-item:hover {
    background: var(--rtc-color-bg-hover);
  }

  .scenario-item.selected {
    background: rgba(var(--rtc-color-primary-rgb), 0.1);
  }

  .scenario-check {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--rtc-color-primary);
  }

  .scenario-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .scenario-label {
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .scenario-desc {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .scenario-loading,
  .scenario-empty {
    padding: var(--rtc-spacing-md);
    text-align: center;
    color: var(--rtc-color-text-secondary);
    font-size: var(--rtc-font-size-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .scenario-item {
      transition: none;
    }
  }
`;
