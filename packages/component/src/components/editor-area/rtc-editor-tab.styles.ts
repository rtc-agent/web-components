import {css} from 'lit';

/**
 * Editor Tab 样式
 *
 * VS Code 风格编辑器标签页。
 * 颜色使用项目 Tokens，确保双主题适配。
 */
export const styles = css`
    :host {
        display: inline-block;
        height: 36px;
        flex-shrink: 0;
    }

    .tab {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 var(--rtc-spacing-sm, 8px);
        gap: 6px;
        cursor: pointer;
        background: var(--rtc-color-bg-tertiary, #2d2d30);
        border-right: 1px solid var(--rtc-color-border, #3c3c3c);
        color: var(--rtc-color-text-secondary, #858585);
        font-size: var(--rtc-font-size-sm, 13px);
        position: relative;
        user-select: none;
        transition: background-color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease),
                    color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
    }

    .tab:hover {
        background: var(--rtc-color-bg-hover, #2a2d2e);
        color: var(--rtc-color-text, #cccccc);
    }

    /* 活动标签：顶部指示条 + 背景切换 */
    .tab.active {
        background: var(--rtc-color-bg, #1e1e1e);
        color: var(--rtc-color-text, #cccccc);
    }

    .tab.active::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: var(--rtc-color-primary, #2741fe);
    }

    /* 文件图标 */
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

    .icon.file-md {
        color: var(--rtc-color-icon-file-md);
    }

    .icon.file-js {
        color: var(--rtc-color-icon-file-js);
    }

    .icon.file {
        color: var(--rtc-color-text-secondary, #858585);
    }

    /* 文件名 */
    .name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 120px;
        line-height: 36px;
    }

    /* 脏标记（未保存圆点） */
    .dirty-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--rtc-color-text, #cccccc);
        flex-shrink: 0;
    }

    /* 关闭按钮 */
    .close-btn {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--rtc-border-radius-sm, 4px);
        flex-shrink: 0;
        opacity: 0;
        transition: opacity var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease),
                    background-color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
    }

    .close-btn svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
    }

    /* 悬停或活动时显示关闭按钮 */
    .tab:hover .close-btn,
    .tab.active .close-btn {
        opacity: 0.7;
    }

    .close-btn:hover {
        opacity: 1 !important;
        background: var(--rtc-color-bg-active, #37373d);
    }

    /* 有脏标记时，默认隐藏关闭按钮，悬停时显示脏标记 */
    .tab.dirty:not(:hover):not(.active) .close-btn {
        opacity: 0;
    }

    .tab.dirty:not(:hover):not(.active) .dirty-dot {
        opacity: 1;
    }

    .tab.dirty:hover .dirty-dot,
    .tab.dirty.active .dirty-dot {
        opacity: 0;
    }

    /* ── 暗色主题适配 ── */
    :host([theme='dark']) .tab {
        background: var(--rtc-color-bg-tertiary, #2d2d30);
        color: var(--rtc-color-text-secondary, #858585);
    }

    :host([theme='dark']) .tab:hover {
        background: var(--rtc-color-bg-hover, #2a2d2e);
        color: var(--rtc-color-text, #cccccc);
    }

    :host([theme='dark']) .tab.active {
        background: var(--rtc-color-bg, #1e1e1e);
        color: var(--rtc-color-text, #cccccc);
    }

    :host([theme='dark']) .dirty-dot {
        background: var(--rtc-color-text, #cccccc);
    }

    /* ── 亮色主题适配 ── */
    :host([theme='light']) .tab {
        background: var(--rtc-color-bg-tertiary, #e8e8e8);
        color: var(--rtc-color-text-secondary, #666666);
    }

    :host([theme='light']) .tab:hover {
        background: var(--rtc-color-bg-hover, #f0f0f0);
        color: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .tab.active {
        background: var(--rtc-color-bg, #ffffff);
        color: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .dirty-dot {
        background: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .close-btn:hover {
        background: var(--rtc-color-bg-active, #e0e0e0);
    }
`;
