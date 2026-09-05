/**
 * RTC Login Dialog Styles
 *
 * Uses project-standard CSS Variables naming.
 */
import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    position: absolute;
    inset: 0;
    z-index: var(--rtc-z-modal, 501);
    pointer-events: none;
  }

  .overlay {
    position: absolute;
    inset: 0;
    background: var(--rtc-color-overlay, rgba(0, 0, 0, 0.5));
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }

  .dialog {
    background: var(--rtc-color-bg, #fff);
    border-radius: var(--rtc-radius-lg, 12px);
    padding: 0;
    width: 400px;
    max-width: 90%;
    height: 520px;
    max-height: 90%;
    box-shadow: var(--rtc-shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.3));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--rtc-color-border, #e5e7eb);
  }

  .title {
    font-size: var(--rtc-font-size-lg, 18px);
    font-weight: 600;
    color: var(--rtc-color-text, #111);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    color: var(--rtc-color-text-secondary, #666);
    padding: 0 4px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--rtc-color-bg-secondary, #f3f4f6);
  }

  .status {
    font-size: var(--rtc-font-size-sm, 14px);
    color: var(--rtc-color-text-secondary, #666);
    padding: 12px 20px;
    min-height: 20px;
  }

  .iframe-container {
    flex: 1;
    overflow: hidden;
    border-top: 1px solid var(--rtc-color-border, #e5e7eb);
  }

  .auth-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #ffffff;
  }

  .button {
    width: calc(100% - 40px);
    margin: 0 20px 20px;
    padding: var(--rtc-spacing-md, 12px) var(--rtc-spacing-lg, 24px);
    border: none;
    border-radius: var(--rtc-radius-md, 8px);
    font-size: var(--rtc-font-size-md, 16px);
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  .button-primary {
    background: var(--rtc-color-primary, #6366f1);
    color: var(--rtc-color-on-primary, #fff);
  }

  .button-primary:hover:not(:disabled) {
    background: var(--rtc-color-primary-hover, #4f46e5);
  }

  .button-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error {
    color: var(--rtc-color-error, #ef4444);
    font-size: var(--rtc-font-size-sm, 14px);
    padding: 0 20px 16px;
  }

  .spinner {
    display: inline-block;
    width: 24px;
    height: 24px;
    border: 3px solid var(--rtc-color-spinner-track, rgba(99, 102, 241, 0.2));
    border-top-color: var(--rtc-color-spinner, #6366f1);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .button-row {
    display: flex;
    justify-content: center;
    align-items: center;
    flex: 1;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Accessibility: reduce motion */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }

    .button {
      transition: none;
    }
  }
`;
