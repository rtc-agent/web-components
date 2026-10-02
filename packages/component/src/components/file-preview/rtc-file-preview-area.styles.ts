/**
 * RTC File Preview Area Styles
 *
 * Compact horizontal strip for file attachments.
 * Collapses to zero height when no files present.
 * Uses design tokens for theme consistency.
 *
 * @module components/file-preview/rtc-file-preview-area.styles
 */
import {css} from 'lit';

export const styles = css`
  :host {
    display: none;
    margin-bottom: var(--rtc-spacing-xs, 4px);
  }

  :host([hidden]) {
    display: none;
  }

  /* Show when has files */
  :host(:not([data-empty='true'])) {
    display: block;
  }

  .file-preview-area {
    display: flex;
    flex-wrap: nowrap;
    gap: var(--rtc-spacing-xs, 4px);
    overflow-x: auto;
    overflow-y: hidden;
    padding: var(--rtc-spacing-xs, 4px);
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--rtc-color-border, #e0e0e0) transparent;
  }

  /* Custom scrollbar - minimal height */
  .file-preview-area::-webkit-scrollbar {
    height: 3px;
  }

  .file-preview-area::-webkit-scrollbar-track {
    background: transparent;
  }

  .file-preview-area::-webkit-scrollbar-thumb {
    background: var(--rtc-color-border, #e0e0e0);
    border-radius: 1.5px;
  }

  .file-preview-area::-webkit-scrollbar-thumb:hover {
    background: var(--rtc-color-border-hover, #d0d0d0);
  }

  /* Empty state - hidden */
  .empty-state {
    display: none;
  }

  :host([data-empty='true']) .file-preview-area {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      transition: none;
    }
    .file-preview-area {
      scroll-behavior: auto;
    }
  }
`;
