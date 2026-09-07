import {css} from 'lit';

/**
 * File Tree Item 样式
 *
 * 颜色使用项目 Tokens，确保双主题适配。
 * 文件夹图标使用 VS Code 风格金色（#dcb67a），文件图标使用蓝色（#519aba）。
 */
export const styles = css`
    :host {
        display: block;
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

    /* Chevron (展开/折叠箭头) */
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

    /* 占位（文件项无 chevron，用 indent 对齐） */
    .indent {
        width: 16px;
        flex-shrink: 0;
    }

    /* 图标 */
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

    .icon.folder {
        color: #dcb67a;
    }

    .icon.folder-open {
        color: #dcb67a;
    }

    .icon.file {
        color: var(--rtc-color-text-secondary, #888);
    }

    .icon.file-md {
        color: #519aba;
    }

    .icon.file-js {
        color: #cbcb41;
    }

    /* 文件名 */
    .label {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 13px;
        line-height: 28px;
    }

    /* 加载指示器 */
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

    /* 子节点容器 */
    .children {
        display: block;
        background-color: inherit;
    }

    /* 暗色模式适配 */
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

    /* 亮色模式适配 */
    :host([theme="light"]) .tree-item-content {
        color: var(--rtc-color-text-primary, #333333);
    }

    :host([theme="light"]) .tree-item-content:hover {
        background-color: var(--rtc-color-bg-hover, #e8e8e8);
    }

    :host([theme="light"]) .tree-item-content.selected {
        background-color: var(--rtc-color-primary, #007acc);
        color: var(--rtc-color-on-primary, #ffffff);
    }

    :host([theme="light"]) .icon.file {
        color: var(--rtc-color-text-secondary, #666);
    }
`;
