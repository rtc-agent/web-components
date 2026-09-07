import {css} from 'lit';

/**
 * Activity Bar 样式
 *
 * 使用项目 design tokens（--rtc-color-*）支持多主题。
 */
export const styles = css`
    :host {
        width: 48px;
        background: var(--rtc-color-bg-tertiary);
        border-right: 1px solid var(--rtc-color-border);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--rtc-space-s, 8px) 0;
        flex-shrink: 0;
    }

    .activity-icon {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border-radius: var(--rtc-border-radius-m, 4px);
        margin: var(--rtc-space-xs, 4px) 0;
        position: relative;
        color: var(--rtc-color-text-tertiary);
        transition: background-color 0.2s ease, color 0.2s ease;
    }

    .activity-icon:hover {
        color: var(--rtc-color-text);
        background: var(--rtc-color-bg-hover);
    }

    .activity-icon:focus-visible {
        outline: 2px solid var(--rtc-color-border-focus);
        outline-offset: -2px;
    }

    .activity-icon.active {
        color: var(--rtc-color-primary);
    }

    .activity-icon.active::before {
        content: '';
        position: absolute;
        left: 0;
        top: 8px;
        bottom: 8px;
        width: 2px;
        background: var(--rtc-color-primary);
        border-radius: 0 2px 2px 0;
    }

    .activity-icon.disabled {
        opacity: 0.35;
        cursor: not-allowed;
        pointer-events: none;
    }

    .activity-spacer {
        flex: 1;
    }

    /* Icon SVG sizing */
    .activity-icon svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
    }
`;
