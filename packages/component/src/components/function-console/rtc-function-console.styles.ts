import {css} from 'lit';

/**
 * Function Console Component Styles
 *
 * Real-time log output console with level-based coloring.
 * Colors use project Tokens (--rtc-color-*) to ensure dual-theme adaptation.
 */
export const styles = css`
    :host {
        display: flex;
        flex-direction: column;
        min-height: 150px;
        flex: 1;
    }

    .console-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--rtc-spacing-xs);
        flex-shrink: 0;
    }

    .console-label {
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-bold);
        color: var(--rtc-color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.02em;
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

    .console-body {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        background: var(--rtc-color-bg-secondary);
        border: 1px solid var(--rtc-color-border);
        border-radius: var(--rtc-border-radius-sm);
        padding: var(--rtc-spacing-xs) 0;
        font-family: var(--rtc-font-family-mono);
        font-size: var(--rtc-font-size-sm);
        line-height: var(--rtc-line-height-base);
    }

    .console-body::-webkit-scrollbar {
        width: 6px;
    }

    .console-body::-webkit-scrollbar-track {
        background: transparent;
    }

    .console-body::-webkit-scrollbar-thumb {
        background: var(--rtc-color-border);
        border-radius: 3px;
    }

    .log-entry {
        display: flex;
        gap: var(--rtc-spacing-xs);
        padding: 2px var(--rtc-spacing-sm);
        align-items: flex-start;
    }

    .log-timestamp {
        flex-shrink: 0;
        color: var(--rtc-color-text-tertiary);
        font-size: var(--rtc-font-size-xs);
    }

    .log-level {
        flex-shrink: 0;
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-medium);
        min-width: 42px;
    }

    .log-level.info {
        color: var(--rtc-color-info);
    }

    .log-level.warn {
        color: var(--rtc-color-warning);
    }

    .log-level.error {
        color: var(--rtc-color-error);
    }

    .log-level.debug {
        color: var(--rtc-color-text-tertiary);
    }

    .log-message {
        flex: 1;
        min-width: 0;
        word-break: break-word;
    }

    .log-data {
        margin-top: 2px;
        padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
        background: var(--rtc-color-bg-tertiary);
        border-radius: var(--rtc-border-radius-sm);
        font-size: var(--rtc-font-size-xs);
        cursor: pointer;
        white-space: pre-wrap;
        word-break: break-all;
    }

    .log-data.collapsed {
        max-height: 1.5em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .empty-console {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        min-height: 80px;
        color: var(--rtc-color-text-tertiary);
        font-size: var(--rtc-font-size-xs);
        font-style: italic;
    }
`;
