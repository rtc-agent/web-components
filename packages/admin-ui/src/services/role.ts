import { request } from '@umijs/max';
import type { RoleInfo } from './admin-auth';
import type { PermissionPolicy } from './permission';

/** 管理员角色列表查询参数 */
export interface RoleListParams {
  page?: number;
  page_size?: number;
  keyword?: string;
}

/** 管理员角色列表响应 */
export interface RoleListResponse {
  items: RoleInfo[];
  total: number;
  page: number;
  page_size: number;
}

/** 创建管理员角色参数 */
export interface CreateRoleParams {
  name: string;
  display_name: string;
  description?: string;
}

/** 更新管理员角色参数 */
export interface UpdateRoleParams {
  display_name?: string;
  description?: string;
  is_enabled?: boolean;
}

/**
 * 查询管理员角色列表
 * GET /api/roles
 */
export async function getRoleList(params?: RoleListParams) {
  return request<RoleListResponse>('/api/roles', {
    method: 'GET',
    params,
  });
}

/**
 * 查询单个管理员角色
 * GET /api/roles/:id
 */
export async function getRole(id: string) {
  return request<RoleInfo>(`/api/roles/${id}`, {
    method: 'GET',
  });
}

/**
 * 创建管理员角色
 * POST /api/roles
 */
export async function createRole(body: CreateRoleParams) {
  return request<RoleInfo>('/api/roles', {
    method: 'POST',
    data: body,
  });
}

/**
 * 更新管理员角色
 * PUT /api/roles/:id
 */
export async function updateRole(id: string, body: UpdateRoleParams) {
  return request<RoleInfo>(`/api/roles/${id}`, {
    method: 'PUT',
    data: body,
  });
}

/**
 * 部分更新管理员角色
 * PATCH /api/roles/:id
 */
export async function patchRole(id: string, body: UpdateRoleParams) {
  return request<RoleInfo>(`/api/roles/${id}`, {
    method: 'PATCH',
    data: body,
  });
}

/**
 * 删除管理员角色
 * DELETE /api/roles/:id
 */
export async function deleteRole(id: string) {
  return request<{ status: string }>(`/api/roles/${id}`, {
    method: 'DELETE',
  });
}

/**
 * 查询角色关联的权限策略
 * GET /api/roles/:id/policies
 */
export async function getRolePolicies(id: string) {
  return request<PermissionPolicy[]>(`/api/roles/${id}/policies`, {
    method: 'GET',
  });
}
