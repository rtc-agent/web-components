import { request } from '@umijs/max';
import type { PaginatedRequest, PaginatedResponse } from './types';
import type { PermissionPolicy } from './permission';

/**
 * Admin role definition.
 * Note: This type mirrors the backend Role entity. If backend schema changes,
 * regenerate types via `pnpm run openapi` or update manually to match.
 * Last synced with backend schema: 2026-10-13
 */
export interface RoleInfo {
  /** Unique role identifier */
  id: string;
  /** Internal role name (e.g. "admin") */
  name: string;
  /** Human-readable display name */
  display_name: string;
  /** Role description */
  description?: string;
  /** Whether this is a built-in system role (cannot be deleted) */
  is_system?: boolean;
  /** Whether the role is currently enabled */
  is_enabled?: boolean;
  /** Creation timestamp (ISO 8601) */
  created_at?: string;
  /** Last update timestamp (ISO 8601) */
  updated_at?: string;
}

/** 管理员角色列表查询参数 */
export interface RoleListParams extends PaginatedRequest {}

/**
 * 查询管理员角色列表
 * GET /api/roles
 *
 * @param params - 分页参数
 * @returns Promise<PaginatedResponse<RoleInfo>> 分页的角色列表
 */
export async function getRoleList(params?: RoleListParams) {
  return request<PaginatedResponse<RoleInfo>>('/api/roles', {
    method: 'GET',
    params,
  });
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
 * 查询单个管理员角色
 * GET /api/roles/:id
 *
 * @param id - 角色 ID
 * @returns Promise<RoleInfo> 角色详情
 */
export async function getRole(id: string) {
  return request<RoleInfo>(`/api/roles/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

/**
 * 创建管理员角色
 * POST /api/roles
 *
 * @param body - 角色创建参数（name、display_name、description）
 * @returns Promise<RoleInfo> 创建的角色信息
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
 *
 * @param id - 角色 ID
 * @param body - 更新参数（display_name、description、is_enabled）
 * @returns Promise<RoleInfo> 更新后的角色信息
 */
export async function updateRole(id: string, body: UpdateRoleParams) {
  return request<RoleInfo>(`/api/roles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    data: body,
  });
}

/**
 * 部分更新管理员角色
 * PATCH /api/roles/:id
 *
 * @param id - 角色 ID
 * @param body - 更新参数（display_name、description、is_enabled）
 * @returns Promise<RoleInfo> 更新后的角色信息
 */
export async function patchRole(id: string, body: UpdateRoleParams) {
  return request<RoleInfo>(`/api/roles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    data: body,
  });
}

/**
 * 删除管理员角色
 * DELETE /api/roles/:id
 *
 * @param id - 角色 ID
 * @returns Promise<{ status: string }> 删除状态
 */
export async function deleteRole(id: string) {
  return request<{ status: string }>(`/api/roles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * 查询角色关联的权限策略
 * GET /api/roles/:id/policies
 *
 * @param id - 角色 ID
 * @returns Promise<PermissionPolicy[]> 该角色下的所有权限策略
 */
export async function getRolePolicies(id: string) {
  return request<PermissionPolicy[]>(`/api/roles/${encodeURIComponent(id)}/policies`, {
    method: 'GET',
  });
}
