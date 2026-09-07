import {css} from 'lit';

/**
 * Editor Toolbar 样式
 *
 * VS Code 风格编辑器工具栏。
 * 颜色使用项目 Tokens，确保双主题适配。
 */
export const styles = css`
    :host {
        display: block;
        height: 36px;
        background: var(--rtc-color-bg-secondary, #252526);
        border-bottom: 1px solid var(--rtc-color-border, #3c3c3c);
    }

    .toolbar {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 var(--rtc-spacing-md, 12px);
        gap: var(--rtc-spacing-xs, 4px);
    }

    /* ── 工具栏按钮 ── */

    .toolbar-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 28px;
        padding: 0 var(--rtc-spacing-xs, 4px);
        gap: var(--rtc-spacing-xxs, 2px);
        background: transparent;
        border: none;
        border-radius: var(--rtc-border-radius-sm, 4px);
        color: var(--rtc-color-text, #cccccc);
        font-size: var(--rtc-font-size-xs, 12px);
        font-family: inherit;
        cursor: pointer;
        white-space: nowrap;
        user-select: none;
        transition: background-color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
    }

    .toolbar-btn svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
        flex-shrink: 0;
    }

    .toolbar-btn:hover:not(:disabled) {
        background: var(--rtc-color-bg-hover, #2a2d2e);
    }

    .toolbar-btn:active:not(:disabled) {
        background: var(--rtc-color-bg-active, #37373d);
    }

    .toolbar-btn:disabled {
        opacity: 0.4;
        cursor: default;
    }

    /* 主按钮（保存） */
    .toolbar-btn.primary {
        background: var(--rtc-color-primary, #007acc);
        color: var(--rtc-color-on-primary, #ffffff);
        padding: 0 var(--rtc-spacing-sm, 8px);
        gap: var(--rtc-spacing-xs, 4px);
    }

    .toolbar-btn.primary:hover:not(:disabled) {
        background: var(--rtc-color-primary-hover, #1e8adc);
    }

    .toolbar-btn.primary:active:not(:disabled) {
        background: var(--rtc-color-primary-hover, #1e8adc);
        filter: brightness(0.9);
    }

    .toolbar-btn.primary:disabled {
        opacity: 0.5;
    }

    /* ── 分隔符 ── */

    .separator {
        width: 1px;
        height: 20px;
        background: var(--rtc-color-border, #3c3c3c);
        margin: 0 var(--rtc-spacing-xs, 4px);
        flex-shrink: 0;
    }

    /* ── 弹性空间（推开右侧视图切换） ── */

    .spacer {
        flex: 1;
    }

    /* ── 视图切换组 ── */

    .view-toggle {
        display: inline-flex;
        background: var(--rtc-color-bg, #1e1e1e);
        border-radius: var(--rtc-border-radius-sm, 4px);
        overflow: hidden;
    }

    .view-toggle-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 44px;
        height: 24px;
        padding: 0 var(--rtc-spacing-sm, 8px);
        background: transparent;
        border: none;
        color: var(--rtc-color-text-secondary, #858585);
        font-size: var(--rtc-font-size-xs, 12px);
        font-family: inherit;
        cursor: pointer;
        user-select: none;
        transition: background-color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease),
                    color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
    }

    .view-toggle-btn svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
    }

    .view-toggle-btn:hover {
        background: var(--rtc-color-bg-hover, #2a2d2e);
        color: var(--rtc-color-text, #cccccc);
    }

    .view-toggle-btn.active {
        background: var(--rtc-color-primary, #007acc);
        color: var(--rtc-color-on-primary, #ffffff);
    }

    /* ── 暗色主题 ── */

    :host([theme='dark']) {
        background: var(--rtc-color-bg-secondary, #252526);
        border-bottom-color: var(--rtc-color-border, #3c3c3c);
    }

    :host([theme='dark']) .toolbar-btn {
        color: var(--rtc-color-text, #cccccc);
    }

    :host([theme='dark']) .toolbar-btn:hover:not(:disabled) {
        background: var(--rtc-color-bg-hover, #2a2d2e);
    }

    :host([theme='dark']) .separator {
        background: var(--rtc-color-border, #3c3c3c);
    }

    :host([theme='dark']) .view-toggle {
        background: var(--rtc-color-bg, #1e1e1e);
    }

    :host([theme='dark']) .view-toggle-btn {
        color: var(--rtc-color-text-secondary, #858585);
    }

    :host([theme='dark']) .view-toggle-btn:hover {
        background: var(--rtc-color-bg-hover, #2a2d2e);
        color: var(--rtc-color-text, #cccccc);
    }

    /* ── 亮色主题 ── */

    :host([theme='light']) {
        background: var(--rtc-color-bg-secondary, #f5f5f5);
        border-bottom-color: var(--rtc-color-border, #e0e0e0);
    }

    :host([theme='light']) .toolbar-btn {
        color: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .toolbar-btn:hover:not(:disabled) {
        background: var(--rtc-color-bg-hover, #e8e8e8);
    }

    :host([theme='light']) .toolbar-btn:active:not(:disabled) {
        background: var(--rtc-color-bg-active, #d4d4d4);
    }

    :host([theme='light']) .separator {
        background: var(--rtc-color-border, #e0e0e0);
    }

    :host([theme='light']) .view-toggle {
        background: var(--rtc-color-bg, #ffffff);
    }

    :host([theme='light']) .view-toggle-btn {
        color: var(--rtc-color-text-secondary, #666666);
    }

    :host([theme='light']) .view-toggle-btn:hover {
        background: var(--rtc-color-bg-hover, #e8e8e8);
        color: var(--rtc-color-text, #333333);
    }

    :host([theme='light']) .view-toggle-btn.active {
        background: var(--rtc-color-primary, #007acc);
        color: var(--rtc-color-on-primary, #ffffff);
    }
`;
