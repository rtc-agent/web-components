import { request } from '@umijs/max';
import type {
  BanRtcUserRequest,
  BanRtcUserResponse,
  DeviceListResponse,
  RtcUserListResponse,
  TokenStatsResponse,
  UnbanRtcUserResponse,
} from './data';

/**
 * 获取 RTC 用户列表
 */
export async function getRtcUserList(params?: {
  status?: string;
  search?: string;
  page?: number;
  page_size?: number;
}) {
  return request<RtcUserListResponse>('/api/rtc-users', {
    method: 'GET',
    params,
  });
}

/**
 * 封禁 RTC 用户
 */
export async function banRtcUser(id: string, data: BanRtcUserRequest) {
  return request<BanRtcUserResponse>(`/api/rtc-users/${id}/ban`, {
    method: 'POST',
    data,
  });
}

/**
 * 解封 RTC 用户
 */
export async function unbanRtcUser(id: string) {
  return request<UnbanRtcUserResponse>(`/api/rtc-users/${id}/unban`, {
    method: 'POST',
  });
}

/**
 * 获取用户设备列表
 */
export async function getUserDevices(userId: string) {
  return request<DeviceListResponse>(`/api/rtc-users/${userId}/devices`, {
    method: 'GET',
  });
}

/**
 * 获取用户 Token 统计
 */
export async function getUserTokenStats(
  userId: string,
  days: number = 30,
) {
  return request<TokenStatsResponse>('/api/rtc-users/sessions/stats', {
    method: 'GET',
    params: { user_id: userId, days },
  });
}
