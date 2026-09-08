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
 * - ↑/↓ 箭头键在图标间切换（roving tabindex），Enter/Space 激活
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

/** 可聚焦的活动列表（顺序：files → chat → settings） */
const ACTIVITY_LIST: Activity[] = ['files', 'chat', 'settings'];

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
     * 键盘事件处理
     *
     * - ↑/↓：在可用活动间移动焦点（roving tabindex）
     * - Enter/Space：激活当前活动
     * - Home/End：跳到首/末项
     */
    private _handleKeydown(e: KeyboardEvent, currentActivity: Activity) {
        const available = ACTIVITY_LIST;
        const idx = available.indexOf(currentActivity);

        let handled = true;

        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowRight': {
                const next = available[(idx + 1) % available.length];
                this._focusActivity(next);
                break;
            }
            case 'ArrowUp':
            case 'ArrowLeft': {
                const prev = available[(idx - 1 + available.length) % available.length];
                this._focusActivity(prev);
                break;
            }
            case 'Home': {
                this._focusActivity(available[0]);
                break;
            }
            case 'End': {
                this._focusActivity(available[available.length - 1]);
                break;
            }
            case 'Enter':
            case ' ':
                this._handleClick(currentActivity);
                break;
            default:
                handled = false;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    /**
     * 将焦点移到指定活动图标（roving tabindex）
     */
    private _focusActivity(activity: Activity) {
        const el = this.shadowRoot?.querySelector(`[data-activity="${activity}"]`) as HTMLElement | null;
        el?.focus();
    }

    /**
     * 计算 roving tabindex：当前 active 的活动获得 tabindex=0，其余 -1
     */
    private _tabIndex(activity: Activity): number {
        return activity === this.active ? 0 : -1;
    }

    render() {
        return html`
            <!-- 顶部活动 -->
            <div
                class="activity-icon ${this.active === 'files' ? 'active' : ''}"
                data-activity="files"
                role="tab"
                tabindex="${this._tabIndex('files')}"
                aria-label="资源管理器"
                aria-selected="${this.active === 'files'}"
                title="资源管理器"
                @click=${() => this._handleClick('files')}
                @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, 'files')}
            >${filesIcon}</div>

            <div
                class="activity-icon ${this.active === 'chat' ? 'active' : ''}"
                data-activity="chat"
                role="tab"
                tabindex="${this._tabIndex('chat')}"
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
                data-activity="settings"
                role="tab"
                tabindex="${this._tabIndex('settings')}"
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
