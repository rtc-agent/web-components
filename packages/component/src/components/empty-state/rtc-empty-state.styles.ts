import {css} from 'lit';

export const styles = css`
  :host {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: var(--rtc-spacing-xl) var(--rtc-spacing-lg);
  }

  .logo-container {
    margin-bottom: var(--rtc-spacing-lg);
  }

  .logo-container svg {
    width: 64px;
    height: 64px;
    fill: var(--rtc-color-primary);
    opacity: 0.6;
  }

  .empty-hint {
    font-size: var(--rtc-font-size-md);
    color: var(--rtc-color-text-secondary);
    text-align: center;
    line-height: var(--rtc-line-height-loose);
  }
`;
