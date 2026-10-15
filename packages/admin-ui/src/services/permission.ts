import { request } from '@umijs/max';
import type { PaginatedResponse } from '@/services/types';

/**
 * A single permission entry: which resource can perform which action.
 * Example: { resource: "rtc_user", action: "read" }
 */
export interface PermissionInfo {
  /** Resource type being protected (e.g. "rtc_user", "admin_user") */
  resource: string;
  /** Allowed action (e.g. "read", "write", "delete", "ban") */
  action: string;
}

/**
 * 权限策略
 * 注意：设计文档 §5.4 使用 role (name)，但实际实现使用 role_id (UUID)
 * UUID 更稳定（不可变、唯一），建议使用 role_id
 */
export interface PermissionPolicy {
  role_id: string;
  resource: string;
  action: string;
}

/** 权限列表查询参数 */
export interface PermissionListParams {
  page?: number;
  page_size?: number;
  role_id?: string;
  resource?: string;
}

/** 权限检查参数 */
export interface CheckPermissionParams {
  user_id: string;
  resource: string;
  action: string;
}

/** 权限检查响应 */
export interface CheckPermissionResponse {
  allowed: boolean;
}

/**
 * 查询权限策略列表
 * GET /api/permissions
 *
 * @param params - 查询参数（分页、role_id、resource 筛选）
 * @returns Promise<PaginatedResponse<PermissionPolicy>> 分页的权限策略列表
 */
export async function getPermissionList(params?: PermissionListParams) {
  return request<PaginatedResponse<PermissionPolicy>>('/api/permissions', {
    method: 'GET',
    params,
  });
}

/**
 * 创建权限策略
 * POST /api/permissions
 *
 * @param body - 权限策略定义（role_id、resource、action）
 * @returns Promise<{ status: string }> 创建状态
 */
export async function createPermission(body: PermissionPolicy) {
  return request<{ status: string }>('/api/permissions', {
    method: 'POST',
    data: body,
  });
}

/**
 * 删除权限策略
 * DELETE /api/permissions/:role_id/:resource/:action
 *
 * @param policy - 要删除的权限策略（role_id、resource、action）
 * @returns Promise<{ status: string }> 删除状态
 */
export async function deletePermission(policy: PermissionPolicy) {
  return request<{ status: string }>(
    `/api/permissions/${encodeURIComponent(policy.role_id)}/${encodeURIComponent(policy.resource)}/${encodeURIComponent(policy.action)}`,
    {
      method: 'DELETE',
    },
  );
}

/**
 * 检查管理员权限
 * POST /api/permissions/check
 *
 * @param body - 权限检查参数（user_id、resource、action）
 * @returns Promise<CheckPermissionResponse> 权限检查结果（allowed: boolean）
 */
export async function checkPermission(body: CheckPermissionParams) {
  return request<CheckPermissionResponse>('/api/permissions/check', {
    method: 'POST',
    data: body,
  });
}
