/**
 * Service layer for the admin user management page
 *
 * Re-exports shared API from @/services/ for page-level consistency.
 * All page components should import from this file rather than @/services/ directly.
 */

export type { UserInfo } from '@/services/admin-auth';
export type { UserRoleAssignment } from '@/services/user-role';
export {
  assignUserRoles,
  createAdminUser,
  deleteAdminUser,
  getUserList,
  getUserRoles,
  revokeUserRole,
  updateAdminUser,
} from '@/services/user-role';
