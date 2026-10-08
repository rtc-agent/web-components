import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { createAdminUser } from './create';
import { listUsers } from './list';
import { removeAdminUsers } from './remove';
import { updateAdminUser } from './update';

/**
 * Admin User Management Function Group
 *
 * Corresponds to route: /system/users
 *
 * All functions call page-exposed React API:
 * - window.__pages__.admin.list()
 * - window.__pages__.admin.create()
 * - window.__pages__.admin.update()
 * - window.__pages__.admin.remove()
 *
 * Permission requirements:
 * - list: admin_user:read
 * - create, update: admin_user:write
 * - remove: admin_user:delete
 */
export const adminGroup = {
  name: 'admin',
  description:
    'Admin user management module for /system/users page. Supports CRUD operations (list, create, update, remove) on admin users. All operations are reflected in the UI table.',
  functions: [
    listUsers,
    createAdminUser,
    updateAdminUser,
    removeAdminUsers,
  ] as PermissionAwareFunctionDef[],
};
