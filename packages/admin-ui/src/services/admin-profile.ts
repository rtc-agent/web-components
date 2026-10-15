import { request } from '@umijs/max';
import type { UserInfo } from './admin-auth';

/** Request options for profile service functions */
interface ProfileRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  [key: string]: unknown;
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
  options?: ProfileRequestOptions,
) {
  return request<UserInfo>('/api/admin-users/me', {
    method: 'PUT',
    data,
    ...(options || {}),
  });
}
