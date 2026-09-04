/**
 * Shared timeline layout styles.
 *
 * Used by both <rtc-message> and <rtc-toolcall-card> to render
 * the vertical timeline with dot + connecting line.
 *
 * Layout model:
 *   .timeline-item (position: relative, padding-left 给 dot + 竖线留位)
 *     ├── ::before               (竖线, 绝对定位)
 *     ├── .timeline-dot          (圆点, 绝对定位)
 *     └── .timeline-content      (内容区)
 *
 * 对齐原理：
 *   - 竖线 center X = 15px（left: 14px + width 2px 的一半）
 *   - dot center X    = 15px（left: 15px + translateX(-50%)）
 *   - dot center Y    ≈ 首行文本行高中点 Y（top: 9px）
 */
import {css} from 'lit';

export const timelineStyles = css`
  /* ── 时间线 item ────────────────────────────────────────────── */
  .timeline-item {
    position: relative;
    margin-bottom: var(--rtc-spacing-md);
    padding: var(--rtc-spacing-xs) var(--rtc-spacing-lg) var(--rtc-spacing-xs) var(--rtc-spacing-xl);
  }

  .timeline-item:last-child {
    margin-bottom: 0;
  }

  /* ── 时间竖线（连续）────────────────────────────────────────── */
  .timeline-item::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--rtc-color-border);
  }

  /* ── 时间线圆点 ────────────────────────────────────────────── */
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
    z-index: 1;
    transition: transform var(--rtc-transition-duration-slow) cubic-bezier(0.4, 0, 0.2, 1),
                background var(--rtc-transition-duration-slow) cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow var(--rtc-transition-duration-slow) cubic-bezier(0.4, 0, 0.2, 1);
  }

  .timeline-dot:hover {
    transform: translateX(-50%) scale(2);
    background: var(--rtc-color-bg-hover);
    box-shadow: var(--rtc-shadow-sm);
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
    z-index: 10;
    transform: scale(0.5);
    transform-origin: left bottom;
  }

  .timeline-dot:hover::after {
    opacity: 1;
    visibility: visible;
  }

  /* ── Dot 脉冲动画 ────────────────────────────────────────── */
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
