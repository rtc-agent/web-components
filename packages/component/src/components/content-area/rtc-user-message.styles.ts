import {css} from 'lit';

/**
 * Styles for <rtc-user-message>
 *
 * Layout model:
 *   .user-message-wrapper — sticky container, full-width
 *     └── .user-message   — bubble with max-height, overflow hidden
 *           └── .user-message-text — text content
 *
 * The ::after pseudo-element creates a gradient fade mask when text overflows
 * and the bubble is not expanded. It only appears when [data-overflow] is set
 * and [data-expanded] is absent.
 *
 * Sync-status visual states:
 *   - pending : glow animation + primary border
 *   - synced  : static default border
 *   - failed  : static error border
 *
 * Action buttons (show-more, more) are hidden by default and
 * fade in on wrapper hover.
 */
export const styles = css`
  :host {
    display: block;
    margin: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    box-sizing: border-box;
  }

  /* ── Wrapper ── */
  .user-message-wrapper {
    position: sticky;
    top: 0;
    z-index: var(--rtc-z-local-1);
    width: 100%;
  }

  /* ── Bubble ── */
  .user-message {
    max-height: var(--rtc-user-message-max-height, 120px);
    overflow: hidden;
    background: var(--rtc-user-message-bg, var(--rtc-color-bg));
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius);
    padding: var(--rtc-spacing-sm) var(--rtc-spacing-md);
    color: var(--rtc-color-text);
    position: relative;
    box-sizing: border-box;
    box-shadow: var(--rtc-shadow-md, 0 2px 8px rgba(0, 0, 0, 0.12));
    transition: border-color var(--rtc-transition-duration) var(--rtc-transition-timing),
                box-shadow var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  /* ── Expanded state ── */
  :host([data-expanded]) .user-message {
    max-height: none;
  }

  /* ── Gradient fade mask ──
   * Only visible when overflowing AND not expanded.
   * Uses --rtc-user-message-bg (bubble background) so the fade blends with
   * the bubble as it scrolls under the sticky container. */
  .user-message::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 40px;
    background: linear-gradient(
      transparent,
      var(--rtc-user-message-bg, var(--rtc-color-bg))
    );
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  :host([data-overflow]:not([data-expanded])) .user-message::after {
    opacity: 1;
  }

  /* ── Text ── */
  .user-message-text {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--rtc-font-family-base);
    font-size: var(--rtc-font-size-base);
    line-height: var(--rtc-line-height-base);
    margin: 0;
  }

  /* ── Pending glow animation ── */
  @keyframes rtc-user-message-glow {
    0%, 100% {
      box-shadow: 0 0 8px var(--rtc-user-message-glow-color, var(--rtc-color-primary, #0066ff));
    }
    50% {
      box-shadow: 0 0 0 transparent;
    }
  }

  :host([data-sync-status="pending"]) .user-message {
    animation: rtc-user-message-glow 1.5s ease-in-out infinite;
    border-color: var(--rtc-user-message-glow-color, var(--rtc-color-primary, #0066ff));
  }

  /* ── Failed border ── */
  :host([data-sync-status="failed"]) .user-message {
    border-color: var(--rtc-user-message-error-color, var(--rtc-color-error, #dc2626));
  }

  /* ── Action buttons (shared) ── */
  .show-more-btn,
  .more-btn {
    opacity: 0;
    transition: opacity var(--rtc-transition-duration) var(--rtc-transition-timing);
    position: absolute;
    background: var(--rtc-user-message-bg, var(--rtc-color-bg));
    border: var(--rtc-border-width) solid var(--rtc-color-border);
    border-radius: var(--rtc-border-radius-sm);
    cursor: pointer;
    font-size: var(--rtc-font-size-xs);
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
    color: var(--rtc-color-text);
    line-height: var(--rtc-line-height-tight);
    z-index: var(--rtc-z-local-2);
  }

  .show-more-btn:hover,
  .more-btn:hover {
    background: var(--rtc-color-bg-hover);
    color: var(--rtc-color-text);
  }

  /* Reveal on hover — use :host(:hover) so the selector is scoped to the
   * shadow root and doesn't depend on an internal class name. */
  :host(:hover) .show-more-btn,
  :host(:hover) .more-btn {
    opacity: 1;
  }

  /* ── Show-more: bottom-right ── */
  .show-more-btn {
    bottom: 1px;
    right: 1px;
  }

  /* ── More button: top-right ── */
  .more-btn {
    top: 1px;
    right: 1px;
  }
`;
