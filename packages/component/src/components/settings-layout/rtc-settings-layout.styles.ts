import {css} from 'lit';

/**
 * Settings Layout 样式
 *
 * 两栏布局：左栏导航 + 右栏设置内容。
 * 使用项目 design tokens 支持多主题。
 */
export const styles = css`
    :host {
        display: flex;
        height: 100%;
        width: 100%;
        overflow: hidden;
        background: var(--rtc-color-bg, #1e1e1e);
        font-family: var(--rtc-font-family-base, sans-serif);
        font-size: var(--rtc-font-size, var(--rtc-font-size-base, 14px));
        color: var(--rtc-color-text, #cccccc);
    }

    .main {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: var(--rtc-spacing-lg, 24px);
        min-width: 0;
    }

    .panel-header {
        font-size: var(--rtc-font-size-lg, 18px);
        font-weight: var(--rtc-font-weight-bold, 600);
        color: var(--rtc-color-text, #cccccc);
        margin-bottom: var(--rtc-spacing-lg, 24px);
        padding-bottom: var(--rtc-spacing-sm, 8px);
        border-bottom: 1px solid var(--rtc-color-border, #3c3c3c);
    }

    /* ── 关于页面 Logo ── */

    .about-brand {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--rtc-spacing-md, 16px);
        margin: var(--rtc-spacing-xl, 32px) 0;
    }

    .about-logo svg {
        width: 72px;
        height: 72px;
    }

    .about-name {
        font-size: var(--rtc-font-size-xl, 20px);
        font-weight: var(--rtc-font-weight-bold, 600);
        color: var(--rtc-color-text, #cccccc);
    }

    /* ── 设置项通用样式 ── */

    .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--rtc-spacing-sm, 8px) 0;
        min-height: 36px;
        gap: var(--rtc-spacing-md, 16px);
    }

    .setting-row + .setting-row {
        border-top: 1px solid var(--rtc-color-border, #3c3c3c);
    }

    .setting-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }

    .setting-label label {
        font-size: var(--rtc-font-size-sm, 13px);
        font-weight: var(--rtc-font-weight-medium, 500);
        color: var(--rtc-color-text, #cccccc);
        cursor: pointer;
    }

    .setting-desc {
        font-size: var(--rtc-font-size-xs, 12px);
        color: var(--rtc-color-text-tertiary, #666666);
    }

    .setting-control {
        flex-shrink: 0;
    }

    /* ── Select 控件 ── */

    select {
        padding: 4px 8px;
        background: var(--rtc-color-bg-tertiary, #2d2d30);
        color: var(--rtc-color-text, #cccccc);
        border: 1px solid var(--rtc-color-border, #3c3c3c);
        border-radius: var(--rtc-border-radius-sm, 4px);
        font-size: var(--rtc-font-size-xs, 12px);
        font-family: inherit;
        cursor: pointer;
        outline: none;
        min-width: 120px;
    }

    select:hover {
        border-color: var(--rtc-color-border-hover, #4c4c4c);
    }

    select:focus-visible {
        border-color: var(--rtc-color-border-focus, #2741fe);
        outline: 1px solid var(--rtc-color-border-focus, #2741fe);
        outline-offset: -1px;
    }

    /* ── Number 控件 ── */

    .number-input {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-xs, 4px);
    }

    input[type='number'] {
        width: 60px;
        padding: 4px 8px;
        background: var(--rtc-color-bg-tertiary, #2d2d30);
        color: var(--rtc-color-text, #cccccc);
        border: 1px solid var(--rtc-color-border, #3c3c3c);
        border-radius: var(--rtc-border-radius-sm, 4px);
        font-size: var(--rtc-font-size-xs, 12px);
        font-family: inherit;
        outline: none;
        text-align: center;
    }

    input[type='number']:hover {
        border-color: var(--rtc-color-border-hover, #4c4c4c);
    }

    input[type='number']:focus-visible {
        border-color: var(--rtc-color-border-focus, #2741fe);
        outline: 1px solid var(--rtc-color-border-focus, #2741fe);
        outline-offset: -1px;
    }

    .number-unit {
        font-size: var(--rtc-font-size-xs, 12px);
        color: var(--rtc-color-text-tertiary, #666666);
    }

    /* ── Toggle 控件 ── */

    .toggle {
        display: inline-block;
        position: relative;
        width: 36px;
        height: 20px;
        cursor: pointer;
        vertical-align: middle;
    }

    .toggle input {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
    }

    .toggle-track {
        position: absolute;
        inset: 0;
        background: var(--rtc-color-bg-tertiary, #2d2d30);
        border: 1px solid var(--rtc-color-border, #3c3c3c);
        border-radius: 10px;
        transition: background-color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
    }

    .toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        background: var(--rtc-color-text-tertiary, #666666);
        border-radius: 50%;
        transition: transform var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
    }

    .toggle input:checked ~ .toggle-track {
        background: var(--rtc-color-primary, #2741fe);
        border-color: var(--rtc-color-primary, #2741fe);
    }

    .toggle input:checked ~ .toggle-thumb {
        transform: translateX(16px);
        background: var(--rtc-color-text-inverse, #ffffff);
    }

    .toggle input:focus-visible ~ .toggle-track {
        outline: 2px solid var(--rtc-color-border-focus, #2741fe);
        outline-offset: 2px;
    }

    /* ── Info 行（只读） ── */

    .info-value {
        font-size: var(--rtc-font-size-xs, 12px);
        color: var(--rtc-color-text-secondary, #858585);
        font-family: var(--rtc-font-family-mono, monospace);
    }

    /* ── 按钮 ── */

    button.danger {
        padding: 6px 12px;
        background: transparent;
        color: var(--rtc-color-error, #f44336);
        border: 1px solid var(--rtc-color-error, #f44336);
        border-radius: var(--rtc-border-radius-sm, 4px);
        font-size: var(--rtc-font-size-xs, 12px);
        cursor: pointer;
        transition: background-color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
    }

    button.danger:hover {
        background: rgba(244, 67, 54, 0.1);
    }

    button.danger:focus-visible {
        outline: 2px solid var(--rtc-color-border-focus, #2741fe);
        outline-offset: 2px;
    }

    /* ── Aria-live region（屏幕阅读器） ── */

    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
`;
