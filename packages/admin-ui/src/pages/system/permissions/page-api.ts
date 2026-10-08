/**
 * Admin permission management page API interface
 *
 * Page component registers these APIs to window.__pages__ on mount
 * Function handlers call these APIs to operate the UI
 *
 * Key principles:
 * - Use React native patterns (actionRef, React Query)
 * - Return data displayed in UI
 * - Do not directly manipulate DOM
 */

import type { PermissionPolicy } from '@/services/permission';

export interface PermissionPageAPI {
  /**
   * Read the data currently displayed in the table
   * Calls the service function to fetch backend data, consistent with UI display
   */
  list: (params?: {
    current?: number;
    pageSize?: number;
    role_id?: string;
    resource?: string;
  }) => Promise<{
    success: boolean;
    data: PermissionPolicy[];
    total: number;
  }>;

  /**
   * Refresh the table
   * Calls actionRef.current?.reload()
   */
  refresh: () => Promise<void>;

  /**
   * Create a permission policy
   */
  create: (data: {
    role_id: string;
    resource: string;
    action: string;
  }) => Promise<{ success: boolean }>;

  /**
   * Remove permission policies
   * Note: Permission API uses composite key (role_id, resource, action), not a single ID
   */
  remove: (
    items: Array<{ role_id: string; resource: string; action: string }>,
  ) => Promise<{ success: boolean; deletedCount?: number }>;
}

// Extend the global PagesRegistry interface
declare global {
  interface PagesRegistry {
    permission?: PermissionPageAPI;
  }
}
