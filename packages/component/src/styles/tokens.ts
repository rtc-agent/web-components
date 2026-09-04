import {css} from 'lit';

/**
 * Design Tokens — CSS Custom Properties for the RTC Agent component library.
 *
 * IMPORTANT: This file defines ONLY structural tokens (spacing, typography,
 * borders, shadows, transitions, z-index, window dimensions). Color tokens
 * are defined exclusively in theme files (themes/light.ts, themes/dark.ts)
 * to ensure a single source of truth for colors.
 *
 * Variable taxonomy:
 * - --rtc-spacing-*      : spacing scale (xs:4 sm:8 md:16 lg:24 xl:32 2xl:48)
 * - --rtc-font-*         : font family, size, weight, line-height
 * - --rtc-border-*       : border width, radius
 * - --rtc-shadow-*       : box shadows (sm, md, lg, xl)
 * - --rtc-transition-*   : animation duration, timing
 * - --rtc-z-*            : z-index layers (content:1, overlay:500, title-bar:1000)
 * - --rtc-window-*       : floating window dimensions
 *
 * Colors: See themes/light.ts and themes/dark.ts for --rtc-color-* definitions.
 */
export const tokens = css`
  :host {
    /* ── Spacing ── */
    --rtc-spacing-xs: 4px;
    --rtc-spacing-sm: 8px;
    --rtc-spacing-md: 16px;
    --rtc-spacing-lg: 24px;
    --rtc-spacing-xl: 32px;
    --rtc-spacing-2xl: 48px;

    /* ── Typography ── */
    --rtc-font-family-base: -apple-system, BlinkMacSystemFont, 'Segoe UI',
      Roboto, Oxygen, Ubuntu, sans-serif;
    --rtc-font-family-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;

    --rtc-font-size-xs: 12px;
    --rtc-font-size-sm: 13px;
    --rtc-font-size-base: 14px;
    --rtc-font-size-md: 16px;
    --rtc-font-size-lg: 18px;
    --rtc-font-size-xl: 20px;
    --rtc-font-size-2xl: 24px;

    --rtc-font-weight-normal: 400;
    --rtc-font-weight-medium: 500;
    --rtc-font-weight-bold: 600;

    --rtc-line-height-tight: 1.25;
    --rtc-line-height-base: 1.5;
    --rtc-line-height-loose: 1.75;

    /* ── Borders ── */
    --rtc-border-width: 1px;
    --rtc-border-radius-sm: 4px;
    --rtc-border-radius: 6px;
    --rtc-border-radius-lg: 8px;
    --rtc-border-radius-xl: 12px;

    /* ── Shadows ── */
    --rtc-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
    --rtc-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
    --rtc-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
    --rtc-shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.3);

    /* ── Transitions ── */
    --rtc-transition-duration: 0.15s;
    --rtc-transition-duration-slow: 0.3s;
    --rtc-transition-timing: ease;

    /* ── Z-index layers ──
     *
     * Stacking context hierarchy (from bottom to top):
     *
     *   rtc-agent :host (z: 9999)
     *     └── .window-container (no z-index, in host context)
     *           ├── rtc-title-bar (z: 10, position: relative)
     *           │     └── visually at the TOP of the window, flex sibling of content-area
     *           └── .content-area (z: 1, position: relative)
     *                 └── rtc-content-wrapper (z: 1, position: relative)
     *                       ├── rtc-session-header, rtc-content-area, rtc-input-area (default z)
     *                       └── rtc-overlay-manager (z: 500, position: absolute, inset: 0)
     *                             └── .panel-host (z: auto, pointer-events: auto)
     *                                   └── rtc-tool-confirm (z: 501, modal)
     *
     * Key points:
     * - title-bar (z: 10) and content-area (z: 1) are flex siblings; they don't visually overlap
     * - overlay-manager (z: 500) is INSIDE content-area, constrained by its bounds
     * - modal (z: 501) is above overlay (z: 500) for tool confirmation dialogs
     * - All z-index values are relative to their parent stacking context
     */
    --rtc-z-content: 1;
    --rtc-z-title-bar: 10;
    --rtc-z-overlay: 500;
    --rtc-z-modal: 501;
    --rtc-z-toast: 1000;

    /* ── Floating window dimensions ── */
    --rtc-window-default-width: 420px;
    --rtc-window-default-height: 640px;
    --rtc-window-min-width: 350px;
    --rtc-window-min-height: 520px;
    --rtc-window-border-radius: 12px;
  }
`;
