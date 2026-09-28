import {createContext} from '@lit/context';
import type {Activity} from '../types/index.js';

/**
 * Activity Context — current activity state and sidebar visibility.
 *
 * Manages activity switching (Explorer/Chat/Settings) in a VS Code-style layout.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-activity-bar>, <rtc-agent> (layout conditional rendering)
 */
export interface ActivityState {
    /** Current activity */
    active: Activity;
    /** Whether the sidebar is visible */
    sidebarVisible: boolean;
}

export interface ActivityActions {
    /**
     * Set activity (called when an activity icon is clicked)
     *
     * Logic:
     * - If clicking the current activity → toggle sidebar
     * - If clicking a different activity → switch activity and show sidebar
     */
    setActivity(activity: Activity): void;
    /** Force show the sidebar */
    showSidebar(): void;
    /** Force hide the sidebar */
    hideSidebar(): void;
    /** Toggle the sidebar */
    toggleSidebar(): void;
    /** Reset to default state */
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
    sidebarVisible: true,
};
