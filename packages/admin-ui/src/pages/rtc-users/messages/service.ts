import { request } from '@umijs/max';
import type { MessageListResponse } from './data';

/**
 * 获取 Message 列表
 */
export async function getMessageList(params: {
  session_id: string;
  role?: string;
  created_after?: string;
  created_before?: string;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}) {
  const { session_id, ...queryParams } = params;
  return request<MessageListResponse>(
    `/api/rtc-users/sessions/${session_id}/messages`,
    {
      method: 'GET',
      params: queryParams,
    },
  );
}
