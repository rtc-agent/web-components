import { request } from '@umijs/max';
import type { ApiResponse } from '@/services/types';
import type { CurrentUser, GeographicItemType } from './data';

/**
 * Query current user profile for the account settings page.
 *
 * **MOCK-ONLY**: This endpoint is not yet implemented on the backend.
 * Data is provided by `./_mock.ts` for development purposes.
 *
 * @endpoint GET /api/accountSettingCurrentUser
 * @mock src/pages/account/settings/_mock.ts
 * @deprecated TODO: Replace with real backend endpoint (e.g. merge with `/api/currentUser`)
 */
export async function queryCurrent(): Promise<ApiResponse<CurrentUser>> {
  return request<ApiResponse<CurrentUser>>('/api/accountSettingCurrentUser');
}

/**
 * Query province list for geographic selector.
 *
 * **MOCK-ONLY**: This endpoint is not yet implemented on the backend.
 * The mock handler returns real static data from `src/utils/chinaDivision.ts`.
 *
 * @endpoint GET /api/geographic/province
 * @mock src/pages/account/settings/_mock.ts
 * @deprecated TODO: Bundle province data in frontend or implement backend endpoint
 */
export async function queryProvince(): Promise<GeographicItemType[]> {
  return request<ApiResponse<GeographicItemType[]>>(
    '/api/geographic/province',
  ).then(({ data }) => data ?? []);
}

/**
 * Query city list for a given province.
 *
 * **MOCK-ONLY**: This endpoint is not yet implemented on the backend.
 * The mock handler returns real static data from `src/utils/chinaDivision.ts`.
 *
 * @endpoint GET /api/geographic/city/:province
 * @mock src/pages/account/settings/_mock.ts
 * @deprecated TODO: Bundle city data in frontend or implement backend endpoint
 */
export async function queryCity(
  province: string,
): Promise<GeographicItemType[]> {
  return request<ApiResponse<GeographicItemType[]>>(
    `/api/geographic/city/${encodeURIComponent(province)}`,
  ).then(({ data }) => data ?? []);
}

/**
 * Update current user profile.
 *
 * **MOCK-ONLY**: This endpoint is not yet implemented on the backend.
 * Data is provided by `./_mock.ts` for development purposes.
 *
 * @endpoint PUT /api/accountSettingCurrentUser
 * @mock src/pages/account/settings/_mock.ts
 * @deprecated TODO: Replace with real backend endpoint
 */
export async function updateCurrentUser(data: {
  name?: string;
  email?: string;
  profile?: string;
  country?: string;
  province?: string;
  city?: string;
  address?: string;
  phone?: string;
}): Promise<ApiResponse<{ success: boolean }>> {
  return request<ApiResponse<{ success: boolean }>>(
    '/api/accountSettingCurrentUser',
    {
      method: 'PUT',
      data,
    },
  );
}
