/**
 * RTC File Preview Modal Styles
 *
 * Full-screen modal overlay for file preview.
 * Uses design tokens for theme consistency.
 * Teleported to shadowRoot level to escape overflow constraints.
 *
 * @module components/file-preview/rtc-file-preview-modal.styles
 */
import {css} from 'lit';

export const styles = css`
  :host {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 10000;
  }

  :host([open]) {
    display: block;
  }

  .modal-backdrop {
    position: absolute;
    inset: 0;
    background: var(--rtc-color-backdrop, rgba(0, 0, 0, 0.3));
    animation: fade-in var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Image mode: darker backdrop, content fills entire space */
  .modal-backdrop.image-mode {
    background: rgba(0, 0, 0, 0.95);
    display: block;
  }

  .modal-content {
    position: relative;
    display: flex;
    flex-direction: column;
    max-width: min(90vw, 1200px);
    max-height: min(90vh, 800px);
    background: var(--rtc-color-bg, #ffffff);
    border-radius: var(--rtc-border-radius-lg, 8px);
    box-shadow: var(--rtc-shadow-xl, 0 20px 60px rgba(0, 0, 0, 0.3));
    overflow: hidden;
    animation: modal-slide-up var(--rtc-transition-duration-slow, 0.3s) var(--rtc-transition-timing, ease);
  }

  /* Image preview mode: full-size dark container */
  .modal-content.image-mode {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    background: #000000;
    border-radius: 0;
    box-shadow: none;
    overflow: hidden;
    animation: none;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--rtc-spacing-md, 16px);
    padding: var(--rtc-spacing-md, 16px) var(--rtc-spacing-lg, 24px);
    background: var(--rtc-color-bg-secondary, #f5f5f5);
    border-bottom: 1px solid var(--rtc-color-border, #e0e0e0);
  }

  /* Image mode header: dark overlay style */
  .modal-content.image-mode .modal-header {
    background: rgba(0, 0, 0, 0.6);
    border-bottom: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
  }

  .modal-content.image-mode .file-name {
    color: #ffffff;
  }

  .modal-content.image-mode .file-size {
    color: rgba(255, 255, 255, 0.7);
  }

  .modal-content.image-mode .close-btn {
    color: rgba(255, 255, 255, 0.8);
  }

  .modal-content.image-mode .close-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #ffffff;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .file-name {
    font-size: var(--rtc-font-size-sm, 13px);
    font-weight: var(--rtc-font-weight-medium, 500);
    color: var(--rtc-color-text, #1a1a2e);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-size {
    font-size: var(--rtc-font-size-xs, 12px);
    color: var(--rtc-color-text-secondary, #666680);
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--rtc-border-radius-sm, 4px);
    background: transparent;
    color: var(--rtc-color-text-secondary, #666680);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
    transition: all var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
  }

  .close-btn:hover {
    background: var(--rtc-color-bg-hover, #eeeeee);
    color: var(--rtc-color-text, #1a1a2e);
  }

  .close-btn:active {
    background: var(--rtc-color-bg-active, #e0e0e0);
  }

  .modal-body {
    flex: 1;
    overflow: auto;
    background: var(--rtc-color-bg, #ffffff);
  }

  /* Image mode body: centered, scrollable, dark background */
  .modal-content.image-mode .modal-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #000000;
    overflow: auto;
    min-height: 0; /* CRITICAL: allow flex item to shrink below content size for scrolling */
  }

  /* Image preview */
  .preview-image {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
  }

  /* Image mode: natural sizing, margin:auto for vertical center+scroll */
  .modal-content.image-mode .preview-image {
    max-width: calc(100% - var(--rtc-spacing-xl, 32px) * 2);
    max-height: none;
    width: auto;
    height: auto;
    margin-top: auto;
    margin-bottom: auto;
    flex-shrink: 0;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  }

  /* Text preview */
  .preview-text {
    margin: 0;
    padding: var(--rtc-spacing-lg, 24px);
    font-family: var(--rtc-font-family-mono, 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace);
    font-size: var(--rtc-font-size-sm, 13px);
    line-height: var(--rtc-line-height-base, 1.5);
    color: var(--rtc-color-text, #1a1a2e);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  /* Loading state */
  .preview-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    color: var(--rtc-color-text-secondary, #666680);
    font-size: var(--rtc-font-size-sm, 13px);
  }

  /* Error state */
  .preview-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--rtc-spacing-md, 16px);
    min-height: 200px;
    padding: var(--rtc-spacing-lg, 24px);
    color: var(--rtc-color-text-secondary, #666680);
  }

  .error-icon {
    font-size: 48px;
    color: var(--rtc-color-error, #f44336);
  }

  .error-message {
    font-size: var(--rtc-font-size-sm, 13px);
    text-align: center;
  }

  .retry-btn {
    padding: var(--rtc-spacing-sm, 8px) var(--rtc-spacing-md, 16px);
    background: var(--rtc-color-primary, #2741fe);
    color: var(--rtc-color-text-inverse, #ffffff);
    border: none;
    border-radius: var(--rtc-border-radius-sm, 4px);
    font-size: var(--rtc-font-size-sm, 13px);
    cursor: pointer;
    transition: background var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
  }

  .retry-btn:hover {
    background: var(--rtc-color-primary-hover, #1e35e0);
  }

  .retry-btn:active {
    background: var(--rtc-color-primary-active, #1629c2);
  }

  /* Truncation notice */
  .truncation-notice {
    padding: var(--rtc-spacing-sm, 8px) var(--rtc-spacing-lg, 24px);
    background: var(--rtc-color-bg-tertiary, #e8e8e8);
    color: var(--rtc-color-text-secondary, #666680);
    font-size: var(--rtc-font-size-xs, 12px);
    text-align: center;
    border-top: 1px solid var(--rtc-color-border, #e0e0e0);
  }

  /* Animations */
  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes modal-slide-up {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-backdrop,
    .modal-content {
      animation: none;
    }
  }

  /* Responsive adjustments */
  @media (max-width: 600px) {
    .modal-content {
      max-width: 100vw;
      max-height: 100vh;
      border-radius: 0;
    }

    .modal-header {
      padding: var(--rtc-spacing-sm, 8px) var(--rtc-spacing-md, 16px);
    }

    .preview-text {
      padding: var(--rtc-spacing-md, 16px);
    }
  }
`;
