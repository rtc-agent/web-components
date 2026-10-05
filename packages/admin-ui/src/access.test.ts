import access from './access';

describe('access', () => {
  describe('when initialState is undefined', () => {
    it('should return all permissions as false', () => {
      const result = access(undefined);

      expect(result.canAdmin).toBe(false);
      expect(result.canSystemView).toBe(false);
      expect(result.canUserView).toBe(false);
      expect(result.canUserEdit).toBe(false);
      expect(result.canUserDelete).toBe(false);
      expect(result.canRoleView).toBe(false);
      expect(result.canRoleEdit).toBe(false);
      expect(result.canPermissionView).toBe(false);
      expect(result.canPermissionEdit).toBe(false);
      expect(result.canAuditLogView).toBe(false);
    });
  });

  describe('when currentUser is undefined', () => {
    it('should return all permissions as false', () => {
      const result = access({});

      expect(result.canAdmin).toBe(false);
      expect(result.canSystemView).toBe(false);
      expect(result.canUserView).toBe(false);
      expect(result.canUserEdit).toBe(false);
      expect(result.canUserDelete).toBe(false);
      expect(result.canRoleView).toBe(false);
      expect(result.canRoleEdit).toBe(false);
      expect(result.canPermissionView).toBe(false);
      expect(result.canPermissionEdit).toBe(false);
      expect(result.canAuditLogView).toBe(false);
    });
  });

  describe('when user has admin access (backward compatibility)', () => {
    it('should return canAdmin as true when no permissions (old backend)', () => {
      const result = access({
        currentUser: {
          access: 'admin',
          // permissions is undefined - old backend
        },
      });

      expect(result.canAdmin).toBe(true);
      expect(result.canSystemView).toBe(false);
    });

    it('should return canAdmin as false when permissions exist but no user:write', () => {
      const result = access({
        currentUser: {
          access: 'admin',
          permissions: new Set(['role:read']), // has permissions but no user:write
        },
      });

      expect(result.canAdmin).toBe(false); // should be false because no user:write
      expect(result.canSystemView).toBe(true); // but can still view system
    });
  });

  describe('when user has permissions', () => {
    it('should return correct permissions based on permission set', () => {
      const permissionSet = new Set(['user:read', 'user:write', 'role:read']);

      const result = access({
        currentUser: {
          access: 'user',
          permissions: permissionSet,
          roles: [{ id: '2', name: 'operator', display_name: '运营' }],
        },
      });

      // canAdmin 基于 user:write 权限（需求文档 §6.2）
      expect(result.canAdmin).toBe(true); // 因为有 user:write
      expect(result.canSystemView).toBe(true); // 因为有 role:read
      expect(result.canUserView).toBe(true);
      expect(result.canUserEdit).toBe(true);
      expect(result.canUserDelete).toBe(false);
      expect(result.canRoleView).toBe(true);
      expect(result.canRoleEdit).toBe(false);
      expect(result.canPermissionView).toBe(false);
      expect(result.canPermissionEdit).toBe(false);
      expect(result.canAuditLogView).toBe(false);
    });

    it('should return all permissions for admin role', () => {
      const permissionSet = new Set([
        'user:read',
        'user:write',
        'user:delete',
        'role:read',
        'role:write',
        'permission:read',
        'permission:write',
        'audit_log:read',
      ]);

      const result = access({
        currentUser: {
          access: 'admin',
          permissions: permissionSet,
          roles: [{ id: '1', name: 'admin', display_name: '管理员' }],
        },
      });

      expect(result.canAdmin).toBe(true);
      expect(result.canSystemView).toBe(true);
      expect(result.canUserView).toBe(true);
      expect(result.canUserEdit).toBe(true);
      expect(result.canUserDelete).toBe(true);
      expect(result.canRoleView).toBe(true);
      expect(result.canRoleEdit).toBe(true);
      expect(result.canPermissionView).toBe(true);
      expect(result.canPermissionEdit).toBe(true);
      expect(result.canAuditLogView).toBe(true);
    });

    it('should return limited permissions for operator role', () => {
      const permissionSet = new Set(['user:read', 'user:write', 'role:read']);

      const result = access({
        currentUser: {
          access: 'user',
          permissions: permissionSet,
          roles: [{ id: '2', name: 'operator', display_name: '运营' }],
        },
      });

      expect(result.canAdmin).toBe(true); // 因为有 user:write（需求文档 §6.2）
      expect(result.canSystemView).toBe(true); // 因为有 role:read
      expect(result.canUserView).toBe(true);
      expect(result.canUserEdit).toBe(true);
      expect(result.canUserDelete).toBe(false);
      expect(result.canRoleView).toBe(true);
      expect(result.canRoleEdit).toBe(false);
      expect(result.canPermissionView).toBe(false);
      expect(result.canPermissionEdit).toBe(false);
      expect(result.canAuditLogView).toBe(false);
    });

    it('should return minimal permissions for viewer role', () => {
      const permissionSet = new Set(['user:read']);

      const result = access({
        currentUser: {
          access: 'user',
          permissions: permissionSet,
          roles: [{ id: '3', name: 'viewer', display_name: '观察者' }],
        },
      });

      expect(result.canAdmin).toBe(false);
      expect(result.canSystemView).toBe(false); // 只有 user:read，没有 role/permission/audit_log 权限
      expect(result.canUserView).toBe(true);
      expect(result.canUserEdit).toBe(false);
      expect(result.canUserDelete).toBe(false);
      expect(result.canRoleView).toBe(false);
      expect(result.canRoleEdit).toBe(false);
      expect(result.canPermissionView).toBe(false);
      expect(result.canPermissionEdit).toBe(false);
      expect(result.canAuditLogView).toBe(false);
    });
  });

  describe('when permissions is empty set', () => {
    it('should return all permissions as false except canAdmin based on access field', () => {
      const permissionSet = new Set<string>();

      const result = access({
        currentUser: {
          access: 'user',
          permissions: permissionSet,
        },
      });

      expect(result.canAdmin).toBe(false);
      expect(result.canSystemView).toBe(false);
      expect(result.canUserView).toBe(false);
      expect(result.canUserEdit).toBe(false);
      expect(result.canUserDelete).toBe(false);
      expect(result.canRoleView).toBe(false);
      expect(result.canRoleEdit).toBe(false);
      expect(result.canPermissionView).toBe(false);
      expect(result.canPermissionEdit).toBe(false);
      expect(result.canAuditLogView).toBe(false);
    });
  });

  describe('when permissions is undefined (backward compatibility)', () => {
    it('should return all permissions as false except canAdmin based on access field', () => {
      const result = access({
        currentUser: {
          access: 'admin',
          // permissions is undefined
        },
      });

      expect(result.canAdmin).toBe(true);
      expect(result.canSystemView).toBe(false);
      expect(result.canUserView).toBe(false);
      expect(result.canUserEdit).toBe(false);
      expect(result.canUserDelete).toBe(false);
      expect(result.canRoleView).toBe(false);
      expect(result.canRoleEdit).toBe(false);
      expect(result.canPermissionView).toBe(false);
      expect(result.canPermissionEdit).toBe(false);
      expect(result.canAuditLogView).toBe(false);
    });
  });

  describe('canSystemView logic', () => {
    it('should be true when user has role:read', () => {
      const result = access({
        currentUser: {
          permissions: new Set(['role:read']),
        },
      });
      expect(result.canSystemView).toBe(true);
    });

    it('should be true when user has permission:read', () => {
      const result = access({
        currentUser: {
          permissions: new Set(['permission:read']),
        },
      });
      expect(result.canSystemView).toBe(true);
    });

    it('should be true when user has audit_log:read', () => {
      const result = access({
        currentUser: {
          permissions: new Set(['audit_log:read']),
        },
      });
      expect(result.canSystemView).toBe(true);
    });

    it('should be false when user has no system permissions', () => {
      const result = access({
        currentUser: {
          permissions: new Set<string>(),
        },
      });
      expect(result.canSystemView).toBe(false);
    });
  });
});
