/**
 * RTC Session Management Page API Interface
 *
 * Page component registers these APIs to window.__pages__ on mount.
 * Function handlers call these APIs to operate on the UI.
 *
 * Key principles:
 * - Use React native patterns (actionRef, service calls)
 * - Return data displayed in UI
 * - Do not directly manipulate DOM
 */

import type { SessionInfo } from './data';

export interface SessionPageAPI {
  /**
   * Read the data currently displayed in the table.
   * Calls service function to fetch backend data, matching UI display.
   */
  list: (params?: {
    current?: number;
    pageSize?: number;
    userId?: string;
    status?: string;
    search?: string;
    startTime?: string;
    endTime?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) => Promise<{
    success: boolean;
    data: SessionInfo[];
    total: number;
    error?: string;
  }>;

  /**
   * Refresh the table.
   * Calls actionRef.current?.reload().
   */
  refresh: () => Promise<void>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    rtcSession?: SessionPageAPI;
  }
}
