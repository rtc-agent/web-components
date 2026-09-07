import {css} from 'lit';

/**
 * Editor Area 样式
 *
 * VS Code 风格编辑器区域容器。
 * 颜色使用项目 Tokens，确保双主题适配。
 */
export const styles = css`
    :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        min-height: 0;
        background: var(--rtc-color-bg, #1e1e1e);
        color: var(--rtc-color-text, #cccccc);
    }

    /* ── Tabs 区域 ── */
    .tabs-bar {
        display: flex;
        align-items: center;
        height: 36px;
        background: var(--rtc-color-bg-tertiary, #2d2d30);
        border-bottom: 1px solid var(--rtc-color-border, #3c3c3c);
        overflow-x: auto;
        overflow-y: hidden;
        flex-shrink: 0;
    }

    /* 隐藏滚动条但保持可滚动 */
    .tabs-bar::-webkit-scrollbar {
        display: none;
    }

    .tabs-bar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }

    /* ── Toolbar 区域 ── */
    .toolbar-area {
        flex-shrink: 0;
    }

    /* ── Editor Content 区域 ── */
    .editor-content {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    /* ── Welcome Screen（无文件打开时） ── */
    .welcome-screen {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--rtc-color-text-tertiary, #666666);
        gap: var(--rtc-spacing-md, 12px);
    }

    .welcome-icon {
        width: 64px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.3;
    }

    .welcome-icon svg {
        width: 64px;
        height: 64px;
        fill: currentColor;
    }

    .welcome-title {
        font-size: var(--rtc-font-size-lg, 16px);
        color: var(--rtc-color-text-secondary, #858585);
    }

    .welcome-hint {
        font-size: var(--rtc-font-size-sm, 13px);
    }

    /* ── 亮色主题适配 ── */
    :host([theme='light']) {
        background: var(--rtc-color-bg, #ffffff);
        color: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .tabs-bar {
        background: var(--rtc-color-bg-tertiary, #e8e8e8);
        border-bottom-color: var(--rtc-color-border, #e0e0e0);
    }

    :host([theme='light']) .welcome-screen {
        color: var(--rtc-color-text-tertiary, #999999);
    }

    :host([theme='light']) .welcome-title {
        color: var(--rtc-color-text-secondary, #666666);
    }
`;
