import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    position: absolute;
    inset: 0;
    z-index: var(--rtc-z-modal);
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: var(--rtc-color-backdrop);
  }

  .dialog {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--rtc-color-bg);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius-lg);
    box-shadow: var(--rtc-shadow-xl);
    padding: var(--rtc-spacing-lg);
    width: calc(100% - 48px);
    max-width: var(--rtc-dialog-max-width, 360px);
    max-height: min(600px, calc(100% - 48px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }

  .dialog-title {
    font-size: var(--rtc-font-size-md);
    font-weight: var(--rtc-font-weight-bold);
    color: var(--rtc-color-text);
  }

  .dialog-desc {
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text-secondary);
    margin-top: var(--rtc-spacing-xs);
  }

  /* ── Dialog header ── */
  .dialog-header {
    display: flex;
    align-items: flex-start;
    gap: var(--rtc-spacing-sm);
    margin-bottom: var(--rtc-spacing-md);
  }

  .dialog-icon {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    color: var(--rtc-color-warning);
  }

  /* ── Tool info ── */
  .tool-info {
    background: var(--rtc-color-bg-secondary);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    padding: var(--rtc-spacing-md);
    margin-bottom: var(--rtc-spacing-md);
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--rtc-spacing-sm);
    box-sizing: border-box;
  }

  .tool-info-header {
    display: flex;
    align-items: baseline;
    gap: var(--rtc-spacing-sm);
    flex-wrap: wrap;
  }

  .tool-name {
    font-family: var(--rtc-font-family-mono);
    font-weight: var(--rtc-font-weight-bold);
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-primary);
  }

  .tool-description {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-tertiary);
  }

  .tool-params-wrapper {
    display: flex;
    flex-direction: column;
    gap: var(--rtc-spacing-xs);
    flex: 1;
    min-height: 0;
  }

  .params-label {
    font-size: var(--rtc-font-size-xs);
    font-weight: var(--rtc-font-weight-medium);
    color: var(--rtc-color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .tool-params {
    font-family: var(--rtc-font-family-mono);
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text);
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
    padding: var(--rtc-spacing-sm);
    background: var(--rtc-color-bg);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius-sm);
    flex: 1;
    min-height: 60px;
    max-height: 200px;
    overflow-y: auto;
    box-sizing: border-box;
  }

  .tool-params:focus {
    outline: 2px solid var(--rtc-color-border-focus);
    outline-offset: -2px;
  }

  /* ── Actions ── */
  .actions {
    display: flex;
    gap: var(--rtc-spacing-sm);
    flex-wrap: wrap;
    flex-shrink: 0;
    justify-content: flex-end;
  }

  .action-group {
    display: flex;
    gap: var(--rtc-spacing-xs);
  }

  .action-btn {
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    background: var(--rtc-color-bg);
    color: var(--rtc-color-text);
    cursor: pointer;
    font-size: var(--rtc-font-size-sm);
    font-weight: var(--rtc-font-weight-medium);
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
    display: inline-flex;
    align-items: center;
    gap: var(--rtc-spacing-xs);
  }

  .action-btn:hover {
    background: var(--rtc-color-bg-hover);
  }

  .action-btn:focus-visible {
    outline: 2px solid var(--rtc-color-border-focus);
    outline-offset: 2px;
  }

  .action-btn.primary {
    background: var(--rtc-color-primary);
    border-color: var(--rtc-color-primary);
    color: var(--rtc-color-text-inverse);
  }

  .action-btn.primary:hover {
    background: var(--rtc-color-primary-hover);
  }

  .action-btn.danger {
    color: var(--rtc-color-error);
    margin-right: auto;
  }

  .action-btn.danger:hover {
    background: var(--rtc-color-error);
    color: var(--rtc-color-text-inverse);
  }

  .shortcut-hint {
    font-size: var(--rtc-font-size-xs);
    opacity: 0.7;
    font-weight: normal;
  }
`;
