import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    height: 100%;
    overflow: hidden;
  }

  .message-list-scroll {
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
    padding: var(--rtc-spacing-md) var(--rtc-spacing-lg);
    background: var(--rtc-color-bg-secondary);
    /* scroll-behavior removed: auto-scroll must be instant to avoid race
     * conditions with ResizeObserver. Smooth scroll is applied explicitly
     * in _handleNewBtnClick() for user-initiated scroll only. */
  }

  .message-list-inner {
    display: flex;
    flex-direction: column;
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
    z-index: 2;
  }

  .new-message-btn:hover {
    background: var(--rtc-color-primary-hover);
  }

  .new-message-btn[hidden] {
    display: none;
  }
`;
