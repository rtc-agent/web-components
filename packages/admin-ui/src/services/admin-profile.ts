import { request } from '@umijs/max';
import type { UserInfo } from './admin-auth';

/** Request options for profile service functions */
interface ProfileRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Update current admin user profile (name and/or password).
 * PUT /api/admin-users/me
 *
 * @param data - Profile update data (name and/or password)
 * @param options - Request options (optional)
 * @returns Promise<UserInfo> Updated user information
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
