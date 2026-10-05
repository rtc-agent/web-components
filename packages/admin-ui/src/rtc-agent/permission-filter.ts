/**
 * 权限过滤模块
 *
 * 根据管理员权限过滤 Functions，只注册管理员有权限使用的 Functions
 */

import type { FunctionDef } from '@rtc-agent/component';

/**
 * 权限定义（与后端 API 返回一致）
 */
export interface Permission {
  resource: string;
  action: string;
}

/**
 * 带权限要求的 Function 定义
 *
 * 扩展 FunctionDef，添加 requiredPermissions 属性
 */
export interface PermissionAwareFunctionDef extends FunctionDef {
  /** 需要的权限列表，为空表示无权限要求（所有管理员可用） */
  requiredPermissions?: Permission[];
}

/**
 * 将权限数组转换为 Set<string>，用于 O(1) 查询
 */
export function buildPermissionSet(permissions: Permission[]): Set<string> {
  return new Set(permissions.map((p) => `${p.resource}:${p.action}`));
}

/**
 * 检查管理员是否拥有 Function 所需的所有权限
 */
export function hasRequiredPermissions(
  fn: PermissionAwareFunctionDef,
  userPermissionSet: Set<string>,
): boolean {
  // 无权限要求 = 所有管理员可用
  if (!fn.requiredPermissions || fn.requiredPermissions.length === 0) {
    return true;
  }

  // 检查管理员是否拥有所有需要的权限
  return fn.requiredPermissions.every((p) =>
    userPermissionSet.has(`${p.resource}:${p.action}`),
  );
}

/**
 * 过滤 Functions：只保留管理员有权限使用的
 */
export function filterFunctionsByPermissions<
  T extends PermissionAwareFunctionDef,
>(functions: T[], userPermissions: Permission[]): T[] {
  const userPermissionSet = buildPermissionSet(userPermissions);

  const filtered = functions.filter((fn) =>
    hasRequiredPermissions(fn, userPermissionSet),
  );

  console.log(
    `[Permission Filter] ${filtered.length}/${functions.length} functions available`,
  );

  return filtered;
}

/**
 * 过滤 Function Group：过滤每个 group 内的 functions，移除空的 group
 */
export function filterGroupsByPermissions<T extends PermissionAwareFunctionDef>(
  groups: Array<{ name: string; description?: string; functions: T[] }>,
  userPermissions: Permission[],
): Array<{ name: string; description?: string; functions: T[] }> {
  return groups
    .map((group) => ({
      ...group,
      functions: filterFunctionsByPermissions(group.functions, userPermissions),
    }))
    .filter((group) => group.functions.length > 0); // 移除空的 group
}
