import {css} from 'lit';

/**
 * Chat Layout styles
 *
 * Layout:
 * - rtc-drawer overlay drawer (session tree, slides in from the left, does not push main content)
 * - Right column: TabBar + chat content area (flex: 1)
 *
 * Colors use project Tokens to ensure dual-theme compatibility.
 */
export const styles = css`
    :host {
        display: flex;
        height: 100%;
        width: 100%;
        min-width: 0;
        overflow: hidden;
        background: var(--rtc-color-bg);
        position: relative;
    }

    /* ── Right column: Tab + chat content ── */
    .main {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
    }

    /* ── Tab bar ── */
    .tab-bar {
        flex-shrink: 0;
        width: 100%;
    }

    /* ── Tab content container ── */
    .tab-content-wrapper {
        flex: 1;
        position: relative;
        overflow: hidden;
    }

    /* ── Each tab's content area (absolutely positioned, overlapping at the same position) ── */
    .tab-content {
        display: flex;
        flex-direction: column;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        overflow: hidden;
    }

    /* ── Inactive tabs: use visibility: hidden to preserve state ── */
    /* visibility: hidden preserves DOM rendering and layout state (scroll position, input content, etc.),
       but is not visible or interactive. Unlike content-visibility: hidden, it does not suspend the rendering pipeline,
       avoiding Markdown async rendering being delayed while hidden, which causes position jumps when switching back. */
    .tab-content:not(.active) {
        visibility: hidden;
        pointer-events: none;
    }

    /* ── Chat content area (kept for backward compatibility) ── */
    .content-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
    }

    /* ── Empty state (no active tab) ── */
    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--rtc-color-text-tertiary);
        gap: var(--rtc-spacing-sm);
        user-select: none;
    }

    .empty-state-icon svg {
        width: 48px;
        height: 48px;
        fill: currentColor;
        opacity: 0.3;
    }

    .empty-state-text {
        font-size: var(--rtc-font-size-sm);
    }

    /* ── No session hint ── */
    .no-session-hint {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: var(--rtc-color-text-secondary);
        font-size: var(--rtc-font-size-md);
        user-select: none;
    }

    /* ── Resize Handle ── */
    .resize-handle {
        height: 8px;
        background: var(--rtc-color-bg-secondary);
        border-top: var(--rtc-border-width) solid var(--rtc-color-border);
        border-bottom: var(--rtc-border-width) solid var(--rtc-color-border);
        cursor: ns-resize;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
        position: relative;
    }

    .resize-handle:hover,
    .resize-handle.dragging {
        background: var(--rtc-color-bg-hover);
    }

    .resize-handle::before {
        content: '';
        width: 40px;
        height: 4px;
        background: var(--rtc-color-border-hover);
        border-radius: var(--rtc-border-radius-sm);
        transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .resize-handle:hover::before,
    .resize-handle.dragging::before {
        background: var(--rtc-color-primary);
    }

    /* ── File Preview Area (above input-area) ── */
    rtc-file-preview-area {
        display: block;
        flex-shrink: 0;
    }
`;
