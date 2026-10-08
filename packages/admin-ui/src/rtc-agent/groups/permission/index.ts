import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { createPermissionPolicy } from './create';
import { listPermissions } from './list';
import { removePermissionPolicies } from './remove';

/**
 * Admin Permission Management Function Group
 *
 * Corresponds to route: /system/permissions
 *
 * All functions call the page-exposed React API:
 * - window.__pages__.permission.list()
 * - window.__pages__.permission.create()
 * - window.__pages__.permission.remove()
 *
 * Permission requirements:
 * - list: permission:read
 * - create, remove: permission:write
 *
 * Note: Permission API uses composite key (role_id, resource, action),
 * there is no update operation.
 */
export const permissionGroup = {
  name: 'permission',
  description:
    'Admin permission management module for /system/permissions page. Supports querying, creating, and removing permission policies. All operations are reflected in the UI table.',
  functions: [
    listPermissions,
    createPermissionPolicy,
    removePermissionPolicies,
  ] as PermissionAwareFunctionDef[],
};
