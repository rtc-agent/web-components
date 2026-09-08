/**
 * Notification Context — 通知系统状态和操作
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: 需要感知未读通知的组件
 */
import {createContext} from '@lit/context';

export interface NotificationState {
    /** 未读通知计数 */
    unreadCount: number;
    /** 上次通知时间戳（用于气泡动画） */
    lastNotificationAt: number | null;
}

export interface NotificationActions {
    /** 标记所有通知为已读 */
    markAsRead(): void;
    /** 清除所有通知状态 */
    clearAll(): void;
}

export interface NotificationContextValue {
    state: NotificationState;
    actions: NotificationActions;
}

export const NotificationContext = createContext<NotificationContextValue>(
    Symbol('notification-context')
);

export const DEFAULT_NOTIFICATION_STATE: NotificationState = {
    unreadCount: 0,
    lastNotificationAt: null,
};
