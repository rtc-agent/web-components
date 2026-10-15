/**
 * JWT Token 存储管理
 *
 * 当前实现使用 localStorage 存储 access_token 和 refresh_token。
 *
 * ⚠️ 安全风险提示：
 * 将 refresh_token 存储在 localStorage 中存在 XSS 攻击风险。
 * 如果应用遭受 XSS 攻击，攻击者可能窃取 refresh_token 并长期保持认证状态。
 *
 * 🔒 当前安全措施（2026-10-13 增强）：
 * - Token rotation：每次刷新后立即标记旧 token 为已使用
 * - 过期时间检查：refresh_token 默认 3 天过期（从 7 天缩短）
 * - 重放防护：刷新时验证 token 未被使用过
 * - 超时保护：10 秒超时 + AbortController，超时后立即取消 HTTP 请求
 *
 * 📋 迁移计划：
 * 1. 短期（当前）：实施 token rotation 机制，缩短 refresh_token 过期时间
 * 2. 中期：后端改为通过 httpOnly cookie 下发 refresh_token，前端无法访问
 * 3. 长期：采用 Token Exchange 模式（RTC Agent Component 已支持）
 *    - 前端仅持有短期 access_token
 *    - 通过后端安全的 token exchange 流程获取新 token
 */

import { clearPermissionCache } from '@/access';
import { refreshToken as apiRefreshToken } from '@/services/admin-auth';
import type { RoleInfo, UserInfo } from '@/services/types';
import {
  clearEncryptionKey,
  decryptToken,
  encryptToken,
} from './token-encryption';

export type { RoleInfo, UserInfo };

const ACCESS_TOKEN_KEY = 'admin_access_token';
const REFRESH_TOKEN_KEY = 'admin_refresh_token';
const USER_INFO_KEY = 'admin_user_info';
const TOKEN_EXPIRY_KEY = 'admin_token_expiry';
const REFRESH_TOKEN_EXPIRY_KEY = 'admin_refresh_token_expiry';
const REFRESH_TOKEN_ROTATION_KEY = 'admin_refresh_token_rotation';

// Refresh Token 默认过期时间：3 天（秒）
// 建议后端配置更短的过期时间（如 1-3 天）
// 2026-10-13: 从 7 天缩短至 3 天，减少 Token 泄露后的攻击窗口
const DEFAULT_REFRESH_TOKEN_EXPIRY = 3 * 24 * 60 * 60;

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
 * @param refreshTokenExpiresIn - 刷新令牌过期时间（秒），默认 3 天
 */
export const setTokens = async (
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  refreshTokenExpiresIn: number = DEFAULT_REFRESH_TOKEN_EXPIRY,
) => {
  try {
    // 加密 access token 和 refresh token
    // P1 修复 (2026-10-14): encryptToken 现在会在加密失败时抛出错误
    // 而非降级到明文存储。这确保了 token 始终以加密形式存储。
    const [encryptedAccess, encryptedRefresh] = await Promise.all([
      encryptToken(accessToken),
      encryptToken(refreshToken),
    ]);

    localStorage.setItem(ACCESS_TOKEN_KEY, encryptedAccess);

    // 存储 refresh token 及其 rotation 元数据
    const tokenWithRotation = {
      token: encryptedRefresh, // 存储加密后的 token
      rotated: false,
      createdAt: Date.now(),
      encrypted: true, // 标记此 token 已加密
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
    // P1 修复：加密失败时不再静默继续，而是清除 token 并抛出错误
    // 这确保了不会出现"加密失败但 token 已存储为明文"的不一致状态
    console.error('Failed to encrypt and save tokens:', error);

    // 清除可能已部分写入的 token（防止明文泄漏）
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // 清除失败时忽略错误
    }

    // 重新抛出错误，让调用方知道 token 存储失败
    throw new Error(
      'Token encryption failed. Please ensure you are using a modern browser. ' +
        'If the problem persists, contact support.',
    );
  }
};

/**
 * 获取 Access Token（同步版本，返回加密值）
 *
 * ⚠️ 注意：此函数返回的是**加密后的 token**，不能直接用于 API 调用。
 * 如果需要使用 token 值，请调用 `getAccessTokenDecrypted()` 异步解密版本。
 *
 * 典型使用场景：
 * - 检查 token 是否存在（如 isAuthenticated()）
 * - 需要快速判断登录状态（同步场景）
 *
 * @returns 加密后的 access token 字符串，如果不存在则返回 null
 */
export const getAccessToken = (): string | null => {
  const encrypted = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!encrypted) return null;

  // 返回加密值，调用方不应直接使用此值进行 API 调用
  // 如需解密后的 token，请使用 getAccessTokenDecrypted()
  return encrypted;
};

/**
 * 获取 Access Token（异步解密版本）
 *
 * P1 修复 (2026-10-14): decryptToken 现在会在解密失败时抛出错误。
 * 此函数捕获解密错误并清除损坏的 token，然后返回 null。
 *
 * @returns 解密后的 access token，如果无效或解密失败则返回 null
 */
