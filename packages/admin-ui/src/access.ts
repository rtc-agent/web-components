/**
 * @see https://umijs.org/docs/max/access#access
 * 基于管理员角色的动态权限定义
 */

import {
  PERM_ADMIN_USER_DELETE,
  PERM_ADMIN_USER_READ,
  PERM_ADMIN_USER_ROLE_WRITE,
  PERM_ADMIN_USER_WRITE,
  PERM_AUDIT_LOG_READ,
  PERM_DASHBOARD_READ,
  PERM_PERMISSION_READ,
  PERM_PERMISSION_WRITE,
  PERM_ROLE_READ,
  PERM_ROLE_WRITE,
  PERM_RTC_MESSAGE_READ,
  PERM_RTC_SESSION_READ,
  PERM_RTC_USER_BAN,
  PERM_RTC_USER_READ,
  PERM_SERVER_CONFIG_DELETE,
  PERM_SERVER_CONFIG_READ,
  PERM_SERVER_CONFIG_WRITE,
} from '@/constants/permissions';
import {
  RTC_USERS_MENU_PERMISSIONS,
  SYSTEM_MENU_PERMISSIONS,
  hasAnyPermission,
} from '@/constants/permission-groups';

// 默认权限对象：所有权限均为 false
// Object.freeze() 防止意外修改，确保缓存键的稳定性
const DEFAULT_PERMISSIONS = Object.freeze({
  canAdmin: false,
  canSystemView: false,
  canAdminUserView: false,
  canAdminUserEdit: false,
  canAdminUserDelete: false,
  canAdminUserRoleEdit: false,
  canAdminRoleView: false,
  canAdminRoleEdit: false,
  canPermissionView: false,
  canPermissionEdit: false,
  canAuditLogView: false,
  canRtcUsersMenu: false,
  canRtcUserView: false,
  canRtcUserBan: false,
  canRtcSessionView: false,
  canRtcMessageView: false,
  canServerConfigView: false,
  canServerConfigEdit: false,
  canServerConfigDelete: false,
  canDashboardView: false,
} as const);

// Cache for computed permissions to avoid redundant calculations on every route change.
// Module-level variables persist across re-renders but reset on HMR/page reload.
// This is intentional: cache is invalidated when initialState changes (e.g., after login/logout).
//
// Type annotation uses explicit interface to avoid circular reference with ReturnType<typeof access>.
// Object.freeze() returns Readonly<T>, which we need to unwrap for cache storage.
// Using a mapped type to convert all property values to boolean while preserving keys.
type AccessResult = {
  readonly [K in keyof typeof DEFAULT_PERMISSIONS]: boolean;
};

let _cachedPermissions: Readonly<AccessResult> | null = null;
let _cachedPermissionsKey: string | undefined;
let _cachedPermissionsTimestamp = 0;

/**
 * Maximum cache duration for permissions (1 minute).
 *
 * Even if currentUser hasn't changed, permissions may be modified
 * on the server side (e.g., role changes by another admin). This TTL ensures
 * the client eventually picks up server-side changes.
 *
 * Security: Reduced from 5 minutes to 1 minute to minimize the window
 * where stale permissions could be used after server-side changes.
 */
const PERMISSION_CACHE_MAX_AGE_MS = 60 * 1000;

/**
 * Clear the permission cache.
 *
 * This should be called when the user logs out or when permissions
 * are known to have changed (e.g., after a role update).
 */
export function clearPermissionCache(): void {
  _cachedPermissions = null;
  _cachedPermissionsKey = undefined;
  _cachedPermissionsTimestamp = 0;
}

/**
 * Generate a cache key from currentUser based on identity fields.
 *
 * Uses deep comparison of key fields (id, access, roles, permissions) rather than
 * reference equality to detect meaningful changes. This ensures cache
 * invalidation when user properties are modified in-place.
 */
function getPermissionCacheKey(
  user: API.CurrentUser | undefined,
): string | undefined {
  if (!user) return undefined;

  // Extract key identity fields for cache key generation
  const roleId =
    user.roles
      ?.map((r) => r.id)
      .sort()
      .join(',') ?? '';
  // Include permissions in cache key to differentiate users with different permission sets
  const perms =
    user.permissions instanceof Set
      ? Array.from(user.permissions).sort().join(',')
      : '';
  return `${user.id ?? ''}:${user.access ?? ''}:${roleId}:${perms}`;
}

