/**
 * RTC 用户信息
 */
export interface RtcUserInfo {
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
}

/**
 * RTC 用户列表响应
 * Uses standard PaginatedResponse wrapper from services/types
 */

/**
 * 封禁用户请求
 */
export interface BanRtcUserRequest {
  reason: string;
}

/**
 * 封禁用户响应
 */
export interface BanRtcUserResponse {
  id: string;
  status: 'banned';
  banned_at: string;
  banned_reason: string;
}

/**
 * 解封用户响应
 */
export interface UnbanRtcUserResponse {
  id: string;
  status: 'active';
}

/**
 * 设备信息
 */
export interface DeviceInfo {
  id: string;
  user_id: string;
  device_id: string;
  name: string;
  user_agent: string;
  last_active_at: string;
  created_at: string;
  is_online: boolean;
}

/**
 * 设备列表响应
 */
export interface DeviceListResponse {
  items: DeviceInfo[];
}

/**
 * 每日 Token 统计
 */
export interface DailyTokenStat {
  date: string;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_read_tokens: number;
}

/**
 * Token 统计汇总
 */
export interface TokenStatsSummary {
  today_tokens: number;
  week_tokens: number;
  month_tokens: number;
  total_tokens: number;
}

/**
 * Top Session
 */
export interface TopSession {
  session_id: string;
  title: string;
  total_tokens: number;
  created_at: string;
}

/**
 * Token 统计响应
 */
export interface TokenStatsResponse {
  daily_stats: DailyTokenStat[];
  summary: TokenStatsSummary;
  top_sessions: TopSession[];
}
