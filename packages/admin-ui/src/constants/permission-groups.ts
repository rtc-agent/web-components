/**
 * Permission Groups Configuration
 *
 * Centralizes permission group definitions for composite permissions.
 * Used by access.ts to determine menu visibility and access control.
 *
 * Design rationale:
 * - Avoids scattering permission combination logic across multiple places
 * - Single source of truth for which permissions belong to which menu
 * - Makes it easy to audit and modify permission groupings
 * - Prevents bugs where adding a new permission to a menu requires
 *   updating multiple files
 *
 * Example:
 * ```typescript
 * import { SYSTEM_MENU_PERMISSIONS, hasAnyPermission } from '@/constants/permission-groups';
 *
 * // Check if user has access to system menu
 * const canViewSystem = hasAnyPermission(userPermissions, SYSTEM_MENU_PERMISSIONS);
 * ```
 */

import {
  PERM_ADMIN_USER_READ,
  PERM_AUDIT_LOG_READ,
  PERM_PERMISSION_READ,
  PERM_ROLE_READ,
  PERM_RTC_MESSAGE_READ,
  PERM_RTC_SESSION_READ,
  PERM_RTC_USER_BAN,
  PERM_RTC_USER_READ,
  PERM_SERVER_CONFIG_READ,
} from './permissions';

/**
 * System Menu Permission Group
 *
 * Permissions that grant access to the System Management menu.
 *
 * Business rule:
 * A user can see the System menu if they have ANY of these permissions.
 * This follows the "least privilege" principle — users only see the
 * sub-menus they have access to, but the parent menu remains visible
 * as long as they have at least one system-level permission.
 *
 * Design note:
 * - This is an OR relationship, not AND
 * - Adding a new system sub-module requires adding its read permission here
 * - Write/delete permissions are NOT included (they imply read access)
 *
 * Related:
 * - config/routes.ts: /system route uses canSystemView (derived from this group)
 * - src/access.ts: canSystemView implementation
 */
export const SYSTEM_MENU_PERMISSIONS: readonly string[] = [
  PERM_ADMIN_USER_READ,
  PERM_ROLE_READ,
  PERM_PERMISSION_READ,
  PERM_AUDIT_LOG_READ,
  PERM_SERVER_CONFIG_READ,
] as const;

/**
 * RTC Users Menu Permission Group
 *
 * Permissions that grant access to the RTC Users Management menu.
 *
 * Business rule:
 * A user can see the RTC Users menu if they have ANY of these permissions.
 * This solves the parent-child route permission mismatch problem where
 * the parent route uses a composite permission but child routes use
 * specific permissions.
 *
 * Design note:
 * - This is an OR relationship, not AND
 * - All RTC-related permissions are included (read, ban, session, message)
 * - Ensures menu visibility matches actual route access
 *
 * Related:
 * - config/routes.ts: /rtc-users route uses canRtcUsersMenu
 * - src/access.ts: canRtcUsersMenu implementation
 */
export const RTC_USERS_MENU_PERMISSIONS: readonly string[] = [
  PERM_RTC_USER_READ,
  PERM_RTC_USER_BAN,
  PERM_RTC_SESSION_READ,
  PERM_RTC_MESSAGE_READ,
] as const;

/**
 * Check if a permission set contains any permission from a group
 *
 * Utility function for composite permission checks.
 * Returns true if the user has at least one permission from the group.
 *
 * @param userPermissions - Set of permission strings the user has
 * @param permissionGroup - Array of permission strings to check against
 * @returns true if user has any permission from the group, false otherwise
 *
 * Example:
 * ```typescript
 * const canViewSystem = hasAnyPermission(
 *   currentUser.permissions,
 *   SYSTEM_MENU_PERMISSIONS
 * );
 * ```
 */
export function hasAnyPermission(
  userPermissions: Set<string> | undefined,
  permissionGroup: readonly string[],
): boolean {
  if (!userPermissions) {
    return false;
  }
  return permissionGroup.some((perm) => userPermissions.has(perm));
}

/**
 * Check if a permission set contains all permissions from a group
 *
 * Utility function for strict permission checks.
 * Returns true only if the user has ALL permissions from the group.
 *
 * @param userPermissions - Set of permission strings the user has
 * @param permissionGroup - Array of permission strings to check against
 * @returns true if user has all permissions from the group, false otherwise
 *
 * Example:
 * ```typescript
 * const canEditAll = hasAllPermissions(
 *   currentUser.permissions,
 *   [PERM_ADMIN_USER_WRITE, PERM_ROLE_WRITE]
 * );
 * ```
 */
export function hasAllPermissions(
  userPermissions: Set<string> | undefined,
  permissionGroup: readonly string[],
): boolean {
  if (!userPermissions) {
    return false;
  }
  return permissionGroup.every((perm) => userPermissions.has(perm));
}
