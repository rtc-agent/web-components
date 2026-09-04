import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    flex-shrink: 0;
    border-bottom: var(--rtc-border-width) solid var(--rtc-color-border);
  }

  .session-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
  }

  .session-title {
    font-size: var(--rtc-font-size-base);
    font-weight: var(--rtc-font-weight-bold);
    color: var(--rtc-color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }

  .header-actions {
    display: flex;
    gap: var(--rtc-spacing-xs);
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--rtc-border-radius);
    color: var(--rtc-color-text-secondary);
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
    padding: 0;
  }

  .icon-btn:hover {
    background: var(--rtc-color-bg-hover);
    color: var(--rtc-color-text);
  }

  .icon-btn svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
`;
