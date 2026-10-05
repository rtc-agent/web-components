import { request } from '@umijs/max';
import type { RoleInfo, UserInfo } from './admin-auth';

/**
 * 用户-角色关联响应
 * 对应后端的 UserRoleResponse
 */
export interface UserRoleAssignment {
  user_id: string;
  role_id: string;
  role_name: string;
  assigned_at: string;
}

/** 用户列表查询参数 */
export interface UserListParams {
  page?: number;
  page_size?: number;
  keyword?: string;
}

/** 用户列表响应 */
export interface UserListResponse {
  items: UserInfo[];
  total: number;
}

/** 分配角色参数 */
export interface AssignRolesParams {
  role_ids: string[];
}

/** 用户角色列表响应 */
export interface UserRoleListResponse {
  items: UserRoleAssignment[];
  total: number;
}

/**
 * 查询用户列表
 * GET /api/users
 *
 * 注意：此 API 需要后端实现。如果后端未实现，此功能将不可用。
 * 开发环境使用 mock 数据（mock/permissionSystem.ts）。
 */
export async function getUserList(params?: UserListParams) {
  return request<UserListResponse>('/api/users', {
    method: 'GET',
    params,
  });
}

/**
 * 查询用户角色
 * GET /api/users/:id/roles
 * 返回：{items: UserRoleAssignment[], total: number}
 */
export async function getUserRoles(userId: string) {
  return request<UserRoleListResponse>(`/api/users/${userId}/roles`, {
    method: 'GET',
  });
}

/**
 * 批量分配角色
 * POST /api/users/:id/roles
 */
export async function assignUserRoles(userId: string, body: AssignRolesParams) {
  return request<{ success: boolean }>(`/api/users/${userId}/roles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * 移除用户角色
 * DELETE /api/users/:id/roles/:roleId
 */
export async function revokeUserRole(userId: string, roleId: string) {
  return request<{ success: boolean }>(`/api/users/${userId}/roles/${roleId}`, {
    method: 'DELETE',
  });
}

/**
 * 角色下的用户信息
 * 对应后端的 RoleUserResponse
 */
export interface RoleUserInfo {
  user_id: string;
  user_email: string;
  user_name: string;
  assigned_at: string;
}

/** 角色用户列表响应 */
export interface RoleUserListResponse {
  items: RoleUserInfo[];
  total: number;
}

/**
 * 查询角色下的用户
 * GET /api/roles/:id/users
 * 返回：{items: RoleUserInfo[], total: number}
 */
export async function getRoleUsers(roleId: string) {
  return request<RoleUserListResponse>(`/api/roles/${roleId}/users`, {
    method: 'GET',
  });
}
