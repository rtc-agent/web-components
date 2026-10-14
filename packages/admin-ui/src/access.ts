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
type AccessResult = {
  canAdmin: boolean;
  canSystemView: boolean;
  canAdminUserView: boolean;
  canAdminUserEdit: boolean;
  canAdminUserDelete: boolean;
  canAdminUserRoleEdit: boolean;
  canAdminRoleView: boolean;
  canAdminRoleEdit: boolean;
  canPermissionView: boolean;
  canPermissionEdit: boolean;
  canAuditLogView: boolean;
  canRtcUsersMenu: boolean;
  canRtcUserView: boolean;
  canRtcUserBan: boolean;
  canRtcSessionView: boolean;
  canRtcMessageView: boolean;
  canServerConfigView: boolean;
  canServerConfigEdit: boolean;
  canServerConfigDelete: boolean;
  canDashboardView: boolean;
};

let _cachedPermissions: Readonly<AccessResult> | null = null;
let _cachedPermissionsKey: API.CurrentUser | undefined;
let _cachedPermissionsTimestamp = 0;

/**
 * Maximum cache duration for permissions (5 minutes).
 *
 * Even if currentUser reference hasn't changed, permissions may be modified
 * on the server side (e.g., role changes by another admin). This TTL ensures
 * the client eventually picks up server-side changes.
 */
const PERMISSION_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

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

  // Return cached result if currentUser hasn't changed AND cache hasn't expired
  if (
    _cachedPermissions &&
    _cachedPermissionsKey === currentUser &&
    now - _cachedPermissionsTimestamp < PERMISSION_CACHE_MAX_AGE_MS
  ) {
    return _cachedPermissions;
  }

  // 如果没有管理员信息，返回所有权限为 false
  if (!currentUser) {
    _cachedPermissions = DEFAULT_PERMISSIONS;
    _cachedPermissionsKey = currentUser;
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
    _cachedPermissionsKey = currentUser;
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
    _cachedPermissionsKey = currentUser;
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
  const hasRolesData = currentUser.roles !== undefined;
  const isAdminRole = currentUser.roles?.some(
    (r) => r.name === 'admin' || r.id === 'admin',
  );
  const canAdmin = hasRolesData
    ? !!isAdminRole
    : perms.has(PERM_ADMIN_USER_WRITE);

  const result = {
    // canAdmin: 优先检查 admin 角色，权限作为 fallback
    // 设计决策：避免将"管理员用户写权限"等同于"管理员身份"，防止权限提升
    // 语义：拥有 admin 角色或 admin_user:write 权限的用户可访问 canAdmin 守卫的路由/功能
    canAdmin,

    // 系统管理菜单可见性
    // 需求文档 §9.2：admin 角色或拥有任一系统读权限的用户可见
    // 实现：admin 角色或拥有任一系统读权限的用户可见
    // 显式包含 isAdminRole，确保即使未配置细粒度权限的超级管理员也能访问系统菜单。
    canSystemView:
      isAdminRole ||
      canAdminUserView ||
      canAdminRoleView ||
      canPermissionView ||
      canAuditLogView ||
      canServerConfigView,

    // 管理员管理
    canAdminUserView,
    canAdminUserEdit,
    canAdminUserDelete,

    // 管理员用户角色管理
    canAdminUserRoleEdit,

    // 管理员角色管理（设计文档未定义 canAdminRoleDelete，删除操作使用 canAdminRoleEdit）
    canAdminRoleView,
    canAdminRoleEdit,

    // 权限管理（设计文档未定义 canPermissionDelete，删除操作使用 canPermissionEdit）
    canPermissionView,
    canPermissionEdit,

    // 审计日志
    canAuditLogView,

    // RTC 用户管理菜单可见性（组合权限：任一子权限满足即可见）
    // 解决父路由使用 canRtcUserView 但子路由使用不同权限导致菜单不可见的问题
    canRtcUsersMenu:
      canRtcUserView || canRtcUserBan || canRtcSessionView || canRtcMessageView,

    // RTC 用户管理
    canRtcUserView,
    canRtcUserBan,

    // RTC 对话与消息管理
    canRtcSessionView,
    canRtcMessageView,

    // 系统配置管理
    canServerConfigView,
    canServerConfigEdit,
    canServerConfigDelete,

    // 仪表盘
    canDashboardView,

    /**
     * 权限复用设计说明
     *
     * RTC 用户配置管理（如 canConfigEdit, canConfigDelete）复用了系统配置权限点
     * （server_config:write, server_config:delete），而非定义独立的权限点。
     *
     * 设计原因：
     * 1. 业务本质：RTC 用户配置是系统配置的一部分（用户层面的配置），与全局系统配置
     *    共享相同的 RBAC 权限模型和审批流程
     * 2. 简化权限模型：避免引入过多细粒度权限点，降低管理员的配置负担
     * 3. 一致性：系统配置和 RTC 用户配置的变更往往需要相同的审批权限级别
     *
     * 使用边界：
     * - canServerConfigEdit/ Delete 同时控制全局系统配置和 RTC 用户配置
     * - 如果需要独立的权限控制（如允许编辑系统配置但不能编辑 RTC 用户配置），
     *   应在此处拆分为独立的权限点
     *
     * 参见：
     * - src/pages/rtc-users/management/index.tsx（权限使用示例）
     * - src/pages/system/configs/index.tsx（系统配置页面）
     */
  };

  // Freeze the result to prevent external mutation, ensuring cache integrity.
  Object.freeze(result);

  _cachedPermissions = result;
  _cachedPermissionsKey = currentUser;
  _cachedPermissionsTimestamp = now;
  return result;
}
