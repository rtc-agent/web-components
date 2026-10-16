/**
 * Type definitions for getInitialState runtime configuration
 * Extracted for better maintainability and type safety
 */

import type { Settings as LayoutSettings } from '@ant-design/pro-components';

/**
 * Initial state shape returned by getInitialState()
 * Used throughout the app via useModel('@@initialState')
 *
 * Contains only data — no functions or transient UI state.
 * UI state (e.g. settingDrawerOpen) is managed by dedicated modules
 * (see utils/settingDrawer.ts). Actions (e.g. fetchUserInfo) are
 * standalone utilities (see utils/auth-actions.ts).
 */
export interface InitialState {
  /** Layout settings (theme, navigation, etc.) */
  settings?: Partial<LayoutSettings>;
  /** Current authenticated user information */
  currentUser?: API.CurrentUser;
  /**
   * Degraded state flag: set when token exists but user info failed to load.
   * Used by onPageChange to display a warning toast about incomplete data.
   */
  degraded?: boolean;
}
