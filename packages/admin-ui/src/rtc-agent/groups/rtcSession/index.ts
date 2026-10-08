import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { listRtcSessions } from './list';

/**
 * RTC Session Management Function Group
 *
 * Corresponds to route: /rtc-users/sessions
 *
 * All functions call page-exposed React API:
 * - window.__pages__.rtcSession.list()
 *
 * Permission requirements:
 * - list: rtc_session:read
 */
export const rtcSessionGroup = {
  name: 'rtcSession',
  description:
    'RTC session management module for /rtc-users/sessions page. Supports listing sessions with pagination, keyword search, status filter (active/closed), time range filter, and sorting. All operations are scoped to a specific user (user_id required). Returns data matching the UI table.',
  functions: [listRtcSessions] as PermissionAwareFunctionDef[],
};
