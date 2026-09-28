import {css} from 'lit';

/**
 * File Tree Item styles
 *
 * Colors use project Tokens to ensure dual-theme compatibility.
 * Folder icons use VS Code style gold (#dcb67a), file icons use blue (#519aba).
 */
export const styles = css`
    :host {
        display: block;
        background: transparent;
    }

    .tree-item {
        user-select: none;
    }

    .tree-item-content {
        display: flex;
        align-items: center;
        height: 28px;
        padding-right: 8px;
        cursor: pointer;
        gap: 6px;
        font-size: 13px;
        color: var(--rtc-color-text-primary);
        position: relative;
        transition: background-color 0.15s ease;
    }

    .tree-item-content:hover {
        background-color: var(--rtc-color-bg-hover);
    }

    .tree-item-content:focus-visible {
        outline: 1px solid var(--rtc-color-primary);
        outline-offset: -1px;
        background-color: var(--rtc-color-bg-hover);
    }

    .tree-item-content.selected {
        background-color: var(--rtc-color-primary);
        color: var(--rtc-color-on-primary);
    }

    .tree-item-content.selected::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 2px;
        background-color: var(--rtc-color-accent);
    }

    /* Chevron (expand/collapse arrow) */
    .chevron {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: transform 0.15s ease;
    }

    .chevron svg {
        width: 12px;
        height: 12px;
        fill: currentColor;
    }

    .chevron.expanded {
        transform: rotate(90deg);
    }

    /* Placeholder (file item has no chevron, use indent to align) */
    .indent {
        width: 16px;
        flex-shrink: 0;
    }

    /* Icon */
    .icon {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .icon svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
    }

    .icon.folder,
    .icon.folder-open {
        color: var(--rtc-color-icon-folder);
    }

    .icon.file {
        color: var(--rtc-color-text-secondary, #888);
    }

    .icon.file-md {
        color: var(--rtc-color-icon-file-md);
    }

    .icon.file-js {
        color: var(--rtc-color-icon-file-js);
    }

    /* File name */
    .label {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 13px;
        line-height: 28px;
    }

    /* Loading indicator */
    .spinner {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        border: 2px solid var(--rtc-color-border);
        border-top-color: var(--rtc-color-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* Child nodes container */
    .children {
        display: block;
        background-color: inherit;
    }

    /* Dark mode adaptation */
    :host([theme="dark"]) .tree-item-content {
        color: var(--rtc-color-text-primary, #cccccc);
    }

    :host([theme="dark"]) .tree-item-content:hover {
        background-color: var(--rtc-color-bg-hover, #2a2d2e);
    }

    :host([theme="dark"]) .tree-item-content.selected {
        background-color: var(--rtc-color-primary, #094771);
        color: var(--rtc-color-on-primary, #ffffff);
    }

    :host([theme="dark"]) .icon.file {
        color: var(--rtc-color-text-secondary, #888);
    }

    /* Light mode adaptation */
    :host([theme="light"]) .tree-item-content {
        color: var(--rtc-color-text-primary, #333333);
    }

    :host([theme="light"]) .tree-item-content:hover {
        background-color: var(--rtc-color-bg-hover, #e8e8e8);
    }

    :host([theme="light"]) .tree-item-content.selected {
        background-color: var(--rtc-color-primary, #2741fe);
        color: var(--rtc-color-on-primary, #ffffff);
    }

    :host([theme="light"]) .icon.file {
        color: var(--rtc-color-text-secondary, #666);
    }
`;
