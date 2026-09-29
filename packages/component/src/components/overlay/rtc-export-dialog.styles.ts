import {css} from 'lit';

/**
 * Styles for <rtc-export-dialog>
 *
 * Design notes:
 * - Reuse dialog shell pattern from rtc-restore-confirm and rtc-ask-user
 * - Range slider with dual-theme support via CSS custom properties
 * - Radio options follow rtc-ask-user pattern (custom div-based, not native input)
 * - All colors via CSS custom properties (automatic light/dark theme support)
 */
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
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
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
    max-width: var(--rtc-dialog-max-width, 400px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }

  .dialog-title {
    font-size: var(--rtc-font-size-md);
    font-weight: var(--rtc-font-weight-bold);
    color: var(--rtc-color-text);
    margin-bottom: var(--rtc-spacing-md);
  }

  /* ---- Form fields ---- */
  .form-group {
    margin-bottom: var(--rtc-spacing-md);
  }

  .form-label {
    display: block;
    font-size: var(--rtc-font-size-sm);
    font-weight: var(--rtc-font-weight-medium);
    color: var(--rtc-color-text);
    margin-bottom: var(--rtc-spacing-xs);
  }

  .form-hint {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-secondary);
    margin-top: 2px;
  }

  /* ---- Range slider ---- */
  .range-wrapper {
    display: flex;
    align-items: center;
    gap: var(--rtc-spacing-sm);
  }

  .range-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    border-radius: 3px;
    background: var(--rtc-color-bg-tertiary);
    outline: none;
    cursor: pointer;
  }

  .range-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--rtc-color-primary);
    border: 2px solid var(--rtc-color-bg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .range-slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  }

  .range-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--rtc-color-primary);
    border: 2px solid var(--rtc-color-bg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    cursor: pointer;
  }

  .range-slider::-moz-range-track {
    height: 6px;
    border-radius: 3px;
    background: var(--rtc-color-bg-tertiary);
  }

  .range-value {
    min-width: 40px;
    text-align: right;
    font-size: var(--rtc-font-size-sm);
    font-weight: var(--rtc-font-weight-medium);
    color: var(--rtc-color-text);
    font-variant-numeric: tabular-nums;
  }

  /* ---- Radio options ---- */
  .radio-group {
    display: flex;
    gap: var(--rtc-spacing-sm);
  }

  .radio-option {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    cursor: pointer;
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing),
                border-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    background: var(--rtc-color-bg);
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text);
  }

  .radio-option:hover {
    background: var(--rtc-color-bg-hover);
  }

  .radio-option.selected {
    border-color: var(--rtc-color-primary);
    background: var(--rtc-color-primary-soft, rgba(39, 65, 254, 0.08));
    color: var(--rtc-color-primary);
    font-weight: var(--rtc-font-weight-medium);
  }

  .radio-indicator {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--rtc-color-text-tertiary);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  .radio-option.selected .radio-indicator {
    border-color: var(--rtc-color-primary);
    background: var(--rtc-color-primary);
  }

  .radio-option.selected .radio-indicator::after {
    content: "";
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--rtc-color-text-inverse);
  }

  /* ---- Actions ---- */
  .actions {
    display: flex;
    gap: var(--rtc-spacing-sm);
    margin-top: var(--rtc-spacing-md);
  }

  .action-btn {
    flex: 1;
    padding: 8px 14px;
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    background: var(--rtc-color-bg);
    color: var(--rtc-color-text);
    cursor: pointer;
    font-size: var(--rtc-font-size-sm);
    font-weight: var(--rtc-font-weight-medium);
    font-family: inherit;
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
`;
