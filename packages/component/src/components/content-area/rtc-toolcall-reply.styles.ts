/**
 * Styles for <rtc-toolcall-reply>
 *
 * Renders a toolcall_output as a standalone message with a clickable
 * reference header that links back to the originating toolcall_input.
 *
 * Visual: a compact card with a ↩ header bar + tool-specific content sections.
 * No connecting lines — the reply is a self-contained block.
 */
import {css} from 'lit';
import {timelineStyles} from './timeline.styles.js';

export const styles = [
  timelineStyles,
  css`
    /* ── Reply card ── */
    .reply-card {
      position: relative;
      border: 1px solid var(--rtc-color-border);
      border-radius: var(--rtc-border-radius);
      background: var(--rtc-color-bg-secondary);
      overflow: hidden;
    }

    /* ── Reference header (clickable) ── */
    .reply-header {
      display: flex;
      align-items: center;
      gap: var(--rtc-spacing-xs);
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid var(--rtc-color-border);
      font-size: var(--rtc-font-size-sm);
      font-weight: var(--rtc-font-weight-bold);
      color: var(--rtc-color-text);
      transition: background var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .reply-header:hover {
      background: var(--rtc-color-bg-hover);
    }

    .reply-header:active {
      background: var(--rtc-color-bg-active, var(--rtc-color-bg-hover));
    }

    /* ── Tool name ── */
    .reply-tool-name {
      flex: 1;
      font-family: var(--rtc-font-family-mono);
      color: var(--rtc-color-primary);
      font-weight: var(--rtc-font-weight-bold);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Status dot ── */
    .reply-status-dot {
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    :host([data-status="completed"]) .reply-status-dot {
      background: var(--rtc-color-success);
    }

    :host([data-status="failed"]) .reply-status-dot,
    :host([data-status="error"]) .reply-status-dot,
    :host([data-status="timeout"]) .reply-status-dot,
    :host([data-status="rejected"]) .reply-status-dot {
      background: var(--rtc-color-error);
    }

    /* ── Content sections ── */
    .reply-section {
      border-bottom: 1px solid var(--rtc-color-border);
    }

    .reply-section:last-of-type {
      border-bottom: none;
    }

    .reply-content {
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      font-family: var(--rtc-font-family-mono);
      font-size: var(--rpc-font-size-xs);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: var(--rtc-content-height-md);
      overflow-y: auto;
      margin: 0;
    }

    /* When inside scroll container, let the container manage scroll */
    rtc-scroll-container .reply-content {
      max-height: none;
      overflow: visible;
    }

    /* Compact variant: smaller max-height (for read tool, file content) */
    .reply-card-compact .reply-content {
      max-height: var(--rtc-content-height-sm);
    }

    /* ── Section-specific colors ── */
    .reply-logs {
      color: var(--rtc-color-text);
    }

    .reply-warnings {
      color: var(--rtc-color-warning, #b58900);
    }

    .reply-errors {
      color: var(--rtc-color-error, #dc322f);
    }

    .reply-empty {
      color: var(--rtc-color-text-tertiary);
      font-style: italic;
    }

    /* ── Footer ── */
    .reply-footer {
      display: flex;
      align-items: center;
      gap: var(--rtc-spacing-sm);
      padding: var(--rtc-spacing-xs) var(--rtc-spacing-sm);
      border-top: 1px solid var(--rtc-color-border);
      font-size: var(--rtc-font-size-xs);
      color: var(--rtc-color-text-tertiary);
    }

    .reply-duration {
      font-family: var(--rtc-font-family-mono);
      margin-left: auto;
    }

    .reply-status-failed {
      color: var(--rtc-color-error, #dc322f);
      font-weight: var(--rtc-font-weight-bold);
    }

    /* ── Highlight animation (for jump target) ── */
    :host(.highlight) .reply-card {
      animation: rtc-highlight-fade 2s ease-out;
    }

    @keyframes rtc-highlight-fade {
      0% { box-shadow: 0 0 0 2px var(--rtc-color-warning, gold); }
      100% { box-shadow: none; }
    }
  `,
];
