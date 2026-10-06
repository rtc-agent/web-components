import { request } from '@umijs/max';
import type {
  BanRtcUserRequest,
  BanRtcUserResponse,
  RtcUserListResponse,
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
 * 获取 RTC 用户详情
 */
export async function getRtcUser(id: string) {
  return request<{ data: any }>(`/api/rtc-users/${id}`, {
    method: 'GET',
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
