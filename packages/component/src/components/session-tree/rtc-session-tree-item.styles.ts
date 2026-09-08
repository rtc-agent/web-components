import {css} from 'lit';

/**
 * Session Tree Item 样式
 *
 * 参考 rtc-file-tree-item.styles.ts 的完整模式：
 * - static styles 数组包含 [tokens, lightTheme, darkTheme, baseStyles, styles]
 * - 显式 :host([theme='dark']) / :host([theme='light']) 块
 * - 选中态使用 --rtc-color-on-primary 作为文字色
 * - 左侧 2px accent 指示条
 */
export const styles = css`
    :host {
        display: block;
        background: transparent;
    }

    .tree-item-content {
        display: flex;
        align-items: center;
        height: 28px;
        padding-right: 8px;
        cursor: pointer;
        gap: 6px;
        font-size: 13px;
        color: var(--rtc-color-text);
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
        color: var(--rtc-color-text-inverse);
    }

    .tree-item-content.selected::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 2px;
        background-color: var(--rtc-color-primary);
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

    /* 占位（叶子节点无 chevron，用 indent 对齐） */
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

    .icon.folder,
    .icon.folder-open {
        color: var(--rtc-color-icon-folder);
    }

    .icon.session {
        color: var(--rtc-color-text-secondary);
    }

    /* ── Status dot ── */
    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--rtc-color-success, #22c55e);
        opacity: 0.6;
    }

    .status-dot.active {
        opacity: 1;
        animation: rtc-tree-status-pulse 1.6s ease-in-out infinite;
    }

    .status-dot.closed {
        background: var(--rtc-color-text-tertiary, #6b7280);
        opacity: 0.5;
    }

    @keyframes rtc-tree-status-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.4; transform: scale(0.85); }
    }

    /* 标题 */
    .label {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 13px;
        line-height: 28px;
    }

    /* 时间戳 */
    .timestamp {
        flex-shrink: 0;
        font-size: 11px;
        color: var(--rtc-color-text-tertiary);
        margin-left: auto;
        padding-left: 8px;
    }

    /* 子节点容器 */
    .children {
        display: block;
        background-color: inherit;
    }

    /* ── 暗色主题适配 ── */
    :host([theme='dark']) .tree-item-content {
        color: var(--rtc-color-text, #cccccc);
    }

    :host([theme='dark']) .tree-item-content:hover {
        background-color: var(--rtc-color-bg-hover, #2a2d2e);
    }

    :host([theme='dark']) .tree-item-content.selected {
        background-color: var(--rtc-color-primary, #2741fe);
        color: var(--rtc-color-text-inverse, #ffffff);
    }

    :host([theme='dark']) .icon.session {
        color: var(--rtc-color-text-secondary, #858585);
    }

    :host([theme='dark']) .timestamp {
        color: var(--rtc-color-text-tertiary, #6e6e6e);
    }

    /* ── 亮色主题适配 ── */
    :host([theme='light']) .tree-item-content {
        color: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .tree-item-content:hover {
        background-color: var(--rtc-color-bg-hover, #f0f0f0);
    }

    :host([theme='light']) .tree-item-content.selected {
        background-color: var(--rtc-color-primary, #2741fe);
        color: var(--rtc-color-text-inverse, #ffffff);
    }

    :host([theme='light']) .icon.session {
        color: var(--rtc-color-text-secondary, #666666);
    }

    :host([theme='light']) .timestamp {
        color: var(--rtc-color-text-tertiary, #999999);
    }

    @media (prefers-reduced-motion: reduce) {
        .status-dot.active {
            animation: none;
        }
    }
`;
