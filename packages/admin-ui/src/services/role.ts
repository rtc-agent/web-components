import { request } from '@umijs/max';
import type { RoleInfo } from './admin-auth';

/** 角色列表查询参数 */
export interface RoleListParams {
  page?: number;
  page_size?: number;
  keyword?: string;
}

/** 角色列表响应 */
export interface RoleListResponse {
  items: RoleInfo[];
  total: number;
}

/** 创建角色参数 */
export interface CreateRoleParams {
  name: string;
  display_name: string;
  description?: string;
}

/** 更新角色参数 */
export interface UpdateRoleParams {
  display_name?: string;
  description?: string;
  is_enabled?: boolean;
}

/**
 * 查询角色列表
 * GET /api/roles
 */
export async function getRoleList(params?: RoleListParams) {
  return request<RoleListResponse>('/api/roles', {
    method: 'GET',
    params,
  });
}

/**
 * 查询单个角色
 * GET /api/roles/:id
 */
export async function getRole(id: string) {
  return request<RoleInfo>(`/api/roles/${id}`, {
    method: 'GET',
  });
}

/**
 * 创建角色
 * POST /api/roles
 */
export async function createRole(body: CreateRoleParams) {
  return request<RoleInfo>('/api/roles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * 更新角色
 * PUT /api/roles/:id
 */
export async function updateRole(id: string, body: UpdateRoleParams) {
  return request<RoleInfo>(`/api/roles/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * 部分更新角色
 * PATCH /api/roles/:id
 */
export async function patchRole(id: string, body: UpdateRoleParams) {
  return request<RoleInfo>(`/api/roles/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * 删除角色
 * DELETE /api/roles/:id
 */
export async function deleteRole(id: string) {
  return request<{ success: boolean }>(`/api/roles/${id}`, {
    method: 'DELETE',
  });
}
