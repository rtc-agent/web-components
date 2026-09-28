import {css} from 'lit';

/**
 * Drawer styles
 *
 * Left slide-out drawer panel:
 * - Fixed to the right of Activity Bar, overlay above main content
 * - Smooth slide in/out via transform + transition
 * - Semi-transparent backdrop overlay, click to close
 * - Width configurable via --rtc-drawer-width CSS custom property
 *
 * @cssprop [--rtc-drawer-width=240px] - Drawer width
 * @csspart backdrop - Backdrop overlay
 * @csspart panel - Drawer panel
 */
export const styles = css`
    :host {
        /* Drawer panel positioning base: left offset controlled via --rtc-drawer-left */
        position: absolute;
        top: 0;
        left: var(--rtc-drawer-left, 0px);
        right: 0;
        height: 100%;
        z-index: var(--rtc-z-drawer, 20);
        pointer-events: none;
    }

    :host([open]) {
        pointer-events: auto;
    }

    /* ── Backdrop overlay ── */
    .backdrop {
        position: absolute;
        inset: 0;
        background: var(--rtc-drawer-backdrop-bg, rgba(0, 0, 0, 0.3));
        opacity: 0;
        transition: opacity var(--rtc-drawer-transition-duration, 0.25s) var(--rtc-transition-timing, ease);
        pointer-events: none;
    }

    :host([open]) .backdrop {
        opacity: 1;
        pointer-events: auto;
    }

    /* ── Panel drawer panel ── */
    .panel {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: var(--rtc-drawer-width, 240px);
        background: var(--rtc-color-bg-secondary, #252526);
        border-right: var(--rtc-border-width, 1px) solid var(--rtc-color-border, #3c3c3c);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: translateX(-100%);
        transition: transform var(--rtc-drawer-transition-duration, 0.25s) var(--rtc-transition-timing, ease);
        box-shadow: var(--rtc-drawer-shadow, 2px 0 8px rgba(0, 0, 0, 0.15));
    }

    :host([open]) .panel {
        transform: translateX(0);
    }

    /* ── Content slot area ── */
    ::slotted(*) {
        flex: 1;
        overflow: hidden;
    }

    /* ── Respect user animation preferences ── */
    @media (prefers-reduced-motion: reduce) {
        .backdrop,
        .panel {
            transition-duration: 0.01ms !important;
        }
    }
`;
