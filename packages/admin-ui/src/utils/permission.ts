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
  const access = computeAccessLevel(userInfo.roles);

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
 * 新后端返回 roles 数组：根据是否包含 'admin' 管理员角色判断
 *
 * @param roles 管理员角色数组
 * @returns 访问级别：'admin' | 'user'
 */
export function computeAccessLevel(
  roles: Array<{ name: string }> | undefined,
): 'admin' | 'user' {
  if (roles === undefined) {
    return 'admin'; // 旧后端兼容：不返回 roles，默认 admin
  }
  const roleNames = roles.map((r) => r.name);
  return roleNames.includes('admin') ? 'admin' : 'user';
}
