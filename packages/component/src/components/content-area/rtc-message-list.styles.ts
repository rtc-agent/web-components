import {css} from 'lit';

export const styles = css`
  :host {
    /* Use flex layout instead of height: 100% for robust height resolution.
     * The parent (.content-container) is a flex column container, so flex: 1
     * ensures this element fills available space even when sibling heights
     * change dynamically (e.g., input area expanding from 36px to 200px).
     * min-height: 0 allows the flex item to shrink below content size. */
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .message-list-scroll {
    box-sizing: border-box;
    /* Use flex: 1 instead of height: 100% to fill the flex container.
     * This avoids height resolution issues when parent height changes. */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--rtc-spacing-md) var(--rtc-spacing-lg);
    background: var(--rtc-color-bg-secondary);
    /* scroll-behavior removed: auto-scroll must be instant to avoid race
     * conditions with ResizeObserver. Smooth scroll is applied explicitly
     * in _handleNewBtnClick() for user-initiated scroll only. */
    /* Disable browser scroll anchoring: prevents the browser from adjusting
     * scrollTop when content above changes (e.g., async Markdown rendering).
     * Without this, content growth could trigger spurious scroll events that
     * confuse the user-intent detection in _onScroll. */
    overflow-anchor: none;
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
    z-index: var(--rtc-z-local-2);
  }

  .new-message-btn:hover {
    background: var(--rtc-color-primary-hover);
  }

  .new-message-btn[hidden] {
    display: none;
  }

  .load-more-btn {
    position: absolute;
    top: var(--rtc-spacing-md);
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
    z-index: var(--rtc-z-local-2);
  }

  .load-more-btn:hover:not(:disabled) {
    background: var(--rtc-color-primary-hover);
  }

  .load-more-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .load-more-btn[hidden] {
    display: none;
  }

  /* ── Density: compact ── */
  :host([data-density='compact']) {
    --rtc-message-gap: var(--rtc-spacing-sm);
  }

  :host([data-density='compact']) .message-list-scroll {
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
  }

  /* ── Density: comfortable ── */
  :host([data-density='comfortable']) {
    --rtc-message-gap: var(--rtc-spacing-md);
  }

  :host([data-density='comfortable']) .message-list-scroll {
    padding: var(--rtc-spacing-md) var(--rtc-spacing-lg);
  }
`;
