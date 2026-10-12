/**
 * @see https://umijs.org/docs/max/access#access
 * 基于管理员角色的动态权限定义
 */
export default function access(
  initialState: { currentUser?: API.CurrentUser } | undefined,
) {
  const { currentUser } = initialState ?? {};

  // 如果没有管理员信息，返回所有权限为 false
  if (!currentUser) {
    return {
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
    };
  }

  // 获取权限集合（Set<string>，O(1) 查询）
  // 向后兼容：如果 permissions 为 undefined（旧后端），基于 access 字段判断
  const perms = currentUser.permissions;

  // 向后兼容：旧后端可能没有 permissions 字段，只开放 canAdmin
  if (perms === undefined) {
    const isAdmin = currentUser.access === 'admin';
    return {
      canAdmin: isAdmin,
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
    };
  }

  // 运行时类型检查，确保 permissions 是 Set 类型
  if (!(perms instanceof Set)) {
    console.error(
      '[access] currentUser.permissions is not a Set, returning all permissions as false',
    );
    return {
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
    };
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

  // 判断是否为管理员（基于管理员角色名称）
  const roleNames = currentUser.roles?.map((r) => r.name) || [];
  const isAdmin = roleNames.includes('admin');

  return {
    // 管理员权限
    // 需求文档 §6.2：canAdmin 应检查 admin_user:write 权限
    canAdmin: perms.has('admin_user:write'),

    // 系统管理菜单可见性
    // 需求文档 §9.2：admin 角色或拥有任一系统权限的用户可见
    // 实现：isAdmin || canAdminUserView || canAdminRoleView || canPermissionView || canAuditLogView || canServerConfigView
    // 观察者（admin_user:read）、运营（role:read）、权限管理员（permission:read）、审计查看者（audit_log:read）、系统配置查看者（server_config:read）均可见
    // 注意：Dashboard 不在 /system 路径下，不应包含 canDashboardView
    canSystemView:
      isAdmin ||
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
