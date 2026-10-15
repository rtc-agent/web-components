import { request } from '@umijs/max';
import type { PaginatedRequest, PaginatedResponse } from './types';
import type { UserInfo } from './admin-auth';

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
export interface UserListParams extends PaginatedRequest {}

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

/**
 * 查询管理员列表
 * GET /api/admin-users
 *
 * 注意：此 API 代理到后端 admin-server（见 config/proxy.ts）。
 * 开发环境启用 mock 时（`pnpm start`），Umi mock 插件会拦截此请求
 * 并返回模拟数据（mock/ 目录下的 handler）。
 */
export async function getUserList(params?: UserListParams) {
  return request<PaginatedResponse<UserInfo>>('/api/admin-users', {
    method: 'GET',
    params,
  });
}

/**
 * Create a new admin user.
 * POST /api/admin-users
 *
 * @param body - Admin user creation parameters (email, password, name, role_ids)
 * @returns Promise<UserInfo> Created admin user information
 */
export async function createAdminUser(body: CreateAdminUserParams) {
  return request<UserInfo>('/api/admin-users', {
    method: 'POST',
    data: body,
  });
}

/**
 * Update an existing admin user.
 * PUT /api/admin-users/:id
 *
 * @param userId - Admin user ID
 * @param body - Update parameters (name and/or password)
 * @returns Promise<UserInfo> Updated admin user information
 */
export async function updateAdminUser(userId: string, body: UpdateAdminUserParams) {
  return request<UserInfo>(`/api/admin-users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    data: body,
  });
}

/**
 * Delete an admin user.
 * DELETE /api/admin-users/:id
 *
 * @param userId - Admin user ID to delete
 * @returns Promise<void>
 */
export async function deleteAdminUser(userId: string) {
  return request<void>(`/api/admin-users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

/**
 * Get roles assigned to an admin user.
 * GET /api/admin-users/:id/roles
 *
 * @param userId - Admin user ID
 * @returns Promise<PaginatedResponse<UserRoleAssignment>> Paginated list of role assignments
 */
export async function getUserRoles(userId: string) {
  return request<PaginatedResponse<UserRoleAssignment>>(`/api/admin-users/${encodeURIComponent(userId)}/roles`, {
    method: 'GET',
  });
}

/**
 * Assign roles to an admin user (batch operation).
 * POST /api/admin-users/:id/roles
 *
 * @param userId - Admin user ID
 * @param body - Role assignment parameters (array of role_ids)
 * @returns Promise<void>
 */
export async function assignUserRoles(userId: string, body: AssignRolesParams) {
  return request<void>(`/api/admin-users/${encodeURIComponent(userId)}/roles`, {
    method: 'POST',
    data: body,
  });
}

/**
 * Revoke a specific role from an admin user.
 * DELETE /api/admin-users/:id/roles/:roleId
 *
 * @param userId - Admin user ID
 * @param roleId - Role ID to revoke
 * @returns Promise<void>
 */
export async function revokeUserRole(userId: string, roleId: string) {
  return request<void>(`/api/admin-users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`, {
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

/**
 * Get admin users assigned to a specific role.
 * GET /api/roles/:id/admin-users
 *
 * @param roleId - Role ID
 * @returns Promise<PaginatedResponse<RoleUserInfo>> Paginated list of admin users with this role
 */
export async function getRoleUsers(roleId: string) {
  return request<PaginatedResponse<RoleUserInfo>>(`/api/roles/${encodeURIComponent(roleId)}/admin-users`, {
    method: 'GET',
  });
}
