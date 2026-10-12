import { request } from '@umijs/max';

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

/** 权限列表响应 */
export interface PermissionListResponse {
  items: PermissionPolicy[];
  total: number;
  page: number;
  page_size: number;
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
 */
export async function getPermissionList(params?: PermissionListParams) {
  return request<PermissionListResponse>('/api/permissions', {
    method: 'GET',
    params,
  });
}

/**
 * 创建权限策略
 * POST /api/permissions
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
 */
export async function checkPermission(body: CheckPermissionParams) {
  return request<CheckPermissionResponse>('/api/permissions/check', {
    method: 'POST',
    data: body,
  });
}
