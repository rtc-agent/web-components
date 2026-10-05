/**
 * 权限系统 API Mock 数据
 */

// 角色数据
const roles = [
  {
    id: '1',
    name: 'admin',
    display_name: '管理员',
    description: '系统管理员，拥有所有权限',
    is_system: true,
    is_enabled: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '2',
    name: 'operator',
    display_name: '运营',
    description: '运营人员，负责日常管理',
    is_system: false,
    is_enabled: true,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
  {
    id: '3',
    name: 'viewer',
    display_name: '观察者',
    description: '只读权限',
    is_system: false,
    is_enabled: true,
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z',
  },
];

// 权限策略数据
const permissions = [
  { role_id: '1', resource: 'user', action: 'read' },
  { role_id: '1', resource: 'user', action: 'write' },
  { role_id: '1', resource: 'user', action: 'delete' },
  { role_id: '1', resource: 'role', action: 'read' },
  { role_id: '1', resource: 'role', action: 'write' },
  { role_id: '1', resource: 'role', action: 'delete' },
  { role_id: '1', resource: 'permission', action: 'read' },
  { role_id: '1', resource: 'permission', action: 'write' },
  { role_id: '1', resource: 'permission', action: 'delete' },
  { role_id: '1', resource: 'audit_log', action: 'read' },
  { role_id: '2', resource: 'user', action: 'read' },
  { role_id: '2', resource: 'user', action: 'write' },
  { role_id: '2', resource: 'role', action: 'read' },
  { role_id: '3', resource: 'user', action: 'read' },
];

// 用户数据
const users = [
  {
    id: '1',
    email: 'admin@example.com',
    name: '管理员',
    avatar_url: '',
    roles: [roles[0]],
  },
  {
    id: '2',
    email: 'operator@example.com',
    name: '运营',
    avatar_url: '',
    roles: [roles[1]],
  },
  {
    id: '3',
    email: 'viewer@example.com',
    name: '观察者',
    avatar_url: '',
    roles: [roles[2]],
  },
];

// 审计日志数据
const auditLogs = [
  {
    id: '1',
    operator_id: '1',
    operator_name: '管理员',
    operator_ip: '192.168.1.1',
    event_type: 'create_role',
    resource_type: 'role',
    resource_id: '2',
    details: { role_name: 'operator' },
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: '2',
    operator_id: '1',
    operator_name: '管理员',
    operator_ip: '192.168.1.1',
    event_type: 'assign_role',
    resource_type: 'user',
    resource_id: '2',
    details: { role_name: 'operator' },
    created_at: '2024-01-15T11:00:00Z',
  },
  {
    id: '3',
    operator_id: '1',
    operator_name: '管理员',
    operator_ip: '192.168.1.1',
    event_type: 'create_permission',
    resource_type: 'permission',
    resource_id: null,
    details: { role: 'operator', resource: 'user', action: 'read' },
    created_at: '2024-01-15T12:00:00Z',
  },
];

export default {
  // 角色管理 API
  'GET /api/roles': (req: any, res: any) => {
    res.json({
      success: true,
      data: {
        items: roles,
        total: roles.length,
      },
    });
  },

  'POST /api/roles': (req: any, res: any) => {
    const newRole = {
      id: String(roles.length + 1),
      ...req.body,
      is_system: false,
      is_enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    roles.push(newRole);
    res.json({
      success: true,
      data: newRole,
    });
  },

  'PUT /api/roles/:id': (req: any, res: any) => {
    const { id } = req.params;
    const index = roles.findIndex((r) => r.id === id);
    if (index >= 0) {
      roles[index] = { ...roles[index], ...req.body, updated_at: new Date().toISOString() };
      res.json({
        success: true,
        data: roles[index],
      });
    } else {
      res.json({ success: false, errorMessage: '角色不存在' });
    }
  },

  'PATCH /api/roles/:id': (req: any, res: any) => {
    const { id } = req.params;
    const index = roles.findIndex((r) => r.id === id);
    if (index >= 0) {
      roles[index] = { ...roles[index], ...req.body, updated_at: new Date().toISOString() };
      res.json({
        success: true,
        data: roles[index],
      });
    } else {
      res.json({ success: false, errorMessage: '角色不存在' });
    }
  },

  'DELETE /api/roles/:id': (req: any, res: any) => {
    const { id } = req.params;
    const index = roles.findIndex((r) => r.id === id);
    if (index >= 0) {
      if (roles[index].is_system) {
        res.json({ success: false, errorMessage: '系统角色不可删除' });
      } else {
        roles.splice(index, 1);
        res.json({ success: true, data: { success: true } });
      }
    } else {
      res.json({ success: false, errorMessage: '角色不存在' });
    }
  },

  // 权限管理 API
  'GET /api/permissions': (req: any, res: any) => {
    res.json({
      success: true,
      data: {
        items: permissions,
        total: permissions.length,
      },
    });
  },

  'POST /api/permissions': (req: any, res: any) => {
    const newPermission = req.body;
    permissions.push(newPermission);
    res.json({
      success: true,
      data: newPermission,
    });
  },

  'DELETE /api/permissions': (req: any, res: any) => {
    const { role_id, resource, action } = req.body;
    const index = permissions.findIndex(
      (p) => p.role_id === role_id && p.resource === resource && p.action === action,
    );
    if (index >= 0) {
      permissions.splice(index, 1);
      res.json({ success: true, data: { success: true } });
    } else {
      res.json({ success: false, errorMessage: '权限策略不存在' });
    }
  },

  // 用户管理 API
  'GET /api/users': (req: any, res: any) => {
    res.json({
      success: true,
      data: {
        items: users,
        total: users.length,
      },
    });
  },

  'GET /api/users/:id/roles': (req: any, res: any) => {
    const { id } = req.params;
    const user = users.find((u) => u.id === id);
    if (user) {
      // 返回 UserRoleAssignment[] 格式，与后端 API 一致
      const items = user.roles.map((role) => ({
        user_id: user.id,
        role_id: role.id,
        role_name: role.display_name || role.name,
        assigned_at: role.created_at || new Date().toISOString(),
      }));
      res.json({
        success: true,
        data: {
          items,
          total: items.length,
        },
      });
    } else {
      res.json({ success: false, errorMessage: '用户不存在' });
    }
  },

  'POST /api/users/:id/roles': (req: any, res: any) => {
    const { id } = req.params;
    const { role_ids } = req.body;
    const user = users.find((u) => u.id === id);
    if (user) {
      user.roles = role_ids.map((roleId: string) => roles.find((r) => r.id === roleId)).filter(Boolean);
      res.json({ success: true, data: { success: true } });
    } else {
      res.json({ success: false, errorMessage: '用户不存在' });
    }
  },

  'DELETE /api/users/:id/roles/:roleId': (req: any, res: any) => {
    const { id, roleId } = req.params;
    const user = users.find((u) => u.id === id);
    if (user) {
      user.roles = user.roles.filter((r) => r.id !== roleId);
      res.json({ success: true, data: { success: true } });
    } else {
      res.json({ success: false, errorMessage: '用户不存在' });
    }
  },

  // 审计日志 API
  'GET /api/audit-logs': (req: any, res: any) => {
    res.json({
      success: true,
      data: {
        items: auditLogs,
        total: auditLogs.length,
      },
    });
  },
};
