/**
 * Activity Controller
 *
 * 管理 VS Code 风格布局中的活动状态（资源管理器/聊天/设置）。
 *
 * Corresponds to: `ActivityContext` (defined in `contexts/activity.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-activity-bar>`, `<rtc-agent>` (布局条件渲染)
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Activity} from '../types/index.js';
import type {ActivityState, ActivityActions, ActivityContextValue} from '../contexts/activity.js';
import {DEFAULT_ACTIVITY_STATE} from '../contexts/activity.js';

// Re-export types for convenience
export type {ActivityState, ActivityActions};

export class ActivityController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: ActivityState = {...DEFAULT_ACTIVITY_STATE};

    readonly actions: ActivityActions;

    get value(): ActivityContextValue {
        return {state: this._state, actions: this.actions};
    }

    /** 当前活动（readonly 快捷访问） */
    get active(): Activity {
        return this._state.active;
    }

    /** 侧边栏是否可见（readonly 快捷访问） */
    get sidebarVisible(): boolean {
        return this._state.sidebarVisible;
    }

    constructor(host: ReactiveControllerHost) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            setActivity: (activity: Activity) => this._setActivity(activity),
            showSidebar: () => this._showSidebar(),
            hideSidebar: () => this._hideSidebar(),
            toggleSidebar: () => this._toggleSidebar(),
            reset: () => this._reset(),
        };
    }

    hostConnected() {}
    hostDisconnected() {}

    /**
     * 设置活动
     *
     * 逻辑：
     * - 点击当前活动 → toggle sidebar
     * - 点击不同活动 → 切换活动并显示 sidebar
     */
    private _setActivity(activity: Activity) {
        if (this._state.active === activity) {
            // 点击当前活动，toggle sidebar
            this._toggleSidebar();
        } else {
            // 切换到新活动，显示 sidebar
            this._state = {
                active: activity,
                sidebarVisible: true,
            };
            this.host.requestUpdate();
        }
    }

    private _showSidebar() {
        if (!this._state.sidebarVisible) {
            this._state = {...this._state, sidebarVisible: true};
            this.host.requestUpdate();
        }
    }

    private _hideSidebar() {
        if (this._state.sidebarVisible) {
            this._state = {...this._state, sidebarVisible: false};
            this.host.requestUpdate();
        }
    }

    private _toggleSidebar() {
        this._state = {
            ...this._state,
            sidebarVisible: !this._state.sidebarVisible,
        };
        this.host.requestUpdate();
    }

    private _reset() {
        this._state = {...DEFAULT_ACTIVITY_STATE};
        this.host.requestUpdate();
    }
}
