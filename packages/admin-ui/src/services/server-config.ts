import { request } from '@umijs/max';
import type { PaginatedResponse } from '@/services/types';

/** 系统配置项 */
export interface ServerConfigItem {
  key: string;
  value: unknown;
  value_type: 'string' | 'int' | 'float' | 'bool' | 'duration' | 'json';
  category: string;
  description?: string;
  yaml_default: unknown;
  source: 'yaml' | 'system';
  version: number;
  updated_by?: string;
  updated_at?: string;
}

/**
 * 类型安全的配置项辅助类型
 *
 * 用于将 unknown 类型的 value 转换为具体类型 T，提供类型安全。
 * 使用时需要确保 value_type 与 T 类型匹配。
 *
 * @example
 * ```typescript
 * // 获取一个 string 类型的配置
 * const config = await getServerConfig('app.name');
 * const typedConfig = config as TypedConfigItem<string>;
 * const name: string = typedConfig.value; // 类型安全
 *
 * // 获取一个 number 类型的配置
 * const timeoutConfig = await getServerConfig('request.timeout') as TypedConfigItem<number>;
 * const timeout: number = timeoutConfig.value;
 * ```
 */
export type TypedConfigItem<T> = Omit<ServerConfigItem, 'value' | 'yaml_default'> & {
  value: T;
  yaml_default: T;
};

/** 系统配置列表查询参数 */
export interface ServerConfigListParams {
  category?: string;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

/** 更新系统配置请求（version 可选：强制覆盖时不传 version，设计文档 §4.5） */
export interface UpdateServerConfigRequest {
  value: unknown;
  version?: number;
  change_note?: string;
}

/** 更新系统配置响应 */
export interface UpdateServerConfigResponse {
  key: string;
  value: unknown;
  version: number;
  change_note?: string;
}

/** 删除系统配置响应 */
export interface DeleteServerConfigResponse {
  key: string;
  deleted_value: unknown;
  deleted_version: number;
}

/** 配置变更历史记录 */
export interface ConfigHistoryItem {
  version: number;
  old_value: unknown;
  new_value: unknown;
  changed_by: string;
  changed_at: string;
  change_note?: string;
}

/** 回滚系统配置请求 */
export interface RollbackServerConfigRequest {
  target_version: number;
  version: number;
  change_note?: string;
}

/** 回滚系统配置响应 */
export interface RollbackServerConfigResponse {
  key: string;
  value: unknown;
  version: number;
  rolled_back_from_version: number;
  change_note?: string;
}

/** 乐观锁冲突错误数据 */
export interface OptimisticLockConflictData {
  current_version: number;
  current_value: unknown;
  changed_by: string;
  changed_at: string;
}

/**
 * 获取系统配置列表
 * GET /api/configs
 *
 * @param params - 查询参数（分类、分页、排序）
 * @returns 分页的系统配置列表
 */
export async function getServerConfigList(params?: ServerConfigListParams) {
  return request<PaginatedResponse<ServerConfigItem>>('/api/configs', {
    method: 'GET',
    params,
  });
}

/**
 * 获取单个系统配置
 * GET /api/configs/:key
 *
 * @param key - 配置键名
 * @returns 指定配置的详细信息
 */
export async function getServerConfig(key: string) {
  return request<ServerConfigItem>(
    `/api/configs/${encodeURIComponent(key)}`,
    {
      method: 'GET',
    },
  );
}

/**
 * 更新系统配置
 * PUT /api/configs/:key
 *
 * @param key - 配置键名
 * @param data - 更新请求（包含新值、版本号、变更说明）
 * @returns 更新后的配置信息
 */
export async function updateServerConfig(
  key: string,
  data: UpdateServerConfigRequest,
) {
  return request<UpdateServerConfigResponse>(
    `/api/configs/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      data,
    },
  );
}

/**
 * 删除系统配置（回退到 yaml 默认值）
 * DELETE /api/configs/:key?version=
 *
 * @param key - 配置键名
 * @param version - 版本号（乐观锁必需，设计文档 §4.5）
 */
export async function deleteServerConfig(key: string, version: number) {
  return request<DeleteServerConfigResponse>(
    `/api/configs/${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      params: { version },
    },
  );
}

/**
 * 获取系统配置变更历史
 * GET /api/configs/:key/history
 *
 * @param key - 配置键名
 * @param params - 分页参数
 * @returns 配置变更历史记录的分页列表
 */
export async function getServerConfigHistory(
  key: string,
  params?: { page?: number; page_size?: number },
) {
  return request<PaginatedResponse<ConfigHistoryItem>>(
    `/api/configs/${encodeURIComponent(key)}/history`,
    {
      method: 'GET',
      params,
    },
  );
}

/**
 * 回滚系统配置
 * POST /api/configs/:key/rollback
 *
 * @param key - 配置键名
 * @param data - 回滚请求（目标版本、当前版本、变更说明）
 * @returns 回滚后的配置信息
 */
export async function rollbackServerConfig(
  key: string,
  data: RollbackServerConfigRequest,
) {
  return request<RollbackServerConfigResponse>(
    `/api/configs/${encodeURIComponent(key)}/rollback`,
    {
      method: 'POST',
      data,
    },
  );
}
