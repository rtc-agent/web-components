import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { listRtcMessages } from './list';

/**
 * RTC Message Management Function Group
 *
 * Corresponds to route: /rtc-users/messages
 *
 * All functions call page-exposed React API:
 * - window.__pages__.rtcMessage.list()
 *
 * Permission requirements:
 * - list: rtc_message:read
 */
export const rtcMessageGroup = {
  name: 'rtcMessage',
  description:
    'RTC message management module for /rtc-users/messages page. Supports listing messages with pagination, role filter (user/assistant), time range filter, and sorting. All operations are scoped to a specific session (session_id required). Returns data matching the UI table.',
  functions: [listRtcMessages] as PermissionAwareFunctionDef[],
};
