import {createContext} from '@lit/context';
import type {Activity} from '../types/index.js';

/**
 * Activity Context — 当前活动状态和侧边栏可见性。
 *
 * 管理 VS Code 风格布局中的活动切换（资源管理器/聊天/设置）。
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-activity-bar>, <rtc-agent> (布局条件渲染)
 */
export interface ActivityState {
    /** 当前活动 */
    active: Activity;
    /** 侧边栏是否可见 */
    sidebarVisible: boolean;
}

export interface ActivityActions {
    /**
     * 设置活动（点击活动图标时调用）
     *
     * 逻辑：
     * - 若点击当前活动 → toggle sidebar
     * - 若点击不同活动 → 切换活动并显示 sidebar
     */
    setActivity(activity: Activity): void;
    /** 强制显示侧边栏 */
    showSidebar(): void;
    /** 强制隐藏侧边栏 */
    hideSidebar(): void;
    /** Toggle 侧边栏 */
    toggleSidebar(): void;
    /** 重置为默认状态 */
    reset(): void;
}

export interface ActivityContextValue {
    state: ActivityState;
    actions: ActivityActions;
}

export const ActivityContext = createContext<ActivityContextValue>(
    Symbol('activity-context')
);

export const DEFAULT_ACTIVITY_STATE: ActivityState = {
    active: 'chat',
    sidebarVisible: false,
};
