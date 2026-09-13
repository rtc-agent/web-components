/**
 * RTC Drawer Component
 *
 * 通用左侧抽屉面板组件。
 * 从 Activity Bar 右侧滑入，overlay 在主内容之上，不挤压主内容区宽度。
 *
 * 用于替代原有的 flex 布局侧边栏（session-tree、file-explorer、settings-nav），
 * 统一抽屉交互：
 * - 半透明 backdrop 遮罩，点击关闭
 * - ESC 键关闭
 * - 平滑 slide-in/out 动画
 * - 互斥行为（由父组件控制，同一时刻只打开一个）
 *
 * @element rtc-drawer
 *
 * @attr {boolean} open - 抽屉是否打开
 *
 * @cssprop [--rtc-drawer-width=240px] - 抽屉面板宽度
 * @cssprop [--rtc-drawer-backdrop-bg=rgba(0,0,0,0.3)] - 遮罩层背景色
 * @cssprop [--rtc-drawer-transition-duration=0.25s] - 动画时长
 *
 * @csspart backdrop - 遮罩层元素
 * @csspart panel - 抽屉面板元素
 *
 * @fires rtc-drawer-close - 用户请求关闭抽屉时触发（点击 backdrop / 按 ESC）
 *
 * ## 用法
 * ```html
 * <rtc-drawer ?open=${drawerOpen}>
 *   <rtc-session-tree></rtc-session-tree>
 * </rtc-drawer>
 * ```
 *
 * ## 定位
 * Drawer 使用 position: absolute 定位，需要父容器设置 position: relative。
 * 在 rtc-agent 中，Drawer 放在 .main-layout 内部（.main-layout 已是 flex 容器），
 * 通过 JS 设置 left 为 Activity Bar 宽度（48px），实现紧贴 Activity Bar 右侧。
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-drawer.styles.js';

@customElement('rtc-drawer')
export class RtcDrawer extends LitElement {
    static styles = styles;

    /**
     * 抽屉是否打开
     *
     * 通过 attribute `open` 或 property 控制。
     * reflect: true 使 DOM 上能看到 [open] 属性，驱动 CSS 状态。
     */
    @property({type: Boolean, reflect: true})
    open = false;

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();
        // 全局 ESC 监听：打开状态下按 ESC 关闭
        document.addEventListener('keydown', this._boundOnKeydown);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('keydown', this._boundOnKeydown);
    }

    /* ── Event Handlers ── */

    /**
     * 点击 backdrop 遮罩层
     *
     * 派发自定义事件通知父组件关闭抽屉。
     */
    private _handleBackdropClick() {
        this.dispatchEvent(
            new CustomEvent('rtc-drawer-close', {
                bubbles: true,
                composed: true,
            })
        );
    }

    /**
     * 全局 ESC 键处理
     *
     * 仅当抽屉打开且连接在 DOM 中时响应。
     */
    private _boundOnKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.open) {
            e.preventDefault();
            this.dispatchEvent(
                new CustomEvent('rtc-drawer-close', {
                    bubbles: true,
                    composed: true,
                })
            );
        }
    };

    /* ── Render ── */

    render() {
        return html`
            <div
                class="backdrop"
                part="backdrop"
                @click=${this._handleBackdropClick}
                aria-hidden="true"
            ></div>
            <div
                class="panel"
                part="panel"
                role="complementary"
                aria-hidden="${!this.open}"
            >
                <slot></slot>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-drawer': RtcDrawer;
    }

    interface HTMLElementEventMap {
        'rtc-drawer-close': CustomEvent;
    }
}
