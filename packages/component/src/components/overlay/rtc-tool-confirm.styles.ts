import {css} from 'lit';

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
    margin-bottom: var(--rtc-spacing-sm);
  }

  .dialog-desc {
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text-secondary);
    margin-bottom: var(--rtc-spacing-md);
  }

  .tool-info {
    background: var(--rtc-color-bg-secondary);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    padding: var(--rtc-spacing-sm);
    margin-bottom: var(--rtc-spacing-md);
    font-family: var(--rtc-font-family-mono);
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text);
    word-break: break-all;
    white-space: pre-wrap;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    box-sizing: border-box;
  }

  .tool-params {
    margin-top: var(--rtc-spacing-xs);
  }

  .tool-name {
    font-weight: var(--rtc-font-weight-bold);
    color: var(--rtc-color-primary);
    margin-bottom: var(--rtc-spacing-xs);
  }

  .actions {
    display: flex;
    gap: var(--rtc-spacing-sm);
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .action-btn {
    flex: 1;
    min-width: 80px;
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    background: var(--rtc-color-bg);
    color: var(--rtc-color-text);
    cursor: pointer;
    font-size: var(--rtc-font-size-sm);
    font-weight: var(--rtc-font-weight-medium);
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .action-btn:hover {
    background: var(--rtc-color-bg-hover);
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
  }

  .action-btn.danger:hover {
    background: var(--rtc-color-error);
    color: var(--rtc-color-text-inverse);
  }
`;
