/**
 * Admin Role Management Page API Interface
 *
 * Page component registers these APIs to window.__pages__ on mount.
 * Function handlers call these APIs to operate the UI.
 *
 * Key principles:
 * - Use React native patterns (actionRef, React Query)
 * - Return data displayed in UI
 * - Do not directly manipulate DOM
 */

import type { RoleInfo } from '@/services/admin-auth';

export interface RolePageAPI {
  /**
   * Read the data currently displayed in the table.
   * Retrieves from React Query cache, consistent with UI display.
   */
  list: (params?: {
    current?: number;
    pageSize?: number;
    keyword?: string;
  }) => Promise<{
    success: boolean;
    data: RoleInfo[];
    total: number;
  }>;

  /**
   * Refresh the table.
   * Calls actionRef.current?.reload().
   */
  refresh: () => Promise<void>;

  /**
   * Create an admin role.
   * Triggers the create flow (opens modal, fills form, submits).
   */
  create: (data: {
    name: string;
    display_name: string;
    description?: string;
    is_enabled?: boolean;
  }) => Promise<{ success: boolean; id?: string }>;

  /**
   * Update an admin role.
   * Triggers the update flow (opens modal, fills data, submits).
   */
  update: (data: {
    id: string;
    name?: string;
    display_name?: string;
    description?: string;
    is_enabled?: boolean;
  }) => Promise<{ success: boolean }>;

  /**
   * Delete admin roles.
   */
  remove: (
    ids: string[],
  ) => Promise<{ success: boolean; deletedCount?: number }>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    role?: RolePageAPI;
  }
}
