/**
 * Shared timeline layout styles.
 *
 * Used by both <rtc-message> and <rtc-toolcall-card> to render
 * the vertical timeline with dot + connecting line.
 *
 * Layout model:
 *   .timeline-item (position: relative, padding-left reserves space for dot + vertical line)
 *     ├── ::before               (vertical line, absolutely positioned)
 *     ├── .timeline-dot          (dot, absolutely positioned)
 *     └── .timeline-content      (content area)
 *
 * Alignment principle:
 *   - vertical line center X = 15px (left: 14px + half of width 2px)
 *   - dot center X    = 15px (left: 15px + translateX(-50%))
 *   - dot center Y    ≈ first line text line-height midpoint Y (top: 9px)
 */
import {css} from 'lit';

export const timelineStyles = css`
  /* ── Timeline item ────────────────────────────────────────────── */
  .timeline-item {
    position: relative;
    margin-bottom: var(--rtc-message-gap, var(--rtc-spacing-md));
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-lg) var(--rtc-spacing-xs) var(--rtc-spacing-xl);
  }

  .timeline-item:last-child {
    margin-bottom: 0;
  }

  /* ── Timeline vertical line (continuous) ────────────────────────────────────────── */
  .timeline-item::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--rtc-color-border);
  }

  /* ── Timeline dot ────────────────────────────────────────────── */
  .timeline-dot {
    position: absolute;
    left: 15px;
    top: 9px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--rtc-color-text);
    transform: translateX(-50%) scale(1);
    cursor: pointer;
    z-index: var(--rtc-z-local-1);
    transition: transform var(--rtc-transition-duration-slow) cubic-bezier(0.4, 0, 0.2, 1),
                background var(--rtc-transition-duration-slow) cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow var(--rtc-transition-duration-slow) cubic-bezier(0.4, 0, 0.2, 1);
  }

  .timeline-dot:hover {
    transform: translateX(-50%) scale(2);
    box-shadow: 0 0 0 4px var(--rtc-color-border);
  }

  /* ── Timeline dot tooltip ────────────────────────────────────── */
  .timeline-dot::after {
    content: attr(data-timestamp);
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    padding: 1px 3px;
    background: var(--rtc-color-text);
    color: var(--rtc-color-bg);
    font-size: 10px;
    line-height: 1.1;
    border-radius: 2px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--rtc-transition-duration) var(--rtc-transition-timing),
                visibility var(--rtc-transition-duration) var(--rtc-transition-timing);
    z-index: var(--rtc-z-local-3);
    transform: scale(0.5);
    transform-origin: left bottom;
  }

  .timeline-dot:hover::after {
    opacity: 1;
    visibility: visible;
  }

  /* ── Dot pulse animation ────────────────────────────────────────── */
  @keyframes rtc-dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .timeline-item.streaming .timeline-dot {
    background: var(--rtc-color-text-tertiary);
    animation: rtc-dot-pulse 1.5s ease-in-out infinite;
  }

  .timeline-item.success .timeline-dot {
    background: var(--rtc-color-success);
  }

  /* ── Timeline content ─────────────────────────────────────── */
  .timeline-content {
    font-size: var(--rtc-font-size-base);
    line-height: var(--rtc-line-height-loose);
    color: var(--rtc-color-text);
  }
`;
