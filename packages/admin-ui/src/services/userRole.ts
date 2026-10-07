import { request } from '@umijs/max';
import type { RoleInfo, UserInfo } from './admin-auth';

/**
 * 管理员用户与管理员角色关联响应
 * 对应后端的 UserRoleResponse
 */
export interface UserRoleAssignment {
  user_id: string;
  role_id: string;
  role_name: string;
  assigned_at: string;
}

/** 管理员列表查询参数 */
export interface UserListParams {
  page?: number;
  page_size?: number;
  keyword?: string;
}

/** 管理员列表响应 */
export interface UserListResponse {
  items: UserInfo[];
  total: number;
}

/** 创建管理员参数 */
export interface CreateAdminUserParams {
  email: string;
  password: string;
  name?: string;
  role_ids?: string[];
}

/** 更新管理员参数 */
export interface UpdateAdminUserParams {
  name?: string;
  password?: string;
}

/** 分配管理员角色参数 */
export interface AssignRolesParams {
  role_ids: string[];
}

/** 管理员角色列表响应 */
export interface UserRoleListResponse {
  items: UserRoleAssignment[];
  total: number;
}

/**
 * 查询管理员列表
 * GET /api/admin-users
 *
 * 注意：此 API 需要后端实现。如果后端未实现，此功能将不可用。
 * 开发环境使用 mock 数据（mock/permissionSystem.ts）。
 */
export async function getUserList(params?: UserListParams) {
  return request<UserListResponse>('/api/admin-users', {
    method: 'GET',
    params,
  });
}

/**
 * 创建管理员
 * POST /api/admin-users
 */
export async function createAdminUser(body: CreateAdminUserParams) {
  return request<UserInfo>('/api/admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * 更新管理员
 * PUT /api/admin-users/:id
 */
export async function updateAdminUser(userId: string, body: UpdateAdminUserParams) {
  return request<UserInfo>(`/api/admin-users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * 查询管理员角色
 * GET /api/admin-users/:id/roles
 * 返回：{items: UserRoleAssignment[], total: number}
 */
export async function getUserRoles(userId: string) {
  return request<UserRoleListResponse>(`/api/admin-users/${userId}/roles`, {
    method: 'GET',
  });
}

/**
 * 批量分配管理员角色
 * POST /api/admin-users/:id/roles
 */
export async function assignUserRoles(userId: string, body: AssignRolesParams) {
  return request<{ success: boolean }>(`/api/admin-users/${userId}/roles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

/**
 * 移除管理员角色
 * DELETE /api/admin-users/:id/roles/:roleId
 */
export async function revokeUserRole(userId: string, roleId: string) {
  return request<{ success: boolean }>(`/api/admin-users/${userId}/roles/${roleId}`, {
    method: 'DELETE',
  });
}

/**
 * 管理员角色下的管理员信息
 * 对应后端的 RoleUserResponse
 */
export interface RoleUserInfo {
  user_id: string;
  user_email: string;
  user_name: string;
  assigned_at: string;
}

/** 管理员角色管理员列表响应 */
export interface RoleUserListResponse {
  items: RoleUserInfo[];
  total: number;
}

/**
 * 查询管理员角色下的管理员
 * GET /api/roles/:id/admin-users
 * 返回：{items: RoleUserInfo[], total: number}
 */
export async function getRoleUsers(roleId: string) {
  return request<RoleUserListResponse>(`/api/roles/${roleId}/admin-users`, {
    method: 'GET',
  });
}
