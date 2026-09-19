import {css} from 'lit';

/**
 * Chat Layout 样式
 *
 * 布局：
 * - rtc-drawer overlay 抽屉（会话树，从左侧滑入，不挤压主内容）
 * - 右栏：TabBar + 聊天内容区（flex: 1）
 *
 * 多实例渲染：
 * - .message-lists-container 容纳多个 rtc-message-list（每 tab 一个）
 * - 每个 rtc-message-list 使用 position: absolute 堆叠
 * - 通过 visibility 切换 active tab（非 display 或 hidden attribute）
 * - 非 active tab 的 virtualizer 在后台继续工作
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

    /* ── 多实例消息列表容器 ── */
    .message-lists-container {
        position: relative;
        flex: 1;
        overflow: hidden;
        min-height: 0;
    }

    .message-lists-container rtc-message-list {
        position: absolute;
        inset: 0;
        /* visibility is set inline per-instance */
    }
`;
