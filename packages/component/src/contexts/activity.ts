import { createContext } from '@lit/context';
import type { Activity } from '../types/index.js';

/**
 * Activity Context — current activity state and sidebar visibility.
 *
 * Manages activity switching (Explorer/Chat/Settings) in a VS Code-style layout.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-activity-bar>, <rtc-agent> (layout conditional rendering)
 *
 * @example
 * ```ts
 * // Consuming in a LitElement component:
 * import { consume } from '@lit/context';
 * import { ActivityContext, type ActivityContextValue } from './contexts/activity.js';
 *
 * class MyComponent extends LitElement {
 *   @consume({ context: ActivityContext })
 *   private _activityContext!: ActivityContextValue;
 *
 *   render() {
 *     const { state, actions } = this._activityContext;
 *     return html`
 *       <div>Active: ${state.active}</div>
 *       <button @click=${() => actions.setActivity('explorer')}>Explorer</button>
 *       <button @click=${() => actions.toggleSidebar()}>Toggle Sidebar</button>
 *     `;
 *   }
 * }
 * ```
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
   * - If clicking a different activity → switch activity, preserving the current sidebar state
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
  Symbol('activity-context'),
);

export const DEFAULT_ACTIVITY_STATE: ActivityState = {
  active: 'chat',
  sidebarVisible: true,
};
