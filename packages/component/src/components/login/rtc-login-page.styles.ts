import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    flex: 1;
    overflow: hidden;
  }

  .login-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--rtc-spacing-xl) var(--rtc-spacing-lg);
    text-align: center;
  }

  .logo {
    margin-bottom: var(--rtc-spacing-lg);
  }

  .logo svg {
    width: 72px;
    height: 72px;
    fill: var(--rtc-color-primary);
    opacity: 0.7;
  }

  .app-name {
    font-size: var(--rtc-font-size-lg);
    font-weight: var(--rtc-font-weight-bold);
    color: var(--rtc-color-text);
    margin-bottom: var(--rtc-spacing-sm);
  }

  .app-desc {
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text-secondary);
    margin-bottom: var(--rtc-spacing-xl);
  }

  .login-btn {
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-xl);
    background: var(--rtc-color-primary);
    color: var(--rtc-color-text-inverse);
    border: none;
    border-radius: var(--rtc-border-radius);
    font-size: var(--rtc-font-size-base);
    font-weight: var(--rtc-font-weight-medium);
    cursor: pointer;
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .login-btn:hover {
    background: var(--rtc-color-primary-hover);
  }

  .login-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .loading-text {
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text-secondary);
    margin-bottom: var(--rtc-spacing-md);
  }

  .error-text {
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-error);
    margin-bottom: var(--rtc-spacing-md);
  }
`;
