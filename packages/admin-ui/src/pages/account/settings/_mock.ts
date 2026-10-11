/**
 * Mock handlers for account settings page.
 *
 * These handlers are ONLY active when Umi's mock plugin is enabled:
 * - `pnpm start` (mock enabled)
 * - NOT active with `pnpm run dev` (MOCK=none)
 * - NOT active in production builds
 *
 * Endpoints served:
 * - GET/PUT /api/accountSettingCurrentUser — used by service.ts
 * - GET /api/geographic/province           — used by service.ts queryProvince()
 * - GET /api/geographic/city/:province     — used by service.ts queryCity()
 *
 * The real backend does NOT implement these endpoints. Pages depending on them
 * will 404 in production until the backend provides real implementations.
 *
 * Note: Geographic data comes from `src/utils/chinaDivision.ts` (real static data).
 */
import type { Request, Response } from 'express';
import { defaultUser } from '../../../../mock/utils';
import { getCityOptions, provinceOptions } from '../../../utils/chinaDivision';

function getProvince(_: Request, res: Response) {
  return res.json({
    data: provinceOptions,
  });
}

function getCity(req: Request, res: Response) {
  const provinceKey = req.params.province;
  return res.json({
    data: getCityOptions(
      Array.isArray(provinceKey) ? provinceKey[0] : provinceKey,
    ),
  });
}

function getCurrentUse(_req: Request, res: Response) {
  return res.json({
    data: defaultUser,
  });
}

function updateCurrentUser(_req: Request, res: Response) {
  return res.json({
    success: true,
  });
}

export default {
  'GET  /api/accountSettingCurrentUser': getCurrentUse,
  'PUT  /api/accountSettingCurrentUser': updateCurrentUser,
  'GET  /api/geographic/province': getProvince,
  'GET  /api/geographic/city/:province': getCity,
};
