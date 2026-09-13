import {css} from 'lit';

/**
 * Drawer 样式
 *
 * 左侧滑出抽屉面板：
 * - 固定在 Activity Bar 右侧，overlay 在主内容之上
 * - 通过 transform + transition 实现平滑滑入/滑出
 * - 半透明 backdrop 遮罩层，点击关闭
 * - 宽度可通过 --rtc-drawer-width CSS 自定义属性配置
 *
 * @cssprop [--rtc-drawer-width=240px] - 抽屉宽度
 * @csspart backdrop - 遮罩层
 * @csspart panel - 抽屉面板
 */
export const styles = css`
    :host {
        /* 抽屉面板定位基准：通过 --rtc-drawer-left 控制左侧偏移 */
        position: absolute;
        top: 0;
        left: var(--rtc-drawer-left, 0px);
        right: 0;
        height: 100%;
        z-index: var(--rtc-z-drawer, 20);
        pointer-events: none;
    }

    :host([open]) {
        pointer-events: auto;
    }

    /* ── Backdrop 遮罩层 ── */
    .backdrop {
        position: absolute;
        inset: 0;
        background: var(--rtc-drawer-backdrop-bg, rgba(0, 0, 0, 0.3));
        opacity: 0;
        transition: opacity var(--rtc-drawer-transition-duration, 0.25s) var(--rtc-transition-timing, ease);
        pointer-events: none;
    }

    :host([open]) .backdrop {
        opacity: 1;
        pointer-events: auto;
    }

    /* ── Panel 抽屉面板 ── */
    .panel {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: var(--rtc-drawer-width, 240px);
        background: var(--rtc-color-bg-secondary, #252526);
        border-right: var(--rtc-border-width, 1px) solid var(--rtc-color-border, #3c3c3c);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: translateX(-100%);
        transition: transform var(--rtc-drawer-transition-duration, 0.25s) var(--rtc-transition-timing, ease);
        box-shadow: var(--rtc-drawer-shadow, 2px 0 8px rgba(0, 0, 0, 0.15));
    }

    :host([open]) .panel {
        transform: translateX(0);
    }

    /* ── 内容插槽区域 ── */
    ::slotted(*) {
        flex: 1;
        overflow: hidden;
    }

    /* ── 尊重用户动画偏好 ── */
    @media (prefers-reduced-motion: reduce) {
        .backdrop,
        .panel {
            transition-duration: 0.01ms !important;
        }
    }
`;
