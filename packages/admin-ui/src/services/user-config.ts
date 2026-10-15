import { request } from '@umijs/max';
import type { ConfigHistoryItem } from '@/services/server-config';
import type { PaginatedResponse } from '@/services/types';

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

/**
 * 类型安全的用户配置项辅助类型
 *
 * 用于将 unknown 类型的 value 转换为具体类型 T，提供类型安全。
 * 使用时需要确保 value_type 与 T 类型匹配。
 *
 * @example
 * ```typescript
 * // 获取用户配置并指定值类型
 * const config = await getUserConfigs(userId);
 * const typedItem = config.items[0] as TypedUserConfigItem<string>;
 * const value: string = typedItem.effective_value; // 类型安全
 * ```
 */
export type TypedUserConfigItem<T> = Omit<
  UserConfigItem,
  'effective_value' | 'yaml_default' | 'system_value' | 'user_value'
> & {
  effective_value: T;
  yaml_default: T;
  system_value: T;
  user_value: T;
};

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
 *
 * @param userId - 用户 ID
 * @param params - 查询参数（可选：按分类过滤）
 * @returns 用户配置列表（包含 yaml 默认值、系统值、用户覆盖值）
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
 *
 * @param userId - 用户 ID
 * @param key - 配置键名
 * @param data - 设置请求（新值、版本号、变更说明）
 * @returns 设置后的配置信息
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
 *
 * @param userId - 用户 ID
 * @param key - 配置键名
 * @param version - 版本号（乐观锁必需，设计文档 §4.5）
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
 *
 * @param userId - 用户 ID
 * @param key - 配置键名
 * @param params - 分页参数
 * @returns 配置变更历史记录的分页列表
 */
export async function getUserConfigHistory(
  userId: string,
  key: string,
  params?: { page?: number; page_size?: number },
) {
  return request<PaginatedResponse<ConfigHistoryItem>>(
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
 *
 * @param userId - 用户 ID
 * @param key - 配置键名
 * @param data - 回滚请求（目标版本、当前版本、变更说明）
 * @returns 回滚后的配置信息
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
