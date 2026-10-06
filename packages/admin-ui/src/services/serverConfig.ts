import { request } from '@umijs/max';

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

/** 系统配置列表响应 */
export interface ServerConfigListResponse {
  items: ServerConfigItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 系统配置列表查询参数 */
export interface ServerConfigListParams {
  category?: string;
  page?: number;
  page_size?: number;
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

/** 配置变更历史列表响应 */
export interface ConfigHistoryListResponse {
  items: ConfigHistoryItem[];
  total: number;
  page: number;
  page_size: number;
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
 */
export async function getServerConfigList(params?: ServerConfigListParams) {
  return request<ServerConfigListResponse>('/api/configs', {
    method: 'GET',
    params,
  });
}

/**
 * 获取单个系统配置
 * GET /api/configs/:key
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
 */
export async function getServerConfigHistory(
  key: string,
  params?: { page?: number; page_size?: number },
) {
  return request<ConfigHistoryListResponse>(
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
