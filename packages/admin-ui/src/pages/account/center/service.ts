import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/types';
import type { CurrentUser, ListItemDataType } from './data';

/**
 * Query current user detail for the account center page.
 *
 * MOCK-ONLY: The `/api/currentUserDetail` endpoint is served by Umi's mock plugin
 * (see `./_mock.ts`). The backend does NOT implement this endpoint.
 * In production builds, this call will 404 unless the backend adds support.
 *
 * TODO: Replace with real backend endpoint or merge with `/api/currentUser`.
 */
export async function queryCurrent(): Promise<ApiResponse<CurrentUser>> {
  return request<ApiResponse<CurrentUser>>('/api/currentUserDetail');
}

/**
 * Query fake list for account center sub-tabs (projects/articles/applications).
 *
 * MOCK-ONLY: The `/api/fake_list_Detail` endpoint is served by Umi's mock plugin
 * (see `./_mock.ts`). The backend does NOT implement this endpoint.
 * In production builds, this call will 404 unless the backend adds support.
 *
 * TODO: Replace with real backend endpoint for user-related list data.
 */
export async function queryFakeList(params: {
  count: number;
}): Promise<ApiResponse<{ list: ListItemDataType[] }>> {
  return request<ApiResponse<{ list: ListItemDataType[] }>>(
    '/api/fake_list_Detail',
    {
      params,
    },
  );
}
