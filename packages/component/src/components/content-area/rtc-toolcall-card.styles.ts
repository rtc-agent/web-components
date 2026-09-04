/**
 * Styles for <rtc-toolcall-card>
 *
 * Shared timeline layout (dot + vertical line) lives in timeline.styles.ts
 * and is composed via `static styles = [timelineStyles, styles]`.
 *
 * This file contains only toolcall-card-specific styles:
 *   - Card container (bordered, secondary background)
 *   - Header (tool name)
 *   - IN section (single-line, ellipsis)
 *   - OUT section (scrollable, mono font)
 *   - Copy button (hover reveal)
 *   - Dot color states (running=orange, done=green)
 */
import {css} from 'lit';
import {timelineStyles} from './timeline.styles.js';

export const styles = [
  timelineStyles,
  css`
    /* ─ Card ── */
    .toolcall-card {
      position: relative;
      border: 1px solid var(--rtc-color-border);
      border-radius: var(--rtc-border-radius);
      background: var(--rtc-color-bg-secondary);
      overflow: hidden;
    }

    /* ── Header ── */
    .toolcall-header {
      display: flex;
      align-items: center;
      gap: var(--rtc-spacing-xs);
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      border-bottom: 1px solid var(--rtc-color-border);
      font-size: var(--rtc-font-size-sm);
      font-weight: var(--rtc-font-weight-bold);
      color: var(--rtc-color-text);
    }

    .toolcall-name {
      font-family: var(--rtc-font-family-mono);
      color: var(--rtc-color-primary);
    }

    /* ── Section (IN / OUT) ── */
    .toolcall-section {
      display: flex;
      align-items: flex-start;
      gap: var(--rtc-spacing-xs);
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      font-size: var(--rtc-font-size-sm);
      line-height: var(--rtc-line-height-base);
      position: relative;
    }

    .toolcall-section + .toolcall-section {
      border-top: 1px solid var(--rtc-color-border);
    }

    .toolcall-label {
      flex-shrink: 0;
      width: 2.5em;
      font-weight: var(--rtc-font-weight-bold);
      font-size: var(--rtc-font-size-xs);
      color: var(--rtc-color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding-top: 1px;
      user-select: none;
    }

    .toolcall-section.in .toolcall-label {
      color: var(--rtc-color-text-tertiary);
    }

    .toolcall-section.out .toolcall-label {
      color: var(--rtc-color-text-secondary);
    }

    /* ── IN: formatted JSON, pre-wrap ── */
    .toolcall-section.in .toolcall-value {
      flex: 1;
      font-family: var(--rtc-font-family-mono);
      color: var(--rtc-color-text-secondary);
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
    }

    /* ── OUT: scrollable, mono ─ */
    .toolcall-output-content {
      flex: 1;
      max-height: 60px;
      overflow-y: auto;
      font-family: var(--rtc-font-family-mono);
      font-size: var(--rtc-font-size-xs);
      color: var(--rtc-color-text);
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
    }

    /* ── Copy button (per-section) ── */
    .copy-btn {
      position: absolute;
      top: 1px;
      right: 1px;
      opacity: 0;
      transition: opacity var(--rtc-transition-duration) var(--rtc-transition-timing);
      background: var(--rtc-color-bg);
      border: var(--rtc-border-width) solid var(--rtc-color-border);
      border-radius: var(--rtc-border-radius-sm);
      cursor: pointer;
      font-size: var(--rtc-font-size-xs);
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      color: var(--rtc-color-text);
      line-height: var(--rtc-line-height-tight);
      z-index: 2;
    }

    .copy-btn:hover {
      background: var(--rtc-color-bg-hover);
      color: var(--rtc-color-text);
    }

    /* Reveal on section hover */
    .toolcall-section:hover .copy-btn {
      opacity: 1;
    }

    /* ── Dot state: running (waiting for output) ── */
    :host([data-toolcall-status="running"]) .timeline-dot {
      background: var(--rtc-color-warning);
      animation: rtc-dot-pulse 1.5s ease-in-out infinite;
    }

    /* ── Dot state: done ── */
    :host([data-toolcall-status="done"]) .timeline-dot {
      background: var(--rtc-color-success);
    }

    /* ── Override: toolcall card's timeline-content has no nested div ── */
    /* (Unlike rtc-message which wraps innerHTML in a <div>, the card's content
       is a direct .toolcall-card element, so we don't need the div > * margin
       reset. But we keep it harmless via specificity — the shared timelineStyles
       rule targets .timeline-content > div > *, which won't match here.) */
  `,
];
