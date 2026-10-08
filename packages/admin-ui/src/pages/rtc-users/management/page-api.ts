/**
 * RTC User Management Page API Interface
 *
 * Page component registers these APIs to window.__pages__ on mount.
 * Function handlers call these APIs to operate on the UI.
 *
 * Key principles:
 * - Use React native patterns (actionRef, service calls)
 * - Return data displayed in UI
 * - Do not directly manipulate DOM
 */

import type { DeviceInfo, RtcUserInfo, TokenStatsResponse } from './data';

export interface RtcUserPageAPI {
  /**
   * Read the data currently displayed in the table.
   * Calls service function to fetch backend data, matching UI display.
   */
  list: (params?: {
    current?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }) => Promise<{
    success: boolean;
    data: RtcUserInfo[];
    total: number;
    error?: string;
  }>;

  /**
   * Refresh the table.
   * Calls actionRef.current?.reload().
   */
  refresh: () => Promise<void>;

  /**
   * Ban an RTC user.
   * Calls banRtcUser service, then refreshes the table.
   */
  ban: (data: {
    userId: string;
    reason: string;
  }) => Promise<{ success: boolean; error?: string }>;

  /**
   * Unban an RTC user.
   * Calls unbanRtcUser service, then refreshes the table.
   */
  unban: (userId: string) => Promise<{ success: boolean; error?: string }>;

  /**
   * Get devices for an RTC user.
   * Calls getUserDevices service.
   */
  devices: (userId: string) => Promise<{
    success: boolean;
    data: DeviceInfo[];
    error?: string;
  }>;

  /**
   * Get token statistics for an RTC user.
   * Calls getUserTokenStats service.
   */
  tokenStats: (
    userId: string,
    days?: number,
  ) => Promise<{
    success: boolean;
    data: TokenStatsResponse;
    error?: string;
  }>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    rtcUser?: RtcUserPageAPI;
  }
}
