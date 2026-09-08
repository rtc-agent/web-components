import {css} from 'lit';

/**
 * Status Bar 样式
 *
 * VS Code 风格底部状态栏。
 * 颜色使用项目 Tokens，确保双主题适配。
 *
 * VS Code 中 Status Bar 双主题同色（蓝底白字），
 * 这里使用 --rtc-color-accent 作为背景色。
 */
export const styles = css`
    :host {
        display: flex;
        align-items: center;
        height: 22px;
        padding: 0 var(--rtc-spacing-md, 12px);
        gap: var(--rtc-spacing-md, 12px);
        background: var(--rtc-color-accent, #2741fe);
        color: var(--rtc-color-on-primary, #ffffff);
        font-size: var(--rtc-font-size-sm, 13px);
        line-height: 1;
        flex-shrink: 0;
        overflow: hidden;
        user-select: none;
    }

    .status-item {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs, 4px);
        white-space: nowrap;
    }

    .status-item-icon {
        width: 12px;
        height: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .status-item-icon svg {
        width: 12px;
        height: 12px;
        fill: currentColor;
    }

    .status-spacer {
        flex: 1;
    }

    /* ── 空状态（无文件打开时） ── */
    .status-empty {
        color: var(--rtc-color-on-primary, #ffffff);
        opacity: 0.7;
    }

    /* ── 保存状态指示 ── */
    .status-save-unsaved {
        font-style: italic;
    }
`;
