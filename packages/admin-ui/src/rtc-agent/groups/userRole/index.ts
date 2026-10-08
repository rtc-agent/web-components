import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { assignUserRoles } from './assign';
import { listUserRoles } from './list';
import { revokeUserRole } from './revoke';

/**
 * Admin User Role Assignment Function Group
 *
 * Corresponds to route: /system/users (shared with user Group)
 *
 * All functions call the page-exposed React API:
 * - window.__pages__.admin.listUserRoles()
 * - window.__pages__.admin.assignRoles()
 * - window.__pages__.admin.revokeRole()
 *
 * Permission requirements:
 * - list: admin_user_role:read
 * - assign, revoke: admin_user_role:write
 */
export const adminRoleGroup = {
  name: 'adminRole',
  description:
    'Admin user role assignment module for /system/users page (shared with admin group). Supports querying, assigning, and revoking roles for admin users. All operations are reflected in the UI.',
  functions: [
    listUserRoles,
    assignUserRoles,
    revokeUserRole,
  ] as PermissionAwareFunctionDef[],
};
