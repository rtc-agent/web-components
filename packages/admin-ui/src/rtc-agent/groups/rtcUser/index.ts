import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { banRtcUserFn } from './ban';
import { getRtcUserDevices } from './devices';
import { listRtcUsers } from './list';
import { getRtcUserTokenStats } from './tokenStats';
import { unbanRtcUserFn } from './unban';

/**
 * RTC User Management Function Group
 *
 * Corresponds to route: /rtc-users/management
 *
 * All functions call page-exposed React API:
 * - window.__pages__.rtcUser.list()
 * - window.__pages__.rtcUser.ban()
 * - window.__pages__.rtcUser.unban()
 * - window.__pages__.rtcUser.devices()
 * - window.__pages__.rtcUser.tokenStats()
 *
 * Permission requirements:
 * - list, devices, tokenStats: rtc_user:read
 * - ban, unban: rtc_user:ban
 */
export const rtcUserGroup = {
  name: 'rtcUser',
  description:
    'RTC user management module for /rtc-users/management page. Supports listing users with pagination and search, banning/unbanning users, viewing user devices, and querying token consumption statistics. All operations are reflected in the UI table.',
  functions: [
    listRtcUsers,
    banRtcUserFn,
    unbanRtcUserFn,
    getRtcUserDevices,
    getRtcUserTokenStats,
  ] as PermissionAwareFunctionDef[],
};
