import {css} from 'lit';

/**
 * Session Tab Bar 样式
 *
 * 布局结构：
 * - .tab-bar-wrapper: 外层 flex 容器
 * - .tabs-scroll: 左侧可滚动 tabs 区域 (flex: 1)
 * - .tab-add: 右侧固定新建按钮 (flex-shrink: 0)
 */
export const styles = css`
    :host {
        display: block;
        flex-shrink: 0;
        min-width: 0;
    }

    /* ── 外层容器 ── */
    .tab-bar-wrapper {
        display: flex;
        align-items: center;
        height: 36px;
        background: var(--rtc-color-bg-tertiary);
        border-bottom: 1px solid var(--rtc-color-border);
    }

    /* ── Tabs 可滚动区域 ── */
    .tabs-scroll {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        height: 100%;
        overflow-x: auto;
        overflow-y: hidden;
    }

    /* 隐藏滚动条但保持可滚动 */
    .tabs-scroll::-webkit-scrollbar {
        display: none;
    }

    .tabs-scroll {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }

    /* ── 新建会话按钮（固定右侧） ── */
    .tab-add {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        padding: 0;
        border: none;
        border-left: 1px solid var(--rtc-color-border);
        background: var(--rtc-color-bg-tertiary);
        color: var(--rtc-color-text-secondary);
        cursor: pointer;
        transition: background var(--rtc-transition-duration) var(--rtc-transition-timing),
                    color var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .tab-add:hover {
        background: var(--rtc-color-bg-hover);
        color: var(--rtc-color-text);
    }

    .tab-add:focus-visible {
        outline: 1px solid var(--rtc-color-primary);
        outline-offset: -1px;
    }

    .tab-add svg {
        width: 16px;
        height: 16px;
    }

    /* ── 暗色主题适配 ── */
    :host([theme='dark']) .tab-bar-wrapper,
    :host([theme='dark']) .tab-add {
        background: var(--rtc-color-bg-tertiary, #2d2d30);
        border-color: var(--rtc-color-border, #1a1a1a);
    }

    :host([theme='dark']) .tab-add {
        color: var(--rtc-color-text-secondary, #858585);
    }

    :host([theme='dark']) .tab-add:hover {
        background: var(--rtc-color-bg-hover, #2a2d2e);
        color: var(--rtc-color-text, #cccccc);
    }

    /* ── 亮色主题适配 ── */
    :host([theme='light']) .tab-bar-wrapper,
    :host([theme='light']) .tab-add {
        background: var(--rtc-color-bg-tertiary, #e8e8e8);
        border-color: var(--rtc-color-border, #e0e0e0);
    }

    :host([theme='light']) .tab-add {
        color: var(--rtc-color-text-secondary, #666666);
    }

    :host([theme='light']) .tab-add:hover {
        background: var(--rtc-color-bg-hover, #f0f0f0);
        color: var(--rtc-color-text, #333333);
    }

    @media (prefers-reduced-motion: reduce) {
        .tab-add {
            transition: none;
        }
    }
`;
