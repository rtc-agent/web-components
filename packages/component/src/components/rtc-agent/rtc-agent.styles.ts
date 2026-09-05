import {css} from 'lit';

/**
 * Root component styles — floating window container.
 *
 * Layout (normal mode):
 * ┌─────────────────────────┐
 * │ rtc-title-bar (z:1000)  │  <- always on top
 * ├─────────────────────────┤
 * │ rtc-content-wrapper     │  <- contains login OR normal UI
 * │  (z:1)                  │
 * └─────────────────────────┘
 *
 * Maximized mode: host fills viewport (inset: 0).
 * Minimized mode: host shrinks to a circular bubble; content hidden.
 */
export const styles = css`
  :host {
    display: block;
    /* Position controlled by JS (left/top) for interact.js compatibility */
    position: fixed;
    width: var(--rtc-window-default-width, 420px);
    height: var(--rtc-window-default-height, 640px);
    min-width: var(--rtc-window-min-width, 350px);
    min-height: var(--rtc-window-min-height, 520px);
    background: var(--rtc-color-bg, #1e1e1e);
    border-radius: var(--rtc-window-border-radius, 12px);
    box-shadow: var(--rtc-shadow-xl, 0 20px 25px -5px rgb(0 0 0 / 0.1));
    overflow: hidden;
    font-family: var(--rtc-font-family-base, sans-serif);
    color: var(--rtc-color-text, #ccc);
    container-type: inline-size;
    z-index: var(--rtc-z-root, 9999);

    /* Window interaction tokens */
    --rtc-window-margin: 20px;

    /* Bubble tokens */
    --rtc-bubble-size: 40px;
    --rtc-bubble-bg: var(--rtc-color-bg-secondary, #252526);
    --rtc-bubble-border: var(--rtc-color-border, #3c3c3c);
    --rtc-bubble-text: var(--rtc-color-text, #ccc);

    transition:
      width var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease),
      height var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease),
      left var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease),
      top var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease),
      border-radius var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease),
      background var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease),
      box-shadow var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease);
  }

  /* Disable transitions during drag/resize for smooth real-time updates */
  :host(.dragging),
  :host(.resizing) {
    transition: none !important;
  }

  /* Drag visual feedback */
  :host(.dragging) {
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  }

  /* Resize visual feedback */
  :host(.resizing) {
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  }

  :host([hidden]) {
    display: none;
  }

  /* ── Maximized ── */
  :host([data-mode='maximized']) {
    inset: 0;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: 0;
    bottom: 0;
    right: 0;
  }

  /* ── Minimized ── */
  :host([data-mode='minimized']) {
    width: var(--rtc-bubble-size);
    height: var(--rtc-bubble-size);
    min-width: 0;
    min-height: 0;
    border-radius: 50%;
    background: var(--rtc-bubble-bg);
    border: 1px solid var(--rtc-bubble-border);
    box-shadow: var(--rtc-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.12));
    cursor: pointer;
    overflow: visible;
  }

  .window-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    position: relative;
  }

  /* Hide window content when minimized */
  :host([data-mode='minimized']) .window-container {
    visibility: hidden;
    pointer-events: none;
  }

  .content-area {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    z-index: var(--rtc-z-content, 1);
  }

  /* ── Bubble ── */
  .bubble {
    display: none;
    position: absolute;
    inset: 0;
    align-items: center;
    justify-content: center;
    color: var(--rtc-bubble-text);
    font-size: var(--rtc-font-size-md, 16px);
    font-weight: var(--rtc-font-weight-bold, 600);
    user-select: none;
    outline: none;
    z-index: var(--rtc-z-content, 1);
  }

  .bubble svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  :host([data-mode='minimized']) .bubble {
    display: flex;
  }

  .bubble:focus-visible {
    outline: 2px solid var(--rtc-color-border-focus, #007acc);
    outline-offset: 2px;
    border-radius: 50%;
  }

  /* ── Screen-reader live region ── */
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
