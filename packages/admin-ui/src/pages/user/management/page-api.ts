/**
 * Admin user management page API interface
 *
 * Page component registers this API on mount.
 * Function handlers call these APIs to operate on the UI.
 *
 * Key principles:
 * - Use React native patterns (actionRef, mutation)
 * - Return data matching UI display
 * - No direct DOM manipulation
 */

import type { UserInfo } from '@/services/admin-auth';
import type { UserRoleAssignment } from '@/services/userRole';

export interface AdminPageAPI {
  /**
   * Read current table data
   * Calls service function to fetch backend data, matching UI display
   */
  list: (params?: {
    current?: number;
    pageSize?: number;
    keyword?: string;
  }) => Promise<{
    success: boolean;
    data: UserInfo[];
    total: number;
  }>;

  /**
   * Refresh table
   * Calls actionRef.current?.reload()
   */
  refresh: () => Promise<void>;

  /**
   * Create admin user
   * Triggers create flow (opens modal, fills form, submits)
   */
  create: (data: {
    email: string;
    password: string;
    name?: string;
    role_ids?: string[];
  }) => Promise<{ success: boolean; id?: string }>;

  /**
   * Update admin user
   * Triggers update flow (opens modal, fills data, submits)
   */
  update: (data: {
    id: string;
    name?: string;
    password?: string;
  }) => Promise<{ success: boolean }>;

  /**
   * Delete admin users
   */
  remove: (
    ids: string[],
  ) => Promise<{ success: boolean; deletedCount?: number }>;

  /**
   * Query roles assigned to a user
   */
  listUserRoles: (userId: string) => Promise<{
    success: boolean;
    data: UserRoleAssignment[];
    total: number;
  }>;

  /**
   * Assign roles to a user
   */
  assignRoles: (
    userId: string,
    roleIds: string[],
  ) => Promise<{
    success: boolean;
  }>;

  /**
   * Revoke a role from a user
   */
  revokeRole: (
    userId: string,
    roleId: string,
  ) => Promise<{
    success: boolean;
  }>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    admin?: AdminPageAPI;
  }
}
