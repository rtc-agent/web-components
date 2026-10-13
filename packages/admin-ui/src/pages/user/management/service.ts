/**
 * Service layer for the admin user management page
 *
 * Re-exports shared API from @/services/ for page-level consistency.
 * All page components should import from this file rather than @/services/ directly.
 */

export {
  assignUserRoles,
  createAdminUser,
  deleteAdminUser,
  getUserList,
  getUserRoles,
  revokeUserRole,
  updateAdminUser,
} from '@/services/user-role';
export type { UserInfo } from '@/services/types';
export type { UserRoleAssignment } from '@/services/user-role';
