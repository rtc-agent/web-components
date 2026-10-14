/**
 * Type definitions for getInitialState runtime configuration
 * Extracted for better maintainability and type safety
 */

import type { Settings as LayoutSettings } from '@ant-design/pro-components';

/**
 * Initial state shape returned by getInitialState()
 * Used throughout the app via useModel('@@initialState')
 */
export interface InitialState {
  /** Layout settings (theme, navigation, etc.) */
  settings?: Partial<LayoutSettings>;
  /** Current authenticated user information */
  currentUser?: API.CurrentUser;
  /** Loading state during initialization */
  loading?: boolean;
  /** Function to manually refresh user info */
  fetchUserInfo?: (
    signal?: AbortSignal,
  ) => Promise<API.CurrentUser | undefined>;
  /** Whether the settings drawer is open */
  settingDrawerOpen?: boolean;
  /**
   * Degraded state flag: set when token exists but user info failed to load.
   * Used by onPageChange to display a warning toast about incomplete data.
   */
  degraded?: boolean;
}
