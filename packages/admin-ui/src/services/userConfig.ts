import { request } from '@umijs/max';
import type { ConfigHistoryListResponse } from '@/services/serverConfig';

/** 用户配置覆盖项 */
export interface UserConfigItem {
  key: string;
  category: string;
  description?: string;
  value_type: 'string' | 'int' | 'float' | 'bool' | 'duration' | 'json';
  effective_value: unknown;
  source: 'yaml' | 'system' | 'user';
  yaml_default: unknown;
  system_value: unknown;
  user_value: unknown;
  version: number;
  updated_at?: string;
}

/** 用户配置列表响应 */
export interface UserConfigListResponse {
  user_id: string;
  items: UserConfigItem[];
}

/** 设置用户配置覆盖请求（version 可选：强制覆盖时不传 version，设计文档 §4.5） */
export interface SetUserConfigRequest {
  value: unknown;
  version?: number;
  change_note?: string;
}

/** 设置用户配置覆盖响应 */
export interface SetUserConfigResponse {
  key: string;
  user_id: string;
  value: unknown;
  version: number;
  change_note?: string;
}

/** 删除用户配置覆盖响应 */
export interface DeleteUserConfigResponse {
  key: string;
  user_id: string;
  deleted_value: unknown;
  deleted_version: number;
}

/** 回滚用户配置请求 */
export interface RollbackUserConfigRequest {
  target_version: number;
  version: number;
  change_note?: string;
}

/** 回滚用户配置响应 */
export interface RollbackUserConfigResponse {
  key: string;
  user_id: string;
  value: unknown;
  version: number;
  rolled_back_from_version: number;
  change_note?: string;
}

/**
 * 获取用户完整配置视图
 * GET /api/rtc-users/:userId/configs
 */
export async function getUserConfigs(
  userId: string,
  params?: { category?: string },
) {
  return request<UserConfigListResponse>(`/api/rtc-users/${userId}/configs`, {
    method: 'GET',
    params,
  });
}

/**
 * 设置用户配置覆盖
 * PUT /api/rtc-users/:userId/configs/:key
 */
export async function setUserConfig(
  userId: string,
  key: string,
  data: SetUserConfigRequest,
) {
  return request<SetUserConfigResponse>(
    `/api/rtc-users/${userId}/configs/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      data,
    },
  );
}

/**
 * 删除用户配置覆盖
 * DELETE /api/rtc-users/:userId/configs/:key?version=
 */
export async function deleteUserConfig(
  userId: string,
  key: string,
  version: number,
) {
  return request<DeleteUserConfigResponse>(
    `/api/rtc-users/${userId}/configs/${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      params: { version },
    },
  );
}

/**
 * 获取用户配置变更历史
 * GET /api/rtc-users/:userId/configs/:key/history
 */
export async function getUserConfigHistory(
  userId: string,
  key: string,
  params?: { page?: number; page_size?: number },
) {
  return request<ConfigHistoryListResponse>(
    `/api/rtc-users/${userId}/configs/${encodeURIComponent(key)}/history`,
    {
      method: 'GET',
      params,
    },
  );
}

/**
 * 回滚用户配置
 * POST /api/rtc-users/:userId/configs/:key/rollback
 */
export async function rollbackUserConfig(
  userId: string,
  key: string,
  data: RollbackUserConfigRequest,
) {
  return request<RollbackUserConfigResponse>(
    `/api/rtc-users/${userId}/configs/${encodeURIComponent(key)}/rollback`,
    {
      method: 'POST',
      data,
    },
  );
}
