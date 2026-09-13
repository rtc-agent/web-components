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
    }

    /* ── 聊天内容区 ── */
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
