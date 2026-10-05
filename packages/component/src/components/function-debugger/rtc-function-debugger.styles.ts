import {css} from 'lit';

/**
 * Function Debugger Component Styles
 *
 * Main debugger panel: function info, params, execute button, console, history.
 * Colors use project Tokens (--rtc-color-*) to ensure dual-theme adaptation.
 */
export const styles = css`
    :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .debugger-content {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: auto;
        gap: var(--rtc-spacing-sm);
        padding: var(--rtc-spacing-sm);
        /* Reserve space for history drawer header at the bottom */
        padding-bottom: calc(var(--rtc-spacing-sm) + 36px);
        position: relative;
    }

    /* ── Function Info Section (collapsible) ── */

    .function-info-section {
        flex-shrink: 0;
        border: 1px solid var(--rtc-color-border);
        border-radius: var(--rtc-border-radius-sm);
        overflow: hidden;
    }

    .info-header {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs);
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
        cursor: pointer;
        user-select: none;
        background: var(--rtc-color-bg-tertiary);
        transition: background-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .info-header:hover {
        background: var(--rtc-color-bg-hover);
    }

    .info-chevron {
        display: inline-flex;
        width: 12px;
        height: 12px;
        color: var(--rtc-color-text-tertiary);
    }

    .info-title {
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-bold);
        color: var(--rtc-color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.02em;
    }

    .info-body {
        padding: var(--rtc-spacing-sm);
        background: var(--rtc-color-bg-secondary);
        max-height: 200px;
        overflow-y: auto;
    }

    .info-name {
        font-size: var(--rtc-font-size-lg);
        font-weight: var(--rtc-font-weight-bold);
        color: var(--rtc-color-text);
        margin-bottom: var(--rtc-spacing-xs);
    }

    .info-description {
        font-size: var(--rtc-font-size-sm);
        color: var(--rtc-color-text-secondary);
        line-height: var(--rtc-line-height-base);
        margin-bottom: var(--rtc-spacing-sm);
    }

    /* ── Parameter Documentation Table ── */

    .info-params-doc {
        margin-top: var(--rtc-spacing-sm);
    }

    .params-doc-title {
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-bold);
        color: var(--rtc-color-text-secondary);
        margin-bottom: var(--rtc-spacing-xs);
    }

    .params-doc-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--rtc-font-size-xs);
    }

    .params-doc-table th {
        text-align: left;
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
        background: var(--rtc-color-bg-tertiary);
        color: var(--rtc-color-text-secondary);
        font-weight: var(--rtc-font-weight-bold);
        border-bottom: 1px solid var(--rtc-color-border);
    }

    .params-doc-table td {
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
        border-bottom: 1px solid var(--rtc-color-border);
        color: var(--rtc-color-text);
    }

    .param-name {
        font-family: var(--rtc-font-family-mono);
        color: var(--rtc-color-accent);
    }

    .param-type {
        font-family: var(--rtc-font-family-mono);
        color: var(--rtc-color-text-secondary);
    }

    .param-required {
        text-align: left;
    }

    .param-desc {
        color: var(--rtc-color-text-secondary);
    }

    /* ── Params Section ── */

    .params-section {
        flex-shrink: 0;
    }

    /* ── Action Bar ── */

    .action-bar {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-sm);
        flex-shrink: 0;
        padding: 0 var(--rtc-spacing-xs);
    }

    .run-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--rtc-spacing-xs);
        padding: 6px var(--rtc-spacing-md);
        background: var(--rtc-color-primary);
        color: var(--rtc-color-text-inverse);
        border: none;
        border-radius: var(--rtc-border-radius-sm);
        font-size: var(--rtc-font-size-sm);
        font-weight: var(--rtc-font-weight-medium);
        cursor: pointer;
        transition: background-color var(--rtc-transition-duration) var(--rtc-transition-timing),
                    opacity var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .run-btn:hover:not(:disabled) {
        background: var(--rtc-color-primary-hover);
    }

    .run-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .run-btn.running {
        background: var(--rtc-color-info);
    }

    .status-indicator {
        font-size: var(--rtc-font-size-xs);
        color: var(--rtc-color-text-tertiary);
    }

    .status-indicator.success {
        color: var(--rtc-color-success);
    }

    .status-indicator.error {
        color: var(--rtc-color-error);
    }

    /* ── Console Section ── */

    .console-section {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    /* ── History Drawer (bottom drawer, overlays content) ── */

    .history-section {
        position: sticky;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 10;
        background: var(--rtc-color-bg-primary);
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
    }

    /* ── Empty State ── */

    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: var(--rtc-spacing-xl);
    }

    .empty-state-text {
        font-size: var(--rtc-font-size-sm);
        color: var(--rtc-color-text-tertiary);
        text-align: center;
    }
`;
