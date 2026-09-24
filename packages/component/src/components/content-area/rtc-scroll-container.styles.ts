/**
 * Styles for <rtc-scroll-container>
 *
 * Provides scroll lock functionality with smooth transitions.
 * Uses CSS variables for flexible height configuration.
 */
import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    position: relative;
    flex: 1;
    min-width: 0; /* Allow flex item to shrink below content size */
  }

  .scroll-container {
    position: relative;
    overflow: hidden;
  }

  .content {
    max-height: var(--rtc-scroll-max-height-locked, 100px);
    overflow: hidden;
    transition: max-height var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  /* 解锁状态 */
  .scroll-container.unlocked .content {
    max-height: var(--rtc-scroll-max-height-unlocked, 200px);
    overflow-y: auto;
  }

  /* 底部渐变遮罩 + 模糊（通用样式） */
  .scroll-container .content::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 48px;
    pointer-events: none;
    z-index: 1;
    transition: all var(--rtc-transition-duration) var(--rtc-transition-timing);
  }

  /* 锁定状态：显示遮罩 */
  .scroll-container.locked .content::after {
    background: linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--rtc-color-bg) 85%, transparent) 100%);
    backdrop-filter: blur(0.5px);
    -webkit-backdrop-filter: blur(0.5px);
  }

  /* 解锁状态：隐藏遮罩 */
  .scroll-container.unlocked .content::after {
    background: linear-gradient(to bottom, transparent 0%, transparent 100%);
    backdrop-filter: blur(0px);
    -webkit-backdrop-filter: blur(0px);
  }

  /* 滚动指示器（下箭头图标） */
  .scroll-indicator {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 2;
    opacity: 0.4;
  }

  .scroll-indicator svg {
    width: 12px;
    height: 12px;
    fill: var(--rtc-color-text-secondary);
  }

  /* 解锁状态：上箭头指示器（位于底部） */
  .scroll-indicator-up {
    position: absolute;
    bottom: 4px;
    background: var(--rtc-color-bg-secondary);
    border-radius: var(--rtc-border-radius-sm);
    padding: 2px;
  }
`;
