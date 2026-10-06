import { request } from '@umijs/max';
import type { SessionListResponse } from './data';

/**
 * 获取 Session 列表
 */
export async function getSessionList(params: {
  user_id: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  search?: string;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}) {
  return request<SessionListResponse>('/api/rtc-users/sessions', {
    method: 'GET',
    params,
  });
}
