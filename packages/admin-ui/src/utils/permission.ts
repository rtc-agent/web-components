/**
 * 权限相关工具函数
 */

import type { UserInfo } from '@/services/types';

/**
 * Build CurrentUser object from UserInfo
 * Centralizes the conversion logic to avoid duplication across:
 * - getInitialState (app.tsx)
 * - refreshTokenAndUpdatePermissions (requestErrorConfig.ts)
 * - usePermissionRefresh hook
 */
export function buildCurrentUser(userInfo: UserInfo): API.CurrentUser {
  const permissionsArray = userInfo.permissions || [];
  const permissionSet = buildPermissionSet(permissionsArray);
  const access = computeAccessLevel(userInfo.roles, permissionsArray);

  return {
    userid: userInfo.id,
    name: userInfo.name,
    avatar: userInfo.avatar_url,
    email: userInfo.email,
    access,
    roles: userInfo.roles,
    permissions: permissionSet,
  };
}

/**
 * 构建权限集合（Set<string>，O(1) 查询）
 * 将后端返回的权限数组转换为 Set<string>，格式为 "resource:action"
 * 过滤掉无效元素（null/undefined 或缺少必要字段）
 *
 * @param permissions 后端返回的权限数组
 * @returns 权限集合
 */
export function buildPermissionSet(
  permissions: Array<{ resource: string; action: string }> | undefined,
): Set<string> {
  return new Set(
    (permissions || [])
      .filter((p) => p?.resource && p.action) // 过滤无效元素
      .map((p) => `${p.resource}:${p.action}`),
  );
}

/**
 * 计算管理员访问级别
 * 向后兼容：旧后端不返回 roles（roles 为 undefined），默认 admin
 * 新后端返回 roles 数组：检查是否包含 admin_user:write 权限来判断管理员身份
 * 使用权限检查替代硬编码角色名 'admin'，与 access.ts 保持一致
 *
 * @param roles 管理员角色数组
 * @param permissions 管理员权限数组（可选，用于权限级判断）
 * @returns 访问级别：'admin' | 'user'
 */
export function computeAccessLevel(
  roles: Array<{ name: string }> | undefined,
  permissions?: Array<{ resource: string; action: string }>,
): 'admin' | 'user' {
  if (roles === undefined) {
    return 'admin'; // 旧后端兼容：不返回 roles，默认 admin
  }

  // 优先基于权限判断：如果拥有 admin_user:write 权限，视为管理员
  // 这避免了后端角色名变更导致前端判断失效
  if (permissions) {
    const hasAdminPermission = permissions.some(
      (p) => p.resource === 'admin_user' && p.action === 'write',
    );
    if (hasAdminPermission) {
      return 'admin';
    }
    // 有权限数据但没有 admin 权限，明确返回 user
    return 'user';
  }

  // Fallback: 无权限数据时，基于角色名判断（向后兼容）
  const roleNames = roles.map((r) => r.name);
  return roleNames.includes('admin') ? 'admin' : 'user';
}
