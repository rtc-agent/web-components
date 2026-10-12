/**
 * JWT Token 存储管理
 *
 * 当前实现使用 localStorage 存储 access_token 和 refresh_token。
 *
 * ⚠️ 安全风险提示：
 * 将 refresh_token 存储在 localStorage 中存在 XSS 攻击风险。
 * 如果应用遭受 XSS 攻击,攻击者可能窃取 refresh_token 并长期保持认证状态。
 *
 * 📋 迁移计划：
 * 1. 短期（当前）：实现 token rotation 机制，缩短 refresh_token 过期时间
 * 2. 中期：后端改为通过 httpOnly cookie 下发 refresh_token，前端无法访问
 * 3. 长期：采用 Token Exchange 模式（RTC Agent Component 已支持）
 *    - 前端仅持有短期 access_token
 *    - 通过后端安全的 token exchange 流程获取新 token
 *
 * 🔒 当前安全措施：
 * - Token rotation：每次刷新后立即标记旧 token 为已使用
 * - 过期时间检查：refresh_token 默认 7 天过期（后端可配置更短）
 * - 重放防护：刷新时验证 token 未被使用过
 */

import { refreshToken as apiRefreshToken } from '@/services/admin-auth';
import type { RoleInfo, UserInfo } from '@/services/types';

export type { RoleInfo, UserInfo };

const ACCESS_TOKEN_KEY = 'admin_access_token';
const REFRESH_TOKEN_KEY = 'admin_refresh_token';
const USER_INFO_KEY = 'admin_user_info';
const TOKEN_EXPIRY_KEY = 'admin_token_expiry';
const REFRESH_TOKEN_EXPIRY_KEY = 'admin_refresh_token_expiry';
const REFRESH_TOKEN_ROTATION_KEY = 'admin_refresh_token_rotation';

// Refresh Token 默认过期时间：7 天（秒）
// 建议后端配置更短的过期时间（如 1-3 天）
const DEFAULT_REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60;

// Auth 状态变化事件名称
export const AUTH_STATE_CHANGED_EVENT = 'admin-auth-state-changed';

/**
 * 通知 auth 状态变化（同标签页内）
 */
function notifyAuthStateChanged() {
  window.dispatchEvent(new CustomEvent(AUTH_STATE_CHANGED_EVENT));
}

/**
 * 存储 Token
 *
 * @param accessToken - 访问令牌
 * @param refreshToken - 刷新令牌
 * @param expiresIn - 访问令牌过期时间（秒）
 * @param refreshTokenExpiresIn - 刷新令牌过期时间（秒），默认 7 天
 */
export const setTokens = (
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  refreshTokenExpiresIn: number = DEFAULT_REFRESH_TOKEN_EXPIRY,
) => {
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);

    // 存储 refresh token 及其 rotation 元数据
    const tokenWithRotation = {
      token: refreshToken,
      rotated: false,
      createdAt: Date.now(),
    };
    localStorage.setItem(REFRESH_TOKEN_KEY, JSON.stringify(tokenWithRotation));

    // 计算并存储 access token 过期时间戳
    const expiryTime = Date.now() + expiresIn * 1000;
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());

    // 计算并存储 refresh token 过期时间戳
    const refreshExpiryTime = Date.now() + refreshTokenExpiresIn * 1000;
    localStorage.setItem(
      REFRESH_TOKEN_EXPIRY_KEY,
      refreshExpiryTime.toString(),
    );

    // 清除旧的 rotation 标记
    localStorage.removeItem(REFRESH_TOKEN_ROTATION_KEY);

    // 通知 auth 状态变化
    notifyAuthStateChanged();
  } catch (error) {
    console.error('Failed to save tokens to localStorage:', error);
    // localStorage might be full or disabled
    // Continue anyway - the tokens are still in memory for this session
  }
};

/**
 * 获取 Access Token
 */
export const getAccessToken = (): string | null => {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
};

