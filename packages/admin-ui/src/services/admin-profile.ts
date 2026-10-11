import { request } from '@umijs/max';
import type { UserInfo } from './admin-auth';

/** 更新个人资料响应 */
export interface UpdateProfileResponse {
  success: boolean;
  data?: UserInfo;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * 更新当前用户个人资料（名称和密码）
 * PUT /api/admin-users/me
 */
export async function updateProfile(
  data: {
    name?: string;
    password?: string;
  },
  options?: Record<string, any>,
) {
  return request<UpdateProfileResponse>('/api/admin-users/me', {
    method: 'PUT',
    data,
    ...(options || {}),
  });
}
