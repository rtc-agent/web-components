import { request } from '@umijs/max';

/** 审计日志项 */
export interface AuditLogItem {
  id: string;
  operator_id: string;
  operator_name?: string;
  operator_ip?: string;
  event_type: string;
  resource_type: string;
  resource_id?: string;
  details?: Record<string, any>;
  created_at: string;
}

/** 审计日志查询参数 */
export interface AuditLogListParams {
  page?: number;
  page_size?: number;
  actor_id?: string;
  resource_type?: string;
  event_type?: string;
  target_id?: string;
  start_time?: string;
  end_time?: string;
}

/** 审计日志列表响应 */
export interface AuditLogListResponse {
  items: AuditLogItem[];
  total: number;
}

/**
 * 查询审计日志列表
 * GET /api/audit-logs
 */
export async function getAuditLogList(params?: AuditLogListParams) {
  return request<AuditLogListResponse>('/api/audit-logs', {
    method: 'GET',
    params,
  });
}
