/**
 * JWT Token 存储管理
 * 使用 localStorage 存储 access_token 和 refresh_token
 */

const ACCESS_TOKEN_KEY = 'admin_access_token';
const REFRESH_TOKEN_KEY = 'admin_refresh_token';
const USER_INFO_KEY = 'admin_user_info';
const TOKEN_EXPIRY_KEY = 'admin_token_expiry';

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
}

/**
 * 存储 Token
 */
export const setTokens = (accessToken: string, refreshToken: string, expiresIn: number) => {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);

  // 计算过期时间戳
  const expiryTime = Date.now() + expiresIn * 1000;
  localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
};

/**
 * 获取 Access Token
 */
export const getAccessToken = (): string | null => {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
};

/**
 * 获取 Refresh Token
 */
export const getRefreshToken = (): string | null => {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
};

/**
 * 检查 Token 是否过期
 */
export const isTokenExpired = (): boolean => {
  const expiryTime = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!expiryTime) return true;

  return Date.now() >= parseInt(expiryTime, 10);
};

/**
 * 检查 Token 是否即将过期（提前 5 分钟）
 */
export const isTokenExpiringSoon = (): boolean => {
  const expiryTime = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!expiryTime) return true;

  const fiveMinutesInMs = 5 * 60 * 1000;
  return Date.now() >= parseInt(expiryTime, 10) - fiveMinutesInMs;
};

/**
 * 存储用户信息
 */
export const setUserInfo = (userInfo: UserInfo) => {
  localStorage.setItem(USER_INFO_KEY, JSON.stringify(userInfo));
};

/**
 * 获取用户信息
 */
export const getUserInfo = (): UserInfo | null => {
  const userInfoStr = localStorage.getItem(USER_INFO_KEY);
  if (!userInfoStr) return null;

  try {
    return JSON.parse(userInfoStr);
  } catch {
    return null;
  }
};

/**
 * 清除所有 Token 和用户信息
 */
export const clearAuth = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_INFO_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
};

/**
 * 检查是否已登录
 */
export const isAuthenticated = (): boolean => {
  const token = getAccessToken();
  if (!token) return false;

  return !isTokenExpired();
};
