import {css} from 'lit';

/**
 * Session Tree 容器样式
 *
 * 参考 rtc-file-explorer.styles.ts：
 * - Header（36px）+ Content（flex: 1, overflow-y: auto）
 * - 颜色使用项目 Tokens，确保双主题适配
 * - 滚动条样式与 file-explorer 一致
 */
export const styles = css`
    :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--rtc-color-bg-secondary);
        border-right: 1px solid var(--rtc-color-border);
        flex-shrink: 0;
        overflow: hidden;
    }

    /* ── Header ── */

    .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--rtc-spacing-sm);
        height: 36px;
        flex-shrink: 0;
        background: var(--rtc-color-bg-tertiary);
        border-bottom: 1px solid var(--rtc-color-border);
    }

    .sidebar-title {
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-medium);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--rtc-color-text-secondary);
        user-select: none;
    }

    .sidebar-actions {
        display: flex;
        gap: var(--rtc-spacing-xs);
    }

    .action-btn {
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        color: var(--rtc-color-text-secondary);
        cursor: pointer;
        border-radius: var(--rtc-border-radius-sm);
        padding: 0;
        transition: background-color var(--rtc-transition-duration) var(--rtc-transition-timing),
                    color var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .action-btn:hover {
        background: var(--rtc-color-bg-hover);
        color: var(--rtc-color-text);
    }

    .action-btn:focus-visible {
        outline: 2px solid var(--rtc-color-border-focus);
        outline-offset: -2px;
    }

    .action-btn svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
    }

    /* ── Content ── */

    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: var(--rtc-spacing-xs) 0;
    }

    /* ── Empty State ── */

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--rtc-spacing-xl) var(--rtc-spacing-md);
        color: var(--rtc-color-text-tertiary);
        text-align: center;
        gap: var(--rtc-spacing-sm);
        user-select: none;
    }

    .empty-state-icon svg {
        width: 32px;
        height: 32px;
        fill: currentColor;
        opacity: 0.4;
    }

    .empty-state-text {
        font-size: var(--rtc-font-size-xs);
        line-height: var(--rtc-line-height-base);
    }

    /* ── Scrollbar ── */

    .sidebar-content::-webkit-scrollbar {
        width: 8px;
    }

    .sidebar-content::-webkit-scrollbar-track {
        background: transparent;
    }

    .sidebar-content::-webkit-scrollbar-thumb {
        background: var(--rtc-color-border);
        border-radius: var(--rtc-border-radius-sm);
    }

    .sidebar-content::-webkit-scrollbar-thumb:hover {
        background: var(--rtc-color-text-tertiary);
    }
`;
