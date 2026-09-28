import {css} from 'lit';

/**
 * Function History Component Styles
 *
 * Bottom drawer that slides up from the bottom of the debugger panel.
 * Colors use project Tokens (--rtc-color-*) to ensure dual-theme adaptation.
 */
export const styles = css`
    :host {
        display: block;
    }

    /* ── Drawer Container ── */

    .history-drawer {
        display: flex;
        flex-direction: column;
        background: var(--rtc-color-bg-primary);
        border-top: 1px solid var(--rtc-color-border);
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.12);
    }

    /* ── Drawer Header (always visible) ── */

    .drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
        cursor: pointer;
        user-select: none;
        min-height: 36px;
        background: var(--rtc-color-bg-secondary);
        transition: background-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .drawer-header:hover {
        background: var(--rtc-color-bg-hover);
    }

    .drawer-title {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs);
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-bold);
        color: var(--rtc-color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.02em;
    }

    .history-count {
        font-weight: var(--rtc-font-weight-normal);
        color: var(--rtc-color-text-tertiary);
        text-transform: none;
        letter-spacing: normal;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs);
    }

    .clear-btn {
        background: none;
        border: none;
        color: var(--rtc-color-text-tertiary);
        font-size: var(--rtc-font-size-xs);
        cursor: pointer;
        padding: 2px 6px;
        border-radius: var(--rtc-border-radius-sm);
        transition: color var(--rtc-transition-duration) var(--rtc-transition-timing),
                    background-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .clear-btn:hover {
        color: var(--rtc-color-text);
        background: var(--rtc-color-bg-hover);
    }

    .chevron {
        display: inline-flex;
        width: 12px;
        height: 12px;
        color: var(--rtc-color-text-tertiary);
        transition: transform var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .chevron.expanded {
        transform: rotate(90deg);
    }

    /* ── Drawer Body (slides up, scrollable) ── */

    .drawer-body {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.25s ease-in-out;
    }

    .history-drawer.open .drawer-body {
        max-height: 320px;
        overflow-y: auto;
        border-top: 1px solid var(--rtc-color-border);
    }

    .drawer-body::-webkit-scrollbar {
        width: 6px;
    }

    .drawer-body::-webkit-scrollbar-track {
        background: transparent;
    }

    .drawer-body::-webkit-scrollbar-thumb {
        background: var(--rtc-color-border);
        border-radius: 3px;
    }

    /* ── History Item ── */

    .history-item {
        border-bottom: 1px solid var(--rtc-color-border);
        transition: background-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .history-item:last-child {
        border-bottom: none;
    }

    .history-item:hover {
        background: var(--rtc-color-bg-hover);
    }

    .item-header {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs);
        padding: 6px var(--rtc-spacing-sm);
        cursor: pointer;
    }

    .item-chevron {
        display: inline-flex;
        width: 12px;
        height: 12px;
        flex-shrink: 0;
        color: var(--rtc-color-text-tertiary);
    }

    .history-status {
        flex-shrink: 0;
        width: 16px;
        text-align: center;
        font-size: var(--rtc-font-size-xs);
    }

    .history-status.success {
        color: var(--rtc-color-success);
    }

    .history-status.error {
        color: var(--rtc-color-error);
    }

    .history-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .history-name {
        font-size: var(--rtc-font-size-sm);
        color: var(--rtc-color-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .history-meta {
        display: flex;
        gap: var(--rtc-spacing-sm);
        font-size: var(--rtc-font-size-xs);
        color: var(--rtc-color-text-tertiary);
    }

    /* ── Item Details (expanded) ── */

    .item-details {
        padding: var(--rtc-spacing-sm);
        background: var(--rtc-color-bg-secondary);
        border-top: 1px solid var(--rtc-color-border);
        display: flex;
        flex-direction: column;
        gap: var(--rtc-spacing-sm);
    }

    .detail-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .detail-label {
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-bold);
        color: var(--rtc-color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.02em;
    }

    .detail-content {
        margin: 0;
        font-family: var(--rtc-font-family-mono);
        font-size: var(--rtc-font-size-xs);
        color: var(--rtc-color-text);
        white-space: pre-wrap;
        word-break: break-all;
        background: var(--rtc-color-bg-tertiary);
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
        border-radius: var(--rtc-border-radius-sm);
        border: 1px solid var(--rtc-color-border);
        max-height: 200px;
        overflow-y: auto;
    }

    .detail-content::-webkit-scrollbar {
        width: 4px;
    }

    .detail-content::-webkit-scrollbar-track {
        background: transparent;
    }

    .detail-content::-webkit-scrollbar-thumb {
        background: var(--rtc-color-border);
        border-radius: 2px;
    }

    .result-content.success {
        border-color: var(--rtc-color-success);
    }

    .result-content.error {
        border-color: var(--rtc-color-error);
    }

    /* ── Log entries inside details ── */

    .logs-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
        background: var(--rtc-color-bg-tertiary);
        border-radius: var(--rtc-border-radius-sm);
        border: 1px solid var(--rtc-color-border);
        max-height: 200px;
        overflow-y: auto;
    }

    .log-entry {
        display: flex;
        flex-wrap: wrap;
        gap: var(--rtc-spacing-xs);
        font-family: var(--rtc-font-family-mono);
        font-size: var(--rtc-font-size-xs);
        line-height: var(--rtc-line-height-base);
    }

    .log-level {
        flex-shrink: 0;
        font-weight: var(--rtc-font-weight-bold);
        min-width: 48px;
    }

    .log-entry.info .log-level {
        color: var(--rtc-color-info);
    }

    .log-entry.warn .log-level {
        color: var(--rtc-color-warning);
    }

    .log-entry.error .log-level {
        color: var(--rtc-color-error);
    }

    .log-message {
        color: var(--rtc-color-text);
        flex: 1;
        min-width: 0;
        word-break: break-word;
    }

    .log-data {
        width: 100%;
        margin: 0;
        padding: 4px var(--rtc-spacing-xs);
        background: var(--rtc-color-bg-primary);
        border-radius: var(--rtc-border-radius-sm);
        font-size: var(--rtc-font-size-xs);
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--rtc-color-text-secondary);
    }

    /* ── Detail Actions ── */

    .detail-actions {
        display: flex;
        gap: var(--rtc-spacing-sm);
        justify-content: flex-end;
        padding-top: var(--rtc-spacing-xs);
    }

    .detail-btn {
        background: none;
        border: 1px solid var(--rtc-color-border);
        color: var(--rtc-color-text-secondary);
        font-size: var(--rtc-font-size-xs);
        cursor: pointer;
        padding: 4px var(--rtc-spacing-sm);
        border-radius: var(--rtc-border-radius-sm);
        transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .detail-btn:hover {
        color: var(--rtc-color-text);
        border-color: var(--rtc-color-border-hover);
        background: var(--rtc-color-bg-hover);
    }

    .detail-btn.primary {
        background: var(--rtc-color-primary);
        color: var(--rtc-color-text-inverse);
        border-color: var(--rtc-color-primary);
    }

    .detail-btn.primary:hover {
        background: var(--rtc-color-primary-hover);
        border-color: var(--rtc-color-primary-hover);
    }

    /* ── Empty State ── */

    .empty-history {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--rtc-spacing-md);
        color: var(--rtc-color-text-tertiary);
        font-size: var(--rtc-font-size-xs);
        font-style: italic;
    }
`;
