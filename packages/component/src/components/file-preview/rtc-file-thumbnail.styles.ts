/**
 * RTC File Thumbnail Styles
 *
 * Ultra-compact horizontal file chip: [thumb] filename [x]
 * 24px square thumbnail, filename beside it, hover-reveal delete button.
 * Uses design tokens for theme consistency.
 *
 * @module components/file-preview/rtc-file-thumbnail.styles
 */
import {css} from 'lit';

export const styles = css`
  :host {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 4px 8px 4px 4px;
    background: var(--rtc-color-bg-tertiary, #e8e8e8);
    border-radius: var(--rtc-border-radius-sm, 4px);
    cursor: pointer;
    flex-shrink: 0;
    gap: 6px;
    transition: background var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
  }

  :host(:hover) {
    background: var(--rtc-color-bg-hover, #eeeeee);
  }

  .thumbnail {
    display: flex;
    align-items: center;
    gap: 6px;
    outline: none;
    position: relative;
  }

  .thumb-img {
    width: 24px;
    height: 24px;
    object-fit: cover;
    display: block;
    border-radius: 2px;
  }

  .thumb-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    background: var(--rtc-color-bg-secondary, #f5f5f5);
    border-radius: 2px;
  }

  .filename {
    font-size: var(--rtc-font-size-xs, 12px);
    color: var(--rtc-color-text, #1a1a2e);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
    line-height: 1;
  }

  .remove-btn {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: transparent;
    color: var(--rtc-color-text-tertiary, #8888a0);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    padding: 0;
    line-height: 1;
    flex-shrink: 0;
    opacity: 0;
    transition: all var(--rtc-transition-duration, 0.15s) var(--rtc-transition-timing, ease);
  }

  :host(:hover) .remove-btn {
    opacity: 1;
  }

  .remove-btn:hover {
    background: var(--rtc-color-error, #f44336);
    color: var(--rtc-color-text-inverse, #ffffff);
  }

  /* Error state */
  .thumb-error {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--rtc-color-error, #f44336);
    border-radius: 2px;
    position: relative;
    cursor: pointer;
  }

  .error-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .error-icon svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
  }

  .retry-btn {
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    padding: 0;
    margin: 0;
    align-items: center;
    justify-content: center;
  }

  .retry-btn svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }

  .thumb-error:hover .retry-btn {
    display: flex;
  }

  .thumb-error:hover .error-icon {
    display: none;
  }

  /* Loading skeleton */
  .thumb-skeleton {
    width: 24px;
    height: 24px;
    background: linear-gradient(
      90deg,
      var(--rtc-color-bg-tertiary, #e8e8e8) 25%,
      var(--rtc-color-bg-hover, #eeeeee) 50%,
      var(--rtc-color-bg-tertiary, #e8e8e8) 75%
    );
    background-size: 200% 100%;
    animation: skeleton-loading 1.5s infinite;
    border-radius: 2px;
  }

  @keyframes skeleton-loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Progress overlay - clock-style circular progress */
  .progress-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 2px;
    pointer-events: none;
  }

  .progress-ring {
    position: absolute;
    width: 20px;
    height: 20px;
  }

  .progress-ring-circle {
    fill: none;
    stroke: var(--rtc-color-primary, #2741fe);
    stroke-width: 2;
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
    transition: stroke-dashoffset 0.3s ease;
  }

  .progress-text {
    font-size: 9px;
    color: var(--rtc-color-text-inverse, #ffffff);
    font-weight: 600;
    z-index: 1;
  }

  /* Sync badge */
  .sync-badge {
    font-size: 10px;
    line-height: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      transition: none;
    }
    .thumb-skeleton {
      animation: none;
    }
  }
`;
