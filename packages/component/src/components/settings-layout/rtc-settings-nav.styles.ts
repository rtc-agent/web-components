import {css} from 'lit';

/**
 * Settings Nav 样式
 *
 * 左栏分类导航，使用项目 design tokens 支持多主题。
 */
export const styles = css`
    :host {
        width: 200px;
        background: var(--rtc-color-bg-secondary, #252526);
        border-right: 1px solid var(--rtc-color-border, #3c3c3c);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
        flex-shrink: 0;
        padding: var(--rtc-spacing-sm, 8px) 0;
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: var(--rtc-spacing-sm, 8px);
        padding: var(--rtc-spacing-sm, 8px) var(--rtc-spacing-md, 16px);
        cursor: pointer;
        color: var(--rtc-color-text-secondary, #858585);
        font-size: var(--rtc-font-size-sm, 13px);
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        transition:
            background-color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease),
            color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
        position: relative;
    }

    .nav-item:hover {
        color: var(--rtc-color-text, #cccccc);
        background: var(--rtc-color-bg-hover, #2a2d2e);
    }

    .nav-item:focus-visible {
        outline: 2px solid var(--rtc-color-border-focus, #2741fe);
        outline-offset: -2px;
    }

    .nav-item[aria-selected='true'] {
        color: var(--rtc-color-text, #cccccc);
        background: var(--rtc-color-bg-active, #37373d);
    }

    .nav-item[aria-selected='true']::before {
        content: '';
        position: absolute;
        left: 0;
        top: 4px;
        bottom: 4px;
        width: 2px;
        background: var(--rtc-color-primary, #2741fe);
        border-radius: 0 2px 2px 0;
    }

    .nav-icon {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .nav-icon svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
    }

    .nav-label {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
`;
