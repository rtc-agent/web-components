import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    flex-shrink: 0;
  }

  .notice-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    background: var(--rtc-color-bg-secondary);
    border-top: var(--rtc-border-width) solid var(--rtc-color-border);
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text-secondary);
  }

  .message {
    flex: 1;
  }

  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--rtc-color-text-tertiary);
    font-size: var(--rtc-font-size-md);
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
    border-radius: var(--rtc-border-radius-sm);
    transition: color var(--rtc-transition-duration) var(--rtc-transition-timing);
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--rtc-color-text);
  }
`;