/**
 * 获取 Refresh Token
 *
 * 返回原始的 refresh token 字符串，同时验证：
 * 1. Token 未过期
 * 2. Token 未被标记为已使用（rotation 检查）
 *
 * @returns 原始 refresh token 字符串，如果无效则返回 null
 */
export const getRefreshToken = (): string | null => {
  const tokenStr = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!tokenStr) return null;

  try {
    const tokenData = JSON.parse(tokenStr);

    // 检查是否为旧格式（纯字符串），兼容历史数据
    if (typeof tokenData === 'string') {
      return tokenData;
    }

    // 检查 token 是否已被标记为已使用（防止重放攻击）
    if (tokenData.rotated) {
      console.warn('[getRefreshToken] Token 已被标记为已使用，拒绝返回');
      return null;
    }

    // 检查 refresh token 是否过期
    if (isRefreshTokenExpired()) {
      console.warn('[getRefreshToken] Token 已过期');
      return null;
    }

    return tokenData.token;
  } catch (error) {
    console.error('[getRefreshToken] 解析 token 失败:', error);
    return null;
  }
};

/**
 * 检查 Token 是否过期
 */
export const isTokenExpired = (): boolean => {
  const expiryTime = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!expiryTime) return true;

  const parsed = parseInt(expiryTime, 10);
  // NaN 防御：损坏的过期时间视为已过期
  if (Number.isNaN(parsed)) return true;

  return Date.now() >= parsed;
};

/**
 * 检查 Token 是否即将过期（提前 5 分钟）
 */
export const isTokenExpiringSoon = (): boolean => {
  const expiryTime = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!expiryTime) return true;

  const parsed = parseInt(expiryTime, 10);
  // NaN 防御：损坏的过期时间视为即将过期
  if (Number.isNaN(parsed)) return true;

  const fiveMinutesInMs = 5 * 60 * 1000;
  return Date.now() >= parsed - fiveMinutesInMs;
};

/**
 * 检查 Refresh Token 是否过期
 *
 * @returns 如果 refresh token 已过期或不存在，返回 true
 */
export const isRefreshTokenExpired = (): boolean => {
  const expiry = localStorage.getItem(REFRESH_TOKEN_EXPIRY_KEY);
  if (!expiry) return true;

  const parsed = parseInt(expiry, 10);
  // NaN 防御：损坏的过期时间视为已过期
  if (Number.isNaN(parsed)) return true;

  return Date.now() >= parsed;
};

/**
 * 存储管理员信息
 */
export const setUserInfo = (userInfo: UserInfo) => {
  try {
    localStorage.setItem(USER_INFO_KEY, JSON.stringify(userInfo));
  } catch (error) {
    console.error('Failed to save user info to localStorage:', error);
    // Continue anyway - user info is not critical for authentication
  }
};

/**
 * 获取管理员信息
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
 * 获取管理员权限列表
 */
export const getUserPermissions = (): Array<{
  resource: string;
  action: string;
}> => {
  const userInfo = getUserInfo();
  return userInfo?.permissions || [];
};

/**
 * 清除所有 Token 和管理员信息
 */
export const clearAuth = () => {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_INFO_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(REFRESH_TOKEN_EXPIRY_KEY);
    localStorage.removeItem(REFRESH_TOKEN_ROTATION_KEY);

    // 通知 auth 状态变化
    notifyAuthStateChanged();
  } catch (error) {
    console.error('Failed to clear auth from localStorage:', error);
    // Continue anyway - we're clearing state, so partial failure is acceptable
  }
};

/**
 * 检查是否已登录
 */
export const isAuthenticated = (): boolean => {
  const token = getAccessToken();
  if (!token) return false;

  return !isTokenExpired();
};

/**
 * 标记当前 refresh token 为已使用（rotation 机制）
 *
 * 在调用 refresh API 之前调用此函数，标记旧 token 为已使用。
 * 即使刷新失败，旧 token 也不能再次使用。
 */
