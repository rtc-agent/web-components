/**
 * RTC 用户信息
 */
export type RtcUserInfo = {
  id: string;
  provider: string;
  sub: string;
  email?: string;
  name?: string;
  avatar_url?: string;
  status: 'active' | 'banned';
  banned_at?: string;
  banned_reason?: string;
  created_at: string;
  updated_at: string;
};

/**
 * RTC 用户列表响应
 */
export type RtcUserListResponse = {
  items: RtcUserInfo[];
  total: number;
  page: number;
  page_size: number;
};

/**
 * 封禁用户请求
 */
export type BanRtcUserRequest = {
  reason: string;
};

/**
 * 封禁用户响应
 */
export type BanRtcUserResponse = {
  id: string;
  status: 'banned';
  banned_at: string;
  banned_reason: string;
};

/**
 * 解封用户响应
 */
export type UnbanRtcUserResponse = {
  id: string;
  status: 'active';
};
