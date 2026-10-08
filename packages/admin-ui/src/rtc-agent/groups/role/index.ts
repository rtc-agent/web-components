import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { createRole } from './create';
import { listRoles } from './list';
import { removeRole } from './remove';
import { updateRole } from './update';

/**
 * Admin Role Management Function Group
 *
 * Corresponds to route: /system/roles
 *
 * All functions call the page-exposed React API:
 * - window.__pages__.role.list()
 * - window.__pages__.role.create()
 * - window.__pages__.role.update()
 * - window.__pages__.role.remove()
 *
 * Permission requirements:
 * - list: role:read
 * - create, update, remove: role:write
 */
export const roleGroup = {
  name: 'role',
  description:
    'Admin role management module for /system/roles page. Supports CRUD operations (list, create, update, remove) on admin roles. All operations are reflected in the UI table.',
  functions: [
    listRoles,
    createRole,
    updateRole,
    removeRole,
  ] as PermissionAwareFunctionDef[],
};
