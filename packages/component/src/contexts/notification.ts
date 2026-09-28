/**
 * Notification Context — notification system state and actions
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: components that need to be aware of unread notifications
 */
import {createContext} from '@lit/context';

export interface NotificationState {
    /** Unread notification count */
    unreadCount: number;
    /** Last notification timestamp (used for bubble animation) */
    lastNotificationAt: number | null;
}

export interface NotificationActions {
    /** Mark all notifications as read */
    markAsRead(): void;
    /** Clear all notification state */
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
