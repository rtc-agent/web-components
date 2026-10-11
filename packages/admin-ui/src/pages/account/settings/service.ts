import { request } from '@umijs/max';
import type { CurrentUser, GeographicItemType } from './data';

/**
 * Query current user profile for the account settings page.
 *
 * MOCK-ONLY: The `/api/accountSettingCurrentUser` endpoint is served by Umi's
 * mock plugin (see `./_mock.ts`). The backend does NOT implement this endpoint.
 * In production builds, this call will 404 unless the backend adds support.
 *
 * TODO: Replace with real backend endpoint (e.g. merge with `/api/currentUser`).
 */
export async function queryCurrent(): Promise<{ data: CurrentUser }> {
  return request('/api/accountSettingCurrentUser');
}

/**
 * Query province list for geographic selector.
 *
 * MOCK-ONLY: The `/api/geographic/province` endpoint is served by Umi's mock
 * plugin (see `./_mock.ts`). The mock handler returns real static data from
 * `src/utils/chinaDivision.ts`. In production, this needs a backend endpoint
 * or the data should be bundled directly in the frontend.
 *
 * TODO: Bundle province data in frontend or implement backend endpoint.
 */
export async function queryProvince(): Promise<GeographicItemType[]> {
  return request('/api/geographic/province').then(({ data }) => data);
}

/**
 * Query city list for a given province.
 *
 * MOCK-ONLY: The `/api/geographic/city/:province` endpoint is served by Umi's
 * mock plugin (see `./_mock.ts`). The mock handler returns real static data from
 * `src/utils/chinaDivision.ts`. In production, this needs a backend endpoint
 * or the data should be bundled directly in the frontend.
 *
 * TODO: Bundle city data in frontend or implement backend endpoint.
 */
export async function queryCity(
  province: string,
): Promise<GeographicItemType[]> {
  return request(`/api/geographic/city/${encodeURIComponent(province)}`).then(
    ({ data }) => data,
  );
}

/**
 * Update current user profile.
 *
 * MOCK-ONLY: The `/api/accountSettingCurrentUser` PUT endpoint is served by
 * Umi's mock plugin (see `./_mock.ts`). The backend does NOT implement this.
 * In production builds, this call will 404 unless the backend adds support.
 *
 * TODO: Replace with real backend endpoint.
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
}): Promise<{ success: boolean }> {
  return request('/api/accountSettingCurrentUser', {
    method: 'PUT',
    data,
  });
}
