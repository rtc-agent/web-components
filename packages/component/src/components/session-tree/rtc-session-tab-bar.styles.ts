import {css} from 'lit';

/**
 * Session Tab Bar 样式
 *
 * 参考 rtc-editor-area.styles.ts 的 tabs-bar 模式：
 * - 内部 .tabs-bar 横向排列，overflow-x: auto
 * - 隐藏滚动条但保持可滚动
 * - 颜色使用项目 Tokens，确保双主题适配
 */
export const styles = css`
    :host {
        display: block;
        flex-shrink: 0;
        min-width: 0;
    }

    /* ── Tabs 容器（可滚动区域） ── */
    .tabs-bar {
        display: flex;
        align-items: center;
        height: 36px;
        background: var(--rtc-color-bg-tertiary);
        border-bottom: 1px solid var(--rtc-color-border);
        overflow-x: auto;
        overflow-y: hidden;
    }

    /* 隐藏滚动条但保持可滚动 */
    .tabs-bar::-webkit-scrollbar {
        display: none;
    }

    .tabs-bar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
`;
