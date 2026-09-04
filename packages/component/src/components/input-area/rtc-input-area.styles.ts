import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    flex-shrink: 0;
    margin: var(--rtc-spacing-sm) var(--rtc-spacing-md) var(--rtc-spacing-md);
    border-radius: var(--rtc-border-radius);
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    background: var(--rtc-color-bg);
    box-shadow: var(--rtc-shadow-md, 0 2px 8px rgba(0, 0, 0, 0.12));
  }

  .input-inner {
    display: flex;
    flex-direction: column;
  }

  .textarea-container {
    position: relative;
  }

  .input-textarea {
    display: block;
    width: 100%;
    min-height: 36px;
    max-height: 200px;
    border: none;
    border-radius: var(--rtc-border-radius);
    background: var(--rtc-color-bg);
    color: var(--rtc-color-text);
    font-family: var(--rtc-font-family-base);
    font-size: var(--rtc-font-size-base);
    line-height: var(--rtc-line-height-base);
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    padding-right: calc(var(--rtc-spacing-md) + 32px);
    resize: none;
    outline: none;
    box-sizing: border-box;
    overflow-y: auto;
  }

  .input-textarea::placeholder {
    color: var(--rtc-color-text-tertiary);
  }

  .voice-btn {
    position: absolute;
    top: var(--rtc-spacing-sm);
    right: var(--rtc-spacing-sm);
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--rtc-border-radius-sm);
    color: var(--rtc-color-text-secondary);
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
    padding: 0;
  }

  .voice-btn:hover {
    background: var(--rtc-color-bg-hover);
    color: var(--rtc-color-text);
  }

  .voice-btn svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  .input-toolbar {
    display: flex;
    align-items: center;
    gap: var(--rtc-spacing-xs);
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-md) var(--rtc-spacing-sm);
    flex-shrink: 0;
  }

  .toolbar-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--rtc-border-radius-sm);
    color: var(--rtc-color-text-secondary);
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
    padding: 0;
  }

  .toolbar-btn:hover {
    background: var(--rtc-color-bg-hover);
    color: var(--rtc-color-text);
  }

  .toolbar-btn svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  .toolbar-spacer {
    flex: 1;
  }

  .mode-btn {
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    background: var(--rtc-color-bg-secondary);
    color: var(--rtc-color-text-secondary);
    cursor: pointer;
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
    border-radius: var(--rtc-border-radius);
    font-size: var(--rtc-font-size-xs);
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .mode-btn:hover {
    border-color: var(--rtc-color-border-hover);
    color: var(--rtc-color-text);
  }

  .send-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--rtc-border-radius);
    background: var(--rtc-color-primary);
    color: #ffffff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
    padding: 0;
    flex-shrink: 0;
  }

  .send-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .send-btn svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  .send-btn--stop {
    background: var(--rtc-color-error);
  }

  .send-btn--stop:hover:not(:disabled) {
    opacity: 0.9;
  }
`;
