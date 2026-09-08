/**
 * Activity Controller
 *
 * 管理 VS Code 风格布局中的活动状态（资源管理器/聊天/设置）。
 *
 * Corresponds to: `ActivityContext` (defined in `contexts/activity.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-activity-bar>`, `<rtc-agent>` (布局条件渲染)
 *
 * ## 持久化
 * - 通过 localStorage 保存当前 active 活动和 sidebarVisible 状态
 * - 刷新页面后恢复到上次离开时的活动
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Activity} from '../types/index.js';
import type {ActivityState, ActivityActions, ActivityContextValue} from '../contexts/activity.js';
import {DEFAULT_ACTIVITY_STATE} from '../contexts/activity.js';
import {STORAGE_KEYS} from '../config/auth.js';

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
        this._restore();
    }

    hostConnected() {}
    hostDisconnected() {}

    /* ─ Persistence ── */

    private _restore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.activityBar);
            if (!raw) return;
            const saved = JSON.parse(raw);
            const isValidActivity = (v: unknown): v is Activity =>
                v === 'files' || v === 'chat' || v === 'settings';
            if (saved && typeof saved === 'object') {
                this._state = {
                    active: isValidActivity(saved.active) ? saved.active : DEFAULT_ACTIVITY_STATE.active,
                    sidebarVisible: typeof saved.sidebarVisible === 'boolean'
                        ? saved.sidebarVisible
                        : DEFAULT_ACTIVITY_STATE.sidebarVisible,
                };
            }
        } catch {
            // localStorage may be unavailable or data corrupted
        }
    }

    private _persist() {
        try {
            localStorage.setItem(STORAGE_KEYS.activityBar, JSON.stringify(this._state));
        } catch {
            // localStorage may be unavailable
        }
    }

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
            this._persist();
            this.host.requestUpdate();
        }
    }

    private _showSidebar() {
        if (!this._state.sidebarVisible) {
            this._state = {...this._state, sidebarVisible: true};
            this._persist();
            this.host.requestUpdate();
        }
    }

    private _hideSidebar() {
        if (this._state.sidebarVisible) {
            this._state = {...this._state, sidebarVisible: false};
            this._persist();
            this.host.requestUpdate();
        }
    }

    private _toggleSidebar() {
        this._state = {
            ...this._state,
            sidebarVisible: !this._state.sidebarVisible,
        };
        this._persist();
        this.host.requestUpdate();
    }

    private _reset() {
        this._state = {...DEFAULT_ACTIVITY_STATE};
        this._persist();
        this.host.requestUpdate();
    }
}
