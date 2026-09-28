import {css} from 'lit';

/**
 * Status Bar styles
 *
 * VS Code-style bottom status bar.
 * Colors use project Tokens to ensure dual-theme adaptation.
 *
 * In VS Code the Status Bar has the same color in both themes (blue background, white text),
 * here we use --rtc-color-accent as the background color.
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

    /* ── Empty state (when no file is open) ── */
    .status-empty {
        color: var(--rtc-color-on-primary, #ffffff);
        opacity: 0.7;
    }

    /* ── Save status indicator ── */
    .status-save-unsaved {
        font-style: italic;
    }
`;
