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
 * Minimized mode: host shrinks to a rounded-square bubble (23.2% radius); content hidden.
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
    box-shadow: var(--rtc-shadow-drag);
  }

  /* Resize visual feedback */
  :host(.resizing) {
    box-shadow: var(--rtc-shadow-drag);
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
    /* 与 logo 同构的圆角方形：圆角比例 = 290/1250 = 23.2% */
    width: var(--rtc-bubble-size);
    height: var(--rtc-bubble-size);
    min-width: 0;
    min-height: 0;
    border-radius: calc(var(--rtc-bubble-size) * 0.232);
    background: var(--rtc-bubble-bg);
    border: 1px solid var(--rtc-bubble-border);
    box-shadow: var(--rtc-shadow-lg);
    cursor: pointer;
    overflow: hidden;
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

  /* ── VS Code 风格布局（Phase 3） ── */

  /* 主布局：Activity Bar + Sidebar + Content/Editor */
  .main-layout {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  /* 侧边栏容器 */
  .sidebar {
    width: 240px;
    min-width: 180px;
    border-right: 1px solid var(--rtc-color-border-primary, #333);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* 编辑器区域包裹器（editor-area + status-bar） */
  .editor-area-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .editor-area-wrapper[hidden] {
    display: none;
  }

  .content-area[hidden] {
    display: none;
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
    width: 28px;
    height: 28px;
  }

  /* 默认产品 logo 撑满气泡 */
  .bubble-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .bubble-logo svg {
    width: 100%;
    height: 100%;
  }

  :host([data-mode='minimized']) .bubble {
    display: flex;
  }

  .bubble:focus-visible {
    outline: 2px solid var(--rtc-color-border-focus, #2741fe);
    outline-offset: 2px;
    border-radius: calc(var(--rtc-bubble-size) * 0.232);
  }

  /* ── Notification pulse animation ── */
  :host([data-notification='active']) {
    animation: rtc-notification-shadow-pulse 1.5s ease-in-out infinite;
  }

  :host([data-notification='active']) .bubble {
    /* 橙色到黄色渐变 */
    background: linear-gradient(135deg, #F97802 100%, #F9CD53 0%) !important;
    color: white !important;
    /* 添加缩放脉冲动画 */
    animation: rtc-notification-bubble-pulse 1.5s ease-in-out infinite;
  }

  @keyframes rtc-notification-shadow-pulse {
    0%,
    100% {
      box-shadow:
        var(--rtc-shadow-lg),
        0 0 0 0 rgba(249, 120, 2, 0);
    }
    50% {
      box-shadow:
        var(--rtc-shadow-lg),
        0 0 24px 8px rgba(249, 120, 2, 0.8);
    }
  }

  @keyframes rtc-notification-bubble-pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.15);
    }
  }

  /* 尊重用户动画偏好 */
  @media (prefers-reduced-motion: reduce) {
    :host([data-notification='active']) {
      animation: none;
    }

    :host([data-notification='active']) .bubble {
      opacity: 0.7;
    }
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
