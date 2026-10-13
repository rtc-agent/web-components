import { request } from '@umijs/max';
import type { PaginatedResponse } from '@/services/types';
import type { SessionInfo } from './data';

/**
 * Get session list
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
  return request<PaginatedResponse<SessionInfo>>('/api/rtc-users/sessions', {
    method: 'GET',
    params,
  });
}
