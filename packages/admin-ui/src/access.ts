/**
 * @see https://umijs.org/docs/max/access#access
 * 基于管理员角色的动态权限定义
 */

// 默认权限对象：所有权限均为 false
const DEFAULT_PERMISSIONS = {
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
} as const;

export default function access(
  initialState: { currentUser?: API.CurrentUser } | undefined,
) {
  const { currentUser } = initialState ?? {};

  // 如果没有管理员信息，返回所有权限为 false
  if (!currentUser) {
    return DEFAULT_PERMISSIONS;
  }

  // 获取权限集合（Set<string>，O(1) 查询）
  // 向后兼容：如果 permissions 为 undefined（旧后端），基于 access 字段判断
  const perms = currentUser.permissions;

  // 向后兼容：旧后端可能没有 permissions 字段，只开放 canAdmin
  // 注意：当前所有调用路径都通过 buildCurrentUser()，它始终将 permissions 设为 Set。
  // 此分支作为防御性检查保留：如果有人直接构造 CurrentUser 对象（如测试或未来重构），
  // 此分支可防止因缺少 permissions 字段而导致的运行时错误。
  if (perms === undefined) {
    const isAdmin = currentUser.access === 'admin';
    return isAdmin
      ? { ...DEFAULT_PERMISSIONS, canAdmin: true }
      : DEFAULT_PERMISSIONS;
  }

  // 运行时类型检查，确保 permissions 是 Set 类型
  if (!(perms instanceof Set)) {
    console.error(
      '[access] currentUser.permissions is not a Set, returning all permissions as false',
    );
    return DEFAULT_PERMISSIONS;
  }

  // 各个权限点（设计文档 §6.2 定义的 13 个权限点）
  const canAdminUserView = perms.has('admin_user:read');
  const canAdminUserEdit = perms.has('admin_user:write');
  const canAdminUserDelete = perms.has('admin_user:delete');
  const canAdminUserRoleEdit = perms.has('admin_user_role:write');
  const canAdminRoleView = perms.has('role:read');
  const canAdminRoleEdit = perms.has('role:write');
  const canPermissionView = perms.has('permission:read');
  const canPermissionEdit = perms.has('permission:write');
  const canAuditLogView = perms.has('audit_log:read');
  const canRtcUserView = perms.has('rtc_user:read');
  const canRtcUserBan = perms.has('rtc_user:ban');
  const canRtcSessionView = perms.has('rtc_session:read');
  const canRtcMessageView = perms.has('rtc_message:read');
  const canServerConfigView = perms.has('server_config:read');
  const canServerConfigEdit = perms.has('server_config:write');
  const canServerConfigDelete = perms.has('server_config:delete');
  const canDashboardView = perms.has('dashboard:read');

  // canAdmin 等价于 admin_user:write（需求文档 §6.2）
  // 使用权限检查替代硬编码角色名，避免后端角色名变更导致前端逻辑失效
  const canAdmin = perms.has('admin_user:write');

  return {
    // canAdmin: 等价于 admin_user:write 权限（需求文档 §6.2）
    // 语义：拥有管理员用户写权限的用户即为"管理员"，可访问 canAdmin 守卫的路由/功能
    canAdmin,

    // 系统管理菜单可见性
    // 需求文档 §9.2：admin 角色或拥有任一系统权限的用户可见
    // 实现：canAdmin（权限级管理员）或拥有任一系统权限的用户可见
    // 使用 canAdmin（基于 admin_user:write 权限）替代硬编码角色名 'admin'，
    // 使权限判断完全基于后端授予的权限而非角色名称，提高可维护性。
    canSystemView:
      canAdmin ||
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
  };
}