export default function access(
  initialState: { currentUser?: API.CurrentUser } | undefined,
): Readonly<AccessResult> {
  const { currentUser } = initialState ?? {};
  const now = Date.now();

  // Freeze currentUser to prevent mutable object vulnerabilities.
  // If any code mutates currentUser in-place, the cache won't detect the change
  // because it uses reference equality (===). Freezing ensures immutability.
  if (currentUser && !Object.isFrozen(currentUser)) {
    Object.freeze(currentUser);
  }

  // Generate cache key from identity fields (id, access, roles)
  const cacheKey = getPermissionCacheKey(currentUser);

  // Return cached result if currentUser hasn't changed AND cache hasn't expired
  if (
    _cachedPermissions &&
    _cachedPermissionsKey === cacheKey &&
    now - _cachedPermissionsTimestamp < PERMISSION_CACHE_MAX_AGE_MS
  ) {
    return _cachedPermissions;
  }

  // 如果没有管理员信息，返回所有权限为 false
  if (!currentUser) {
    _cachedPermissions = DEFAULT_PERMISSIONS;
    _cachedPermissionsKey = cacheKey;
    _cachedPermissionsTimestamp = now;
    return DEFAULT_PERMISSIONS;
  }

  // 获取权限集合（Set<string>，O(1) 查询）
  // 向后兼容：如果 permissions 为 undefined（旧后端），基于 access 字段判断
  const perms = currentUser.permissions;

  // 防御性检查：向后兼容旧后端（无 permissions 字段）+ 防止类型错误
  // 当前所有调用路径都通过 buildCurrentUser()，它始终将 permissions 设为 Set。
  if (perms === undefined) {
    const isAdmin = currentUser.access === 'admin';
    const result = isAdmin
      ? Object.freeze({ ...DEFAULT_PERMISSIONS, canAdmin: true })
      : DEFAULT_PERMISSIONS; // DEFAULT_PERMISSIONS is already frozen
    _cachedPermissions = result;
    _cachedPermissionsKey = cacheKey;
    _cachedPermissionsTimestamp = now;
    return result;
  }

  // 运行时类型检查，确保 permissions 是 Set 类型
  if (!(perms instanceof Set)) {
    console.error(
      '[access] currentUser.permissions is not a Set. ' +
        'This may indicate a backend API change or data corruption. ' +
        'Returning all permissions as false.',
      { actualType: typeof perms, value: perms },
    );
    _cachedPermissions = DEFAULT_PERMISSIONS;
    _cachedPermissionsKey = cacheKey;
    _cachedPermissionsTimestamp = now;
    return DEFAULT_PERMISSIONS;
  }

  // 各个权限点（设计文档定义的 13 个权限点）
  const canAdminUserView = perms.has(PERM_ADMIN_USER_READ);
  const canAdminUserEdit = perms.has(PERM_ADMIN_USER_WRITE);
  const canAdminUserDelete = perms.has(PERM_ADMIN_USER_DELETE);
  const canAdminUserRoleEdit = perms.has(PERM_ADMIN_USER_ROLE_WRITE);
  const canAdminRoleView = perms.has(PERM_ROLE_READ);
  const canAdminRoleEdit = perms.has(PERM_ROLE_WRITE);
  const canPermissionView = perms.has(PERM_PERMISSION_READ);
  const canPermissionEdit = perms.has(PERM_PERMISSION_WRITE);
  const canAuditLogView = perms.has(PERM_AUDIT_LOG_READ);
  const canRtcUserView = perms.has(PERM_RTC_USER_READ);
  const canRtcUserBan = perms.has(PERM_RTC_USER_BAN);
  const canRtcSessionView = perms.has(PERM_RTC_SESSION_READ);
  const canRtcMessageView = perms.has(PERM_RTC_MESSAGE_READ);
  const canServerConfigView = perms.has(PERM_SERVER_CONFIG_READ);
  const canServerConfigEdit = perms.has(PERM_SERVER_CONFIG_WRITE);
  const canServerConfigDelete = perms.has(PERM_SERVER_CONFIG_DELETE);
  const canDashboardView = perms.has(PERM_DASHBOARD_READ);

  // canAdmin: 优先检查角色，权限作为 fallback
  //
  // 设计决策：避免将"管理员用户写权限"等同于"管理员身份"，防止权限提升
  // - 新后端（返回 roles）：严格基于角色判断，权限检查被禁用
  // - 旧后端（无 roles）：基于权限判断（向后兼容，逐步废弃）
  //
  // 安全约束：当后端已返回 roles 字段时，禁止回退到权限检查。
  // 即使用户拥有 PERM_ADMIN_USER_WRITE 权限，如果其角色不是 admin，
  // canAdmin 也必须为 false。这是为了防止权限提升攻击——拥有某个写权限
  // 不应自动获得完整的管理员身份。
  //
  // P0-2 修复：仅基于 id === 'admin' 判断，避免 name 字段被伪造导致误判
  const hasRolesData = currentUser.roles !== undefined;
  const isAdminRole = currentUser.roles?.some((r) => r.id === 'admin');

  // 防御性日志：当 name === 'admin' 但 id !== 'admin' 时输出警告
  // 这可能表示后端数据异常或角色配置错误
  if (hasRolesData && !isAdminRole) {
    const suspiciousAdminName = currentUser.roles?.some(
      (r) => r.name === 'admin',
    );
    if (suspiciousAdminName) {
      console.warn(
        '[access] Detected role with name="admin" but id!=="admin". ' +
          'This may indicate a backend data inconsistency. ' +
          'Only role id==="admin" is treated as admin.',
        { roles: currentUser.roles },
      );
    }
  }

  const canAdmin = hasRolesData
    ? !!isAdminRole
    : perms.has(PERM_ADMIN_USER_WRITE);

  /**
   * System Management Menu Visibility (Composite Permission)
   *
   * Business Rule:
   * A user can see the System menu if they have the admin role OR possess
   * at least one system-level read permission. This follows the "least
   * privilege" principle — users only see the sub-menus they have access to,
   * but the parent menu remains visible as long as they have at least one
   * system-level permission.
   *
   * Design Rationale:
   * - The admin role is explicitly included to ensure super-admins without
   *   fine-grained permissions can still access the system menu
   * - This is an OR relationship, not AND — any single permission grants visibility
   * - Write/delete permissions are NOT included because they imply read access
   *
   * Permission Group:
   * Defined in `src/constants/permission-groups.ts` as SYSTEM_MENU_PERMISSIONS
   * for centralized management and audit purposes.
   *
   * Related:
   * - config/routes.ts: /system route uses this for menu visibility
   * - src/constants/permission-groups.ts: SYSTEM_MENU_PERMISSIONS definition
   * - src/pages/system/index.tsx: Permission-based sub-page routing
   */
  const canSystemView =
    isAdminRole || hasAnyPermission(perms, SYSTEM_MENU_PERMISSIONS);

  /**
   * RTC Users Management Menu Visibility (Composite Permission)
   *
   * Business Rule:
   * A user can see the RTC Users menu if they possess at least one
   * RTC-related permission (user read, user ban, session read, or message read).
   *
   * Design Rationale:
   * - Solves parent-child route permission mismatch: parent route uses this
   *   composite permission while child routes use specific permissions
   * - Without this, a user with only canRtcUserBan (but not canRtcUserView)
   *   couldn't see the menu, even though they have access to child routes
   * - This is an OR relationship — any single RTC permission grants visibility
   *
   * Permission Group:
   * Defined in `src/constants/permission-groups.ts` as RTC_USERS_MENU_PERMISSIONS
   * for centralized management and audit purposes.
   *
   * Related:
   * - config/routes.ts: /rtc-users route uses this for menu visibility
   * - src/constants/permission-groups.ts: RTC_USERS_MENU_PERMISSIONS definition
   */
  const canRtcUsersMenu = hasAnyPermission(
    perms,
    RTC_USERS_MENU_PERMISSIONS,
  );

  const result: AccessResult = {
    // canAdmin: Priority check on admin role, permissions as fallback
    // Design: Avoid equating "admin_user:write" with "admin identity" to prevent privilege escalation
    // Semantics: Users with admin role or admin_user:write permission can access canAdmin-guarded routes/features
    canAdmin,

    // System management menu visibility
    canSystemView,

    // Admin user management
    canAdminUserView,
    canAdminUserEdit,
    canAdminUserDelete,

    // Admin user role management
    canAdminUserRoleEdit,

    // Admin role management (no canAdminRoleDelete in design doc; delete uses canAdminRoleEdit)
    canAdminRoleView,
    canAdminRoleEdit,

    // Permission management (no canPermissionDelete in design doc; delete uses canPermissionEdit)
    canPermissionView,
    canPermissionEdit,

    // Audit log
    canAuditLogView,

    // RTC users menu visibility (composite: any RTC permission grants visibility)
    canRtcUsersMenu,

    // RTC user management
    canRtcUserView,
    canRtcUserBan,

    // RTC session and message management
    canRtcSessionView,
    canRtcMessageView,

    // Server configuration management
    canServerConfigView,
    canServerConfigEdit,
    canServerConfigDelete,

    // Dashboard
    canDashboardView,
  };

  // Freeze the result to prevent external mutation, ensuring cache integrity.
  Object.freeze(result);

  _cachedPermissions = result;
  _cachedPermissionsKey = cacheKey;
  _cachedPermissionsTimestamp = now;
  return result;
}
