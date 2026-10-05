/**
 * @see https://umijs.org/docs/max/access#access
 * 基于角色的动态权限定义
 */
export default function access(
  initialState: { currentUser?: API.CurrentUser } | undefined,
) {
  const { currentUser } = initialState ?? {};

  // 如果没有用户信息，返回所有权限为 false
  if (!currentUser) {
    return {
      canAdmin: false,
      canSystemView: false,
      canUserView: false,
      canUserEdit: false,
      canUserDelete: false,
      canRoleView: false,
      canRoleEdit: false,
      canPermissionView: false,
      canPermissionEdit: false,
      canAuditLogView: false,
    };
  }

  // 获取权限集合（Set<string>，O(1) 查询）
  const perms = currentUser.permissions as Set<string> | undefined;

  // 各个权限点（设计文档 §6.2 定义的 13 个权限点）
  const canUserView = perms?.has('user:read') ?? false;
  const canUserEdit = perms?.has('user:write') ?? false;
  const canUserDelete = perms?.has('user:delete') ?? false;
  const canRoleView = perms?.has('role:read') ?? false;
  const canRoleEdit = perms?.has('role:write') ?? false;
  const canPermissionView = perms?.has('permission:read') ?? false;
  const canPermissionEdit = perms?.has('permission:write') ?? false;
  const canAuditLogView = perms?.has('audit_log:read') ?? false;

  // 判断是否为管理员（基于角色名称）
  const roleNames = currentUser.roles?.map((r) => r.name) || [];
  const isAdmin = roleNames.includes('admin');

  return {
    // 管理员权限
    // 需求文档 §6.2：canAdmin 应检查 user:write 权限
    // 旧后端（perms 为 undefined）：基于 access 字段判断
    // 新后端（perms 为 Set）：基于 user:write 权限判断
    canAdmin:
      perms === undefined
        ? currentUser.access === 'admin' // 旧后端兼容
        : perms.has('user:write'), // 新后端：基于 user:write 权限

    // 系统管理菜单可见性
    // 需求文档 §9.2：管理员看到所有菜单，运营只看到用户列表，观察者看不到管理菜单
    // 实现：admin 角色隐式拥有所有权限，或基于 canRoleView || canPermissionView || canAuditLogView
    // 运营有 role:read，所以能看到系统管理菜单；观察者只有 user:read，看不到
    canSystemView:
      isAdmin || canRoleView || canPermissionView || canAuditLogView,

    // 用户管理
    canUserView,
    canUserEdit,
    canUserDelete,

    // 角色管理（设计文档未定义 canRoleDelete，删除操作使用 canRoleEdit）
    canRoleView,
    canRoleEdit,

    // 权限管理（设计文档未定义 canPermissionDelete，删除操作使用 canPermissionEdit）
    canPermissionView,
    canPermissionEdit,

    // 审计日志
    canAuditLogView,
  };
}
