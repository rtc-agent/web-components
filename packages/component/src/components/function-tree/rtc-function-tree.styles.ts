/**
 * Function Tree Component Styles
 *
 * Tree view styles for the function list.
 * Colors use project Tokens (--rtc-color-*) to ensure dual-theme adaptation.
 */
import {css} from 'lit';

export const styles = css`
    :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        background: var(--rtc-color-bg-secondary);
    }

    /* ── Header ── */

    .tree-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--rtc-spacing-sm);
        height: 36px;
        flex-shrink: 0;
        background: var(--rtc-color-bg-tertiary);
        border-bottom: 1px solid var(--rtc-color-border);
    }

    .tree-title {
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-medium);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--rtc-color-text-secondary);
        user-select: none;
    }

    /* ── Tree Container ── */

    .tree-container {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: var(--rtc-spacing-xs) 0;
    }

    .tree-container::-webkit-scrollbar {
        width: 6px;
    }

    .tree-container::-webkit-scrollbar-track {
        background: transparent;
    }

    .tree-container::-webkit-scrollbar-thumb {
        background: var(--rtc-color-border);
        border-radius: 3px;
    }

    .tree-container::-webkit-scrollbar-thumb:hover {
        background: var(--rtc-color-border-hover);
    }

    /* ── Tree Nodes ── */

    .tree-node {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs);
        padding: 4px var(--rtc-spacing-sm);
        cursor: pointer;
        user-select: none;
        min-height: 28px;
        transition: background-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .tree-node:hover {
        background: var(--rtc-color-bg-hover);
    }

    .tree-node.focused {
        outline: 1px solid var(--rtc-color-border-focus);
        outline-offset: -1px;
    }

    .tree-node.selected {
        background: var(--rtc-color-bg-active);
    }

    .tree-node.selected:hover {
        background: var(--rtc-color-bg-active);
    }

    /* ── Group Node ── */

    .group-node {
        font-weight: var(--rtc-font-weight-bold);
        font-size: var(--rtc-font-size-xs);
        color: var(--rtc-color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.02em;
    }

    .chevron {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        color: var(--rtc-color-text-tertiary);
    }

    .chevron svg {
        width: 12px;
        height: 12px;
    }

    /* ── Function Node ── */

    .function-node {
        font-size: var(--rtc-font-size-sm);
        color: var(--rtc-color-text);
    }

    .node-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .node-description {
        font-size: var(--rtc-font-size-xs);
        color: var(--rtc-color-text-tertiary);
        margin-left: auto;
        padding-left: var(--rtc-spacing-sm);
        flex-shrink: 0;
        max-width: 40%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Empty State ── */

    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: var(--rtc-spacing-lg);
    }

    .empty-state-text {
        font-size: var(--rtc-font-size-sm);
        color: var(--rtc-color-text-tertiary);
        text-align: center;
    }
`;
