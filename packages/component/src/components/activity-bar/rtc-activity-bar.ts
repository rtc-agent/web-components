/**
 * RTC Activity Bar Component
 *
 * VS Code 风格的左侧活动栏，支持在资源管理器/聊天/设置间切换。
 *
 * @element rtc-activity-bar
 * @fires activity-change - 活动切换时触发 (detail: { activity, toggleSidebar })
 *
 * ## 交互逻辑
 * - 点击当前活动 → toggle sidebar（触发 activity-change 事件，toggleSidebar: true）
 * - 点击不同活动 → 切换活动并显示 sidebar（触发 activity-change 事件，toggleSidebar: false）
 *
 * ## 样式
 * 使用项目 design tokens（--rtc-color-*），支持亮色/暗色主题。
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-activity-bar.styles.js';
import type {Activity} from '../../types/index.js';
import {
    filesIcon,
    chatIcon,
    gearIcon,
} from '../../icons/index.js';

@customElement('rtc-activity-bar')
export class RtcActivityBar extends LitElement {
    static styles = styles;

    /** 当前活动 */
    @property({type: String, reflect: true})
    active: Activity = 'chat';

    /**
     * 处理活动图标点击
     *
     * 逻辑：
     * - 点击当前活动 → toggleSidebar: true
     * - 点击不同活动 → 切换活动，toggleSidebar: false
     */
    private _handleClick(activity: Activity) {
        const isToggle = activity === this.active;
        this.dispatchEvent(
            new CustomEvent('activity-change', {
                bubbles: true,
                composed: true,
                detail: {
                    activity,
                    toggleSidebar: isToggle,
                },
            })
        );
    }

    /**
     * 键盘事件处理（Enter/Space 触发）
     */
    private _handleKeydown(e: KeyboardEvent, activity: Activity) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._handleClick(activity);
        }
    }

    render() {
        return html`
            <!-- 顶部活动 -->
            <div
                class="activity-icon ${this.active === 'files' ? 'active' : ''}"
                role="tab"
                tabindex="0"
                aria-label="资源管理器"
                aria-selected="${this.active === 'files'}"
                title="资源管理器"
                @click=${() => this._handleClick('files')}
                @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, 'files')}
            >${filesIcon}</div>

            <div
                class="activity-icon ${this.active === 'chat' ? 'active' : ''}"
                role="tab"
                tabindex="0"
                aria-label="聊天"
                aria-selected="${this.active === 'chat'}"
                title="聊天"
                @click=${() => this._handleClick('chat')}
                @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, 'chat')}
            >${chatIcon}</div>

            <!-- Spacer 将设置推到底部 -->
            <div class="activity-spacer"></div>

            <!-- 底部活动 -->
            <div
                class="activity-icon ${this.active === 'settings' ? 'active' : ''}"
                role="tab"
                tabindex="0"
                aria-label="设置"
                aria-selected="${this.active === 'settings'}"
                title="设置"
                @click=${() => this._handleClick('settings')}
                @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, 'settings')}
            >${gearIcon}</div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-activity-bar': RtcActivityBar;
    }

    interface HTMLElementEventMap {
        'activity-change': CustomEvent<{
            activity: Activity;
            toggleSidebar: boolean;
        }>;
    }
}
