import {css} from 'lit';

/**
 * Styles for <rtc-ask-user>
 *
 * Design notes (see ask-user-mockup.html for full spec):
 * - Reuse rtc-tool-confirm shell (backdrop + centered card, max-width 360px)
 * - Single question: height auto (max 600px), no tab bar
 * - Multi-question: fixed height 520px, tab bar with chips, Prev/Next nav
 * - All colors via CSS custom properties (dark mode via prefers-color-scheme)
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
    max-width: var(--rtc-dialog-max-width, 360px);
    max-height: min(600px, calc(100% - 48px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }

  /* Multi-question: fixed height so tab switching doesn't jitter. */
  .dialog.multi {
    height: 520px;
  }

  /* Single-question: content flexes & scrolls directly. */
  .dialog:not(.multi) .question {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 2px;
    scrollbar-width: thin;
  }

  /* ---- Header ---- */
  .dialog-header {
    display: flex;
    align-items: center;
    gap: var(--rtc-spacing-sm);
    margin-bottom: 4px;
    flex-shrink: 0;
  }
  .icon {
    width: 18px;
    height: 18px;
    color: var(--rtc-color-primary);
    flex-shrink: 0;
  }
  .dialog-title {
    font-size: var(--rtc-font-size-md);
    font-weight: var(--rtc-font-weight-bold);
    color: var(--rtc-color-text);
  }
  .dialog-desc {
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text-secondary);
    margin: 2px 0 var(--rtc-spacing-md) 26px;
    flex-shrink: 0;
  }

  /* ---- Tab bar (multi-question only) ---- */
  .tab-bar {
    display: flex;
    gap: 6px;
    padding: 0 0 10px 0;
    overflow-x: auto;
    scrollbar-width: none;
    flex-shrink: 0;
  }
  .tab-bar::-webkit-scrollbar { display: none; }
  .tab-chip {
    flex-shrink: 0;
    height: 24px;
    padding: 0 10px;
    border-radius: 12px;
    background: var(--rtc-color-bg-secondary);
    color: var(--rtc-color-text-secondary);
    font-size: var(--rtc-font-size-xs);
    font-weight: var(--rtc-font-weight-medium);
    border: var(--rtc-border-width) solid transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: inherit;
  }
  .tab-chip:hover {
    color: var(--rtc-color-text);
    background: var(--rtc-color-bg-hover);
  }
  .tab-chip[aria-selected="true"] {
    background: var(--rtc-color-primary-soft);
    color: var(--rtc-color-primary);
    border-color: var(--rtc-color-primary);
  }

  /* ---- Tab content ---- */
  .tab-content {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .tab-pane {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding-right: 2px;
    scrollbar-width: thin;
  }
  .tab-pane[hidden] {
    display: none;
  }

  /* ---- Question ---- */
  .question {
    display: flex;
    flex-direction: column;
    gap: var(--rtc-spacing-sm);
  }
  .question-head {
    display: flex;
    flex-direction: column;
    gap: var(--rtc-spacing-xs);
  }
  .chip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 10px;
    background: var(--rtc-color-primary-soft);
    color: var(--rtc-color-primary);
    font-size: var(--rtc-font-size-xs);
    font-weight: var(--rtc-font-weight-medium);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .question-text {
    font-size: var(--rtc-font-size-sm);
    color: var(--rtc-color-text);
    line-height: 1.45;
    margin: 0;
    padding-top: 1px;
  }

  /* ---- Options ---- */
  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
  }
  .option {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--rtc-spacing-sm);
    padding: 8px 10px;
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    cursor: pointer;
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing),
                border-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    background: var(--rtc-color-bg);
  }
  .option:hover { background: var(--rtc-color-bg-hover); }
  .option.selected {
    border-color: var(--rtc-color-primary);
    background: var(--rtc-color-primary-soft);
  }
  .option input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .indicator {
    flex-shrink: 0;
    width: 15px;
    height: 15px;
    margin-top: 1px;
    border: 1.5px solid var(--rtc-color-text-tertiary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
  }
  .option.radio .indicator { border-radius: 50%; }
  .option.checkbox .indicator { border-radius: 4px; }
  .option.selected .indicator {
    border-color: var(--rtc-color-primary);
    background: var(--rtc-color-primary);
  }
  .option.selected.radio .indicator::after {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--rtc-color-text-inverse);
  }
  .option.selected.checkbox .indicator::after {
    content: "";
    width: 9px;
    height: 9px;
    /* inline SVG checkmark — avoids external asset */
    background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' d='M3 8.5 L6.5 12 L13 4'/></svg>") no-repeat center / contain;
  }
  .option-body { flex: 1; min-width: 0; }
  .option-label {
    font-size: var(--rtc-font-size-sm);
    font-weight: var(--rtc-font-weight-medium);
    color: var(--rtc-color-text);
    line-height: 1.3;
  }
  .rec {
    margin-left: 6px;
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-primary);
    font-weight: var(--rtc-font-weight-medium);
  }
  .option-desc {
    font-size: var(--rtc-font-size-xs);
    color: var(--rtc-color-text-secondary);
    line-height: 1.4;
    margin-top: 2px;
  }

  /* ---- Other option input ---- */
  .option-wrapper {
    display: flex;
    flex-direction: column;
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    transition: background var(--rtc-transition-duration) var(--rtc-transition-timing),
                border-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    background: var(--rtc-color-bg);
  }
  .option-wrapper:hover { background: var(--rtc-color-bg-hover); }
  .option-wrapper.selected {
    border-color: var(--rtc-color-primary);
    background: var(--rtc-color-primary-soft);
  }
  .option-wrapper .option.other {
    border: none;
    border-radius: 0;
  }
  .other-input {
    margin: 0 10px 10px 10px;
    width: calc(100% - 20px);
    padding: 5px 7px;
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: 6px;
    background: var(--rtc-color-bg);
    color: var(--rtc-color-text);
    font-size: var(--rtc-font-size-xs);
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  .other-input:focus { border-color: var(--rtc-color-primary); }
  .other-input::placeholder { color: var(--rtc-color-text-tertiary); }

  /* ---- Preview panel ---- */
  .preview-label {
    font-size: 10px;
    color: var(--rtc-color-text-tertiary);
    margin: 8px 0 4px 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .preview-panel {
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    background: var(--rtc-color-bg-secondary);
    padding: 8px 10px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11px;
    line-height: 1.5;
    color: var(--rtc-color-text);
    white-space: pre;
    overflow-x: auto;
    max-height: 140px;
    overflow-y: auto;
  }

  /* ---- Footer ---- */
  .actions {
    display: flex;
    gap: var(--rtc-spacing-sm);
    flex-shrink: 0;
    margin-top: var(--rtc-spacing-md);
    align-items: center;
  }
  .action-btn {
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
  .action-btn:hover { background: var(--rtc-color-bg-hover); }
  .action-btn.primary {
    background: var(--rtc-color-primary);
    border-color: var(--rtc-color-primary);
    color: var(--rtc-color-text-inverse);
    margin-left: auto;
  }
  .action-btn.primary:hover { background: var(--rtc-color-primary-hover); }
  .action-btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .action-btn.primary:disabled:hover { background: var(--rtc-color-primary); }
  .action-btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--rtc-color-text-secondary);
  }
  .action-btn.ghost:hover {
    background: var(--rtc-color-bg-hover);
    color: var(--rtc-color-text);
  }
  .action-btn.ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .action-btn.ghost:disabled:hover {
    background: transparent;
    color: var(--rtc-color-text-secondary);
  }

  .progress {
    font-size: 10px;
    color: var(--rtc-color-text-tertiary);
    text-align: center;
    margin-top: 6px;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }
`;