const markRefreshTokenAsRotated = () => {
  const tokenStr = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!tokenStr) return;

  try {
    const tokenData = JSON.parse(tokenStr);

    // 检查是否为旧格式（纯字符串），如果是则跳过标记
    if (typeof tokenData === 'string') {
      console.warn('[markRefreshTokenAsRotated] 检测到旧格式 token，跳过标记');
      return;
    }

    // 标记为已使用
    tokenData.rotated = true;
    localStorage.setItem(REFRESH_TOKEN_KEY, JSON.stringify(tokenData));

    // 同时在独立的 key 中记录 rotation 状态（用于调试和审计）
    localStorage.setItem(
      REFRESH_TOKEN_ROTATION_KEY,
      JSON.stringify({
        rotatedAt: Date.now(),
        createdAt: tokenData.createdAt,
      }),
    );
  } catch (error) {
    console.error('[markRefreshTokenAsRotated] 标记 token 失败:', error);
  }
};

/**
 * 统一的 Token 刷新函数
 *
 * 使用单一 refreshPromise 防止并发刷新请求。
 * 所有需要刷新 token 的地方都应该调用此函数。
 *
 * 安全机制：
 * 1. 刷新前标记旧 refresh token 为已使用（防止重放攻击）
 * 2. 刷新成功后存储新的 refresh token
 * 3. 刷新失败时清除所有认证信息
 * 4. 超时保护（10 秒）防止 Promise 永远挂起
 *
 * @returns Promise<string | null> 刷新后的 access_token，失败返回 null
 */
let refreshPromise: Promise<string | null> | null = null;
let refreshTimeout: NodeJS.Timeout | null = null;

export const refreshAccessToken = async (): Promise<string | null> => {
  const refreshTokenValue = getRefreshToken();

  if (!refreshTokenValue) {
    console.warn('[refreshAccessToken] 未找到有效的 refresh token');
    return null;
  }

  // 如果已有刷新正在进行，复用该 Promise
  if (refreshPromise) {
    return refreshPromise;
  }

  // 创建带超时的 Promise
  refreshPromise = new Promise<string | null>((resolve, reject) => {
    // 设置超时保护（10 秒）
    refreshTimeout = setTimeout(() => {
      console.error('[refreshAccessToken] Timeout after 10s');
      // 超时后标记旧 token 为已使用（防止重放攻击）
      markRefreshTokenAsRotated();
      refreshPromise = null;
      refreshTimeout = null;
      reject(new Error('Token refresh timeout'));
    }, 10000);

    // 异步执行刷新请求
    (async () => {
      try {
        const result = await apiRefreshToken({
          refresh_token: refreshTokenValue,
        });

        // API 调用成功后再标记旧 token 为已使用
        // 这样可以避免在 API 调用期间其他代码读取到 null
        markRefreshTokenAsRotated();

        // 更新 localStorage 中的 token
        // expires_in 默认为 1 小时（3600 秒），防止 API 未返回时 token 立即过期
        // refresh_token_expires_in 默认为 7 天，建议后端配置更短的时间
        setTokens(
          result.access_token,
          result.refresh_token,
          result.expires_in || 3600,
          result.refresh_token_expires_in || DEFAULT_REFRESH_TOKEN_EXPIRY,
        );

        // 清理超时定时器
        if (refreshTimeout) {
          clearTimeout(refreshTimeout);
          refreshTimeout = null;
        }

        resolve(result.access_token);
      } catch (error) {
        // 清理超时定时器
        if (refreshTimeout) {
          clearTimeout(refreshTimeout);
          refreshTimeout = null;
        }

        console.error('[refreshAccessToken] 刷新失败:', error);
        // 刷新失败，也标记旧 token 为已使用（防止重放攻击）
        markRefreshTokenAsRotated();
        // 清除 auth 信息
        clearAuth();
        resolve(null);
      } finally {
        // 清除 Promise，允许下次刷新
        refreshPromise = null;
      }
    })();
  });

  return refreshPromise;
};

/**
 * 取消待处理的刷新请求
 *
 * 用于测试或特殊场景下的手动清理
 */
export const cancelPendingRefresh = () => {
  refreshPromise = null;
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
};
