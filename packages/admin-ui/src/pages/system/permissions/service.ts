/**
 * Service layer for the permissions page
 *
 * Re-exports shared API from @/services/ for page-level consistency.
 * All page components should import from this file rather than @/services/ directly.
 */

export {
  createPermission,
  deletePermission,
  getPermissionList,
} from '@/services/permission';
