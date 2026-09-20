import {css} from 'lit';

/**
 * Chat Layout 样式
 *
 * 布局：
 * - rtc-drawer overlay 抽屉（会话树，从左侧滑入，不挤压主内容）
 * - 右栏：TabBar + 聊天内容区（flex: 1）
 *
 * 颜色使用项目 Tokens，确保双主题适配。
 */
export const styles = css`
    :host {
        display: flex;
        height: 100%;
        width: 100%;
        overflow: hidden;
        background: var(--rtc-color-bg);
        position: relative;
    }

    /* ── 右栏：Tab + 聊天内容 ── */
    .main {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
    }

    /* ── Tab 栏 ── */
    .tab-bar {
        flex-shrink: 0;
        width: 100%;
    }

    /* ── Tab 内容容器 ── */
    .tab-content-wrapper {
        flex: 1;
        position: relative;
        overflow: hidden;
    }

    /* ── 每个 Tab 的内容区（绝对定位，重叠在同一位置） ── */
    .tab-content {
        display: flex;
        flex-direction: column;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        overflow: hidden;
    }

    /* ── 非活动 Tab：使用 visibility: hidden 保留状态 ── */
    /* visibility: hidden 保留 DOM 渲染和布局状态（滚动位置、输入内容等），
       但不可见、不可交互。与 content-visibility: hidden 不同，它不会暂停渲染管线，
       避免 Markdown 异步渲染在 hidden 期间被延迟导致切回时位置突变。 */
    .tab-content:not(.active) {
        visibility: hidden;
        pointer-events: none;
    }

    /* ── 聊天内容区（保留作为向后兼容） ── */
    .content-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
    }

    /* ── 空状态（无活动 Tab） ── */
    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--rtc-color-text-tertiary);
        gap: var(--rtc-spacing-sm);
        user-select: none;
    }

    .empty-state-icon svg {
        width: 48px;
        height: 48px;
        fill: currentColor;
        opacity: 0.3;
    }

    .empty-state-text {
        font-size: var(--rtc-font-size-sm);
    }
`;
