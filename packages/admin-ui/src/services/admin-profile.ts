import { request } from '@umijs/max';

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
  return request<API.Response<API.AdminUser>>('/api/admin-users/me', {
    method: 'PUT',
    data,
    ...(options || {}),
  });
}
