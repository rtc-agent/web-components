import {css} from 'lit';

/**
 * Settings Panel Styles
 *
 * Side drawer panel for settings UI.
 * Uses design tokens for theme support.
 */
export const styles = css`
    :host {
        position: absolute;
        inset: 0;
        z-index: 10000;
        display: flex;
        justify-content: flex-end;
        pointer-events: none;
    }

    .overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        pointer-events: auto;
        animation: fadeIn 0.2s ease;
    }

    .panel {
        position: relative;
        width: 600px;
        max-width: 90%;
        height: 100%;
        background: var(--rtc-color-bg, #1e1e1e);
        box-shadow: -4px 0 12px rgba(0, 0, 0, 0.3);
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        animation: slideIn 0.2s ease;
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--rtc-spacing-md, 16px);
        border-bottom: 1px solid var(--rtc-color-border, #3c3c3c);
    }

    .panel-header h2 {
        margin: 0;
        font-size: var(--rtc-font-size-lg, 18px);
        font-weight: var(--rtc-font-weight-bold, 600);
        color: var(--rtc-color-text, #cccccc);
    }

    .close-btn {
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--rtc-color-text-secondary, #858585);
        border-radius: var(--rtc-border-radius-sm, 4px);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
    }

    .close-btn:hover {
        background: var(--rtc-color-bg-hover, #2a2d2e);
        color: var(--rtc-color-text, #cccccc);
    }

    .close-btn:focus-visible {
        outline: 2px solid var(--rtc-color-border-focus, #2741fe);
        outline-offset: 2px;
    }

    .panel-content {
        flex: 1;
        overflow: hidden;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @keyframes slideIn {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
    }
`;