export const getAccessTokenDecrypted = async (): Promise<string | null> => {
  const encrypted = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!encrypted) return null;

  try {
    return await decryptToken(encrypted);
  } catch (error) {
    // P1 修复：解密失败时清除损坏的 token 并返回 null
    // 这避免了"解密失败但返回明文旧 token"的不一致状态
    console.error('Failed to decrypt access token, clearing:', error);
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    } catch {
      // 清除失败时忽略错误
    }
    return null;
  }
};

/**
 * 获取 Refresh Token
 *
 * 返回原始的 refresh token 字符串，同时验证：
 * 1. Token 未过期
 * 2. Token 未被标记为已使用（rotation 检查）
 * 3. Token 已解密（如果加密）
 *
 * P1 修复 (2026-10-14): decryptToken 现在会在解密失败时抛出错误。
 * 此函数捕获解密错误并清除损坏的 token，然后返回 null。
 *
 * @returns 原始 refresh token 字符串，如果无效或解密失败则返回 null
 */
export const getRefreshToken = async (): Promise<string | null> => {
  const tokenStr = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!tokenStr) return null;

  try {
    const tokenData = JSON.parse(tokenStr);

    // 检查是否为旧格式（纯字符串），兼容历史数据
    if (typeof tokenData === 'string') {
      // P1 修复：检测到旧格式 token 时发出警告
      // 这些 token 未加密，应在下次登录时重新加密
      console.warn(
        '[getRefreshToken] Detected legacy unencrypted token. ' +
          'This token should be re-encrypted on next login.',
      );
      return tokenData; // 旧 token 未加密，直接返回
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

    // 解密 token（如果已加密）
    if (tokenData.encrypted) {
      try {
        return await decryptToken(tokenData.token);
      } catch (decryptError) {
        // P1 修复：解密失败时清除损坏的 token 并返回 null
        console.error(
          '[getRefreshToken] Failed to decrypt token, clearing:',
          decryptError,
        );
        try {
          localStorage.removeItem(REFRESH_TOKEN_KEY);
        } catch {
          // 清除失败时忽略错误
        }
        return null;
      }
    }

    // 未加密的旧 token，直接返回
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

    // 清除加密密钥（防止 sessionStorage 中的密钥被用于解密其他标签页的 token）
    clearEncryptionKey();

    // P0-3 修复：清除权限缓存，防止登出后残留的权限被误用
    clearPermissionCache();

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
 * 4. 超时保护（10 秒）+ AbortController，超时后立即取消 HTTP 请求
 *
 * 设计权衡：去重优先于激进重试
 * - 如果刷新请求挂起（超过 10s 超时），refreshPromise 会阻止后续刷新尝试
 * - 这是有意为之：避免并发刷新导致的 token rotation 冲突
 * - 超时机制（10s）确保 promise 最终会被清理，不会永久阻塞
 * - 用户可通过重新登录恢复，无需激进重试
 *
 * @returns Promise<string | null> 刷新后的 access_token，失败返回 null
 */
let refreshPromise: Promise<string | null> | null = null;
let refreshTimeout: NodeJS.Timeout | null = null;
let refreshAbortController: AbortController | null = null;

export const refreshAccessToken = async (): Promise<string | null> => {
  const refreshTokenValue = await getRefreshToken();

  if (!refreshTokenValue) {
    console.warn('[refreshAccessToken] 未找到有效的 refresh token');
    return null;
  }

  // 如果已有刷新正在进行，复用该 Promise
  if (refreshPromise) {
    return refreshPromise;
  }

  // 创建 AbortController 用于超时后取消请求
  refreshAbortController = new AbortController();

  // 创建带超时的 Promise
  refreshPromise = new Promise<string | null>((resolve, reject) => {
    // 设置超时保护（10 秒）
    refreshTimeout = setTimeout(() => {
      console.error('[refreshAccessToken] Timeout after 10s, aborting request');
      // 超时后立即取消 HTTP 请求
      if (refreshAbortController) {
        refreshAbortController.abort();
      }
      // 超时后标记旧 token 为已使用（防止重放攻击）
      markRefreshTokenAsRotated();
      refreshPromise = null;
      refreshTimeout = null;
      refreshAbortController = null;
      reject(new Error('Token refresh timeout'));
    }, 10000);

    // 异步执行刷新请求
    (async () => {
      try {
        const result = await apiRefreshToken(
          { refresh_token: refreshTokenValue },
          { signal: refreshAbortController?.signal },
        );

        // API 调用成功后再标记旧 token 为已使用
        // 这样可以避免在 API 调用期间其他代码读取到 null
        markRefreshTokenAsRotated();

        // 更新 localStorage 中的 token
        // expires_in 默认为 1 小时（3600 秒），防止 API 未返回时 token 立即过期
        // refresh_token_expires_in 默认为 3 天，建议后端配置更短的时间
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
        refreshAbortController = null;

        resolve(result.access_token);
      } catch (error) {
        // 清理超时定时器
        if (refreshTimeout) {
          clearTimeout(refreshTimeout);
          refreshTimeout = null;
        }
        refreshAbortController = null;

        // 如果是取消请求导致的错误，不记录为刷新失败
        if (error instanceof Error && error.name === 'AbortError') {
          console.warn(
            '[refreshAccessToken] Request was aborted due to timeout',
          );
          resolve(null);
          return;
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
  if (refreshAbortController) {
    refreshAbortController.abort();
    refreshAbortController = null;
  }
};
