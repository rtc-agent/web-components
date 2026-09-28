import {css} from 'lit';

export const styles = css`
  /* ── Host element ── */
  :host {
    display: block;
    flex: 1;
    overflow: hidden;
  }

  /* ── Container layout ── */
  .login-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--rtc-spacing-xl, 32px) var(--rtc-spacing-lg, 24px);
    text-align: center;
  }

  /* ── Logo & app name ── */
  .logo {
    margin-bottom: var(--rtc-spacing-lg, 24px);
  }

  .logo rtc-logo {
    width: 72px;
    height: 72px;
  }

  .app-name {
    font-size: var(--rtc-font-size-lg, 18px);
    font-weight: var(--rtc-font-weight-bold, 600);
    color: var(--rtc-color-text, #1a1a1a);
    margin-bottom: var(--rtc-spacing-sm, 8px);
  }

  .app-desc {
    font-size: var(--rtc-font-size-sm, 14px);
    color: var(--rtc-color-text-secondary, #666);
    margin-bottom: var(--rtc-spacing-xl, 32px);
  }

  /* ── Provider button container ── */
  .providers {
    display: flex;
    flex-direction: column;
    gap: var(--rtc-spacing-sm, 8px);
    width: 100%;
    max-width: 280px;
  }

  /* ── Provider button ── */
  .provider-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--rtc-spacing-sm, 8px);
    padding: var(--rtc-spacing-sm, 8px) var(--rtc-spacing-lg, 24px);
    background: var(--rtc-color-bg-secondary, #f5f5f5);
    color: var(--rtc-color-text, #1a1a1a);
    border: 1px solid var(--rtc-color-border, #e0e0e0);
    border-radius: var(--rtc-border-radius, 6px);
    font-size: var(--rtc-font-size-base, 16px);
    font-weight: var(--rtc-font-weight-medium, 500);
    cursor: pointer;
    transition: all var(--rtc-transition-duration, 0.2s) var(--rtc-transition-timing, ease);
  }

  .provider-btn:hover {
    background: var(--rtc-color-bg-tertiary, #ebebeb);
    border-color: var(--rtc-color-primary, #0066cc);
  }

  .provider-btn-primary {
    background: var(--provider-color, var(--rtc-color-primary, #0066cc));
    color: var(--rtc-color-text-inverse, #fff);
    border-color: transparent;
  }

  .provider-btn-primary:hover {
    opacity: 0.9;
    border-color: transparent;
  }

  .provider-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
  }

  .provider-icon svg {
    width: 100%;
    height: 100%;
  }

  /* ── Loading & error state ── */
  .loading-text {
    font-size: var(--rtc-font-size-sm, 14px);
    color: var(--rtc-color-text-secondary, #666);
    margin-bottom: var(--rtc-spacing-md, 16px);
  }

  .error-text {
    font-size: var(--rtc-font-size-sm, 14px);
    color: var(--rtc-color-error, #dc3545);
    margin-bottom: var(--rtc-spacing-md, 16px);
  }
`;
