import { request } from '@umijs/max';
import type { ListItemDataType, Params } from './data';

/**
 * Query fake list data for search/projects page.
 *
 * MOCK-ONLY: The `/api/fake_list` endpoint is served by Umi's mock plugin
 * (see `mock/fakeList.ts`). It is NOT implemented by the
 * backend. This page will return 404 when mock is disabled (e.g. `pnpm run dev`,
 * production builds). This page is currently not in active use (not in routes).
 */
export async function queryFakeList(
  params: Params,
): Promise<{ data: { list: ListItemDataType[] } }> {
  return request('/api/fake_list', {
    params,
  });
}
