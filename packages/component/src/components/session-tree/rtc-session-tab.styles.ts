import {css} from 'lit';

/**
 * Session Tab 样式
 *
 * 参考 rtc-editor-tab.styles.ts 的完整模式：
 * - static styles 数组包含 [tokens, lightTheme, darkTheme, baseStyles, styles]
 * - 显式 :host([theme='dark']) / :host([theme='light']) 块
 * - active 状态顶部 1px 指示条
 * - dirty dot / close button opacity 切换逻辑
 */
export const styles = css`
    :host {
        display: inline-block;
        height: 36px;
        max-width: 200px;
        flex-shrink: 0;
        background: transparent;
    }

    .tab {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 var(--rtc-spacing-md);
        gap: var(--rtc-spacing-xs);
        cursor: pointer;
        background: var(--rtc-color-bg-tertiary);
        border-right: 2px solid var(--rtc-color-border);
        font-size: var(--rtc-font-size-sm);
        color: var(--rtc-color-text-secondary);
        position: relative;
        transition: background var(--rtc-transition-duration) var(--rtc-transition-timing),
                    color var(--rtc-transition-duration) var(--rtc-transition-timing);
        user-select: none;
    }

    .tab:hover {
        background: var(--rtc-color-bg-hover);
        color: var(--rtc-color-text);
    }

    .tab:focus-visible {
        outline: 1px solid var(--rtc-color-primary);
        outline-offset: -1px;
        background: var(--rtc-color-bg-hover);
        color: var(--rtc-color-text);
    }

    .tab.active {
        background: var(--rtc-color-bg);
        color: var(--rtc-color-text);
    }

    .tab.active::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: var(--rtc-color-primary);
    }

    .tab-title {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
    }

    .tab-dirty {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--rtc-color-warning);
        flex-shrink: 0;
    }

    .tab-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--rtc-color-text-tertiary);
        cursor: pointer;
        border-radius: var(--rtc-border-radius-sm);
        opacity: 0;
        transition: opacity var(--rtc-transition-duration) var(--rtc-transition-timing),
                    background var(--rtc-transition-duration) var(--rtc-transition-timing),
                    color var(--rtc-transition-duration) var(--rtc-transition-timing);
        flex-shrink: 0;
    }

    .tab:hover .tab-close,
    .tab.active .tab-close {
        opacity: 1;
    }

    .tab-close:hover {
        background: var(--rtc-color-bg-hover);
        color: var(--rtc-color-text);
    }

    .tab-close:focus-visible {
        opacity: 1;
        outline: 1px solid var(--rtc-color-primary);
        outline-offset: -1px;
    }

    .tab-close svg {
        width: 14px;
        height: 14px;
    }

    /* ── 暗色主题适配 ── */
    :host([theme='dark']) .tab {
        background: var(--rtc-color-bg-tertiary, #2d2d30);
        color: var(--rtc-color-text-secondary, #858585);
        border-right-color: var(--rtc-color-border, #1a1a1a);
    }

    :host([theme='dark']) .tab:hover {
        background: var(--rtc-color-bg-hover, #2a2d2e);
        color: var(--rtc-color-text, #cccccc);
    }

    :host([theme='dark']) .tab.active {
        background: var(--rtc-color-bg, #1e1e1e);
        color: var(--rtc-color-text, #cccccc);
    }

    :host([theme='dark']) .tab-close {
        color: var(--rtc-color-text-tertiary, #6e6e6e);
    }

    :host([theme='dark']) .tab-close:hover {
        background: var(--rtc-color-bg-hover, #2a2d2e);
        color: var(--rtc-color-text, #cccccc);
    }

    /* ── 亮色主题适配 ── */
    :host([theme='light']) .tab {
        background: var(--rtc-color-bg-tertiary, #e8e8e8);
        color: var(--rtc-color-text-secondary, #666666);
        border-right-color: var(--rtc-color-border, #e0e0e0);
    }

    :host([theme='light']) .tab:hover {
        background: var(--rtc-color-bg-hover, #f0f0f0);
        color: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .tab.active {
        background: var(--rtc-color-bg, #ffffff);
        color: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .tab-close {
        color: var(--rtc-color-text-tertiary, #999999);
    }

    :host([theme='light']) .tab-close:hover {
        background: var(--rtc-color-bg-hover, #f0f0f0);
        color: var(--rtc-color-text, #333333);
    }

    @media (prefers-reduced-motion: reduce) {
        .tab,
        .tab-close {
            transition: none;
        }
    }
`;
