/**
 * Service layer for the admin roles page
 *
 * Re-exports shared API from @/services/ for page-level consistency.
 * All page components should import from this file rather than @/services/ directly.
 */

export {
  createRole,
  deleteRole,
  getRoleList,
  patchRole,
  updateRole,
} from '@/services/role';
export {
  createPermission,
  deletePermission,
  getPermissionList,
} from '@/services/permission';
export type { PermissionPolicy } from '@/services/permission';
