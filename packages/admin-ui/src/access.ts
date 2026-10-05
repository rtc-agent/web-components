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
      canAdminRoleView: false,
      canAdminRoleEdit: false,
      canPermissionView: false,
      canPermissionEdit: false,
      canAuditLogView: false,
    };
  }

  // 获取权限集合（Set<string>，O(1) 查询）
  const perms = currentUser.permissions as Set<string> | undefined;

  // 各个权限点（设计文档 §6.2 定义的 13 个权限点）
  const canAdminUserView = perms?.has('admin_user:read') ?? false;
  const canAdminUserEdit = perms?.has('admin_user:write') ?? false;
  const canAdminUserDelete = perms?.has('admin_user:delete') ?? false;
  const canAdminRoleView = perms?.has('role:read') ?? false;
  const canAdminRoleEdit = perms?.has('role:write') ?? false;
  const canPermissionView = perms?.has('permission:read') ?? false;
  const canPermissionEdit = perms?.has('permission:write') ?? false;
  const canAuditLogView = perms?.has('audit_log:read') ?? false;

  // 判断是否为管理员（基于管理员角色名称）
  const roleNames = currentUser.roles?.map((r) => r.name) || [];
  const isAdmin = roleNames.includes('admin');

  return {
    // 管理员权限
    // 需求文档 §6.2：canAdmin 应检查 admin_user:write 权限
    // 旧后端（perms 为 undefined）：基于 access 字段判断
    // 新后端（perms 为 Set）：基于 admin_user:write 权限判断
    canAdmin:
      perms === undefined
        ? currentUser.access === 'admin' // 旧后端兼容
        : perms.has('admin_user:write'), // 新后端：基于 admin_user:write 权限

    // 系统管理菜单可见性
    // 需求文档 §9.2：admin 角色或拥有任一系统权限的用户可见
    // 实现：isAdmin || canAdminUserView || canAdminRoleView || canPermissionView || canAuditLogView
    // 观察者（admin_user:read）、运营（role:read）、权限管理员（permission:read）、审计查看者（audit_log:read）均可见
    canSystemView:
      isAdmin || canAdminUserView || canAdminRoleView || canPermissionView || canAuditLogView,

    // 管理员管理
    canAdminUserView,
    canAdminUserEdit,
    canAdminUserDelete,

    // 管理员角色管理（设计文档未定义 canAdminRoleDelete，删除操作使用 canAdminRoleEdit）
    canAdminRoleView,
    canAdminRoleEdit,

    // 权限管理（设计文档未定义 canPermissionDelete，删除操作使用 canPermissionEdit）
    canPermissionView,
    canPermissionEdit,

    // 审计日志
    canAuditLogView,
  };
}
