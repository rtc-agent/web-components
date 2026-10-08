/**
 * Self Account Center Page API Interface
 *
 * Page component registers these APIs to window.__pages__ on mount.
 * Function handlers call these APIs to operate on the UI.
 *
 * Key principles:
 * - Returns profile data displayed in the center page
 * - Uses React Query cache when available
 * - Falls back to direct service call when cache is unavailable
 */

import type { CurrentUser } from './data.d';

export interface SelfAccountCenterPageAPI {
  /**
   * Get current user's profile information.
   * Returns data displayed in the personal center page.
   */
  getProfile: () => Promise<{
    success: boolean;
    data: CurrentUser | null;
    error?: string;
  }>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    selfAccountCenter?: SelfAccountCenterPageAPI;
  }
}
