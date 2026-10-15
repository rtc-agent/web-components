import { request } from '@umijs/max';
import type { ConfigHistoryItem } from '@/services/server-config';
import type { PaginatedResponse } from '@/services/types';
import type { UserConfigItem } from '@/services/user-config';
import {
  deleteUserConfig,
  getUserConfigHistory,
  getUserConfigs,
  rollbackUserConfig,
  setUserConfig,
} from '@/services/user-config';
import type {
  BanRtcUserRequest,
  BanRtcUserResponse,
  DeviceListResponse,
  RtcUserInfo,
  TokenStatsResponse,
  UnbanRtcUserResponse,
} from './data';

// Re-export types and functions that components need from this service file
export type { ConfigHistoryItem, UserConfigItem };
export {
  deleteUserConfig,
  getUserConfigHistory,
  getUserConfigs,
  rollbackUserConfig,
  setUserConfig,
};

/**
 * Get RTC user list with pagination and filtering.
 *
 * GET /api/rtc-users
 *
 * @param params - Query parameters for filtering and pagination
 * @param params.status - Filter by user status (optional)
 * @param params.search - Search keyword for user info (optional)
 * @param params.page - Page number (optional)
 * @param params.page_size - Items per page (optional)
 * @returns Paginated list of RTC users
 */
export async function getRtcUserList(params?: {
  status?: string;
  search?: string;
  page?: number;
  page_size?: number;
}) {
  return request<PaginatedResponse<RtcUserInfo>>('/api/rtc-users', {
    method: 'GET',
    params,
  });
}

/**
 * Ban an RTC user.
 *
 * POST /api/rtc-users/:id/ban
 *
 * @param id - User ID to ban
 * @param data - Ban request containing reason and duration
 * @returns Ban operation result
 */
export async function banRtcUser(id: string, data: BanRtcUserRequest) {
  return request<BanRtcUserResponse>(
    `/api/rtc-users/${encodeURIComponent(id)}/ban`,
    {
      method: 'POST',
      data,
    },
  );
}

/**
 * Unban an RTC user.
 *
 * POST /api/rtc-users/:id/unban
 *
 * @param id - User ID to unban
 * @returns Unban operation result
 */
export async function unbanRtcUser(id: string) {
  return request<UnbanRtcUserResponse>(
    `/api/rtc-users/${encodeURIComponent(id)}/unban`,
    {
      method: 'POST',
    },
  );
}

/**
 * Get user's device list.
 *
 * GET /api/rtc-users/:userId/devices
 *
 * @param userId - User ID
 * @returns List of user's devices
 */
export async function getUserDevices(userId: string) {
  return request<DeviceListResponse>(
    `/api/rtc-users/${encodeURIComponent(userId)}/devices`,
    {
      method: 'GET',
    },
  );
}

/**
 * Get user's token usage statistics.
 *
 * GET /api/rtc-users/sessions/stats
 *
 * @param userId - User ID
 * @param days - Number of days to query (default: 30)
 * @returns Token usage statistics for the specified period
 */
export async function getUserTokenStats(userId: string, days: number = 30) {
  return request<TokenStatsResponse>('/api/rtc-users/sessions/stats', {
    method: 'GET',
    params: { user_id: userId, days },
  });
}
