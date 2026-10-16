/**
 * RTC Agent AuthProvider 工厂
 *
 * 为 admin-ui 提供 Token Exchange 模式下的 AuthProvider 实现。
 * admin-server 签发的 admin JWT 作为外部 JWT，通过 RTC Agent 的 Token Exchange
 * 端点交换为 RTC JWT，用于 WebSocket 连接认证。
 *
 * @see docs/admin-system-requirements.md 第四章 Token Exchange 流程
 */

import type { AuthProvider, ExchangeTokenHint } from '@rtc-agent/component';
import { logout as apiLogout } from '@/services/admin-auth';
import {
  clearAuth,
  getAccessTokenDecrypted,
  getRefreshToken,
  getUserInfo,
  isAuthenticated,
  isTokenExpired,
  isTokenExpiringSoon,
  refreshAccessToken,
  refreshAccessTokenForExchange,
  waitForConcurrentRefresh,
} from '@/utils/auth-storage';

const DEVICE_ID_KEY = 'rtc_device_id';

/**
 * 获取或生成 Device ID
 *
 * Device ID 是 RTC Agent 的自定义扩展参数，用于：
 * 1. Token Exchange 时传递给 RTC Server（嵌入 JWT）
 * 2. RTC 执行时过滤只属于当前设备的 session_device_id
 * 3. 持久化到 localStorage，确保刷新后保持一致
 */
export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    // 使用 crypto.randomUUID() 生成 UUID v4
    id = crypto.randomUUID();
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch (error) {
      console.warn('Failed to save device ID to localStorage:', error);
      // 即使保存失败，仍然返回生成的 ID（本次会话有效）
    }
  }
  return id;
}

/**
 * 创建 admin-ui 的 AuthProvider 实例
 *
 * 使用 Token Exchange 模式：
 * - type: 'token-exchange'
 * - getExchangeToken(): 返回 admin JWT（admin-server 签发）
 * - RTC Agent 组件内部会调用 OAuth2Client.tokenExchange() 交换为 RTC JWT
 *
 * @example
 * ```ts
 * const agent = createRtcAgent({
 *   server: { url: RTC_AGENT_URL },
 *   auth: createAdminAuthProvider(),
 * });
 * ```
 */
export function createAdminAuthProvider(): AuthProvider {
  return {
    type: 'token-exchange',

    /**
     * 返回外部 JWT（admin JWT）
     *
     * 由 RTC Agent 组件调用，用于 Token Exchange。
     *
     * 触发刷新的两种情况：
     *  1. admin JWT 即将过期（提前 5 分钟）→ 常规刷新（失败即 logout）
     *  2. hint.reason === 'already_used' → RTC Agent 组件检测到上一次 exchange
     *     被服务端拒绝（重放保护）。此时用轻量刷新函数（失败不清 auth，
     *     用户不会被 logout；下次 retry 仍把现有 token 送出去）。
     */
    getExchangeToken: async (hint?: ExchangeTokenHint): Promise<string> => {
      // Case 2: Token Exchange 重放拒绝 → 强制刷新但不破坏现有状态。
      // 旧的 admin JWT 虽不能再被 exchange，但仍可用于 admin-server API，
      // 因此刷新失败时保留本地状态比直接 logout 更友好。
      if (hint?.reason === 'already_used') {
        const refreshToken = await getRefreshToken();
        if (refreshToken) {
          const newToken = await refreshAccessTokenForExchange();
          if (newToken) {
            return newToken;
          }
          // 刷新失败：抛出错误，让 Auth Controller 的重试循环决定是否继续
          // 而不是返回已知无效的旧 token（会导致 5 次无效重试）
          console.warn('[getExchangeToken] refresh failed after already_used rejection');
          throw new Error('Failed to refresh token after already_used rejection');
        }

        // Refresh token 已被标记为 rotated，说明其他地方（如 checkAuth）刚完成了刷新
        // 等待并发刷新真正完成（而不是盲目等待固定时间）
        // waitForConcurrentRefresh() 会检查 refreshPromise 是否存在，
        // 如果存在则 await 它，确保 setTokens() 的加密操作已完成
        await waitForConcurrentRefresh();

        // 重新读取最新的 access token（应该已经被并发刷新更新了）
        const newToken = await getAccessTokenDecrypted();
        if (newToken) {
          return newToken;
        }

        // 仍然没有 token，无法继续
        throw new Error('No refresh token or access token available for already_used retry');
      }

      // Case 1: 常规过期刷新（失败即 logout，保持原有行为）
      if (isTokenExpiringSoon()) {
        const refreshToken = await getRefreshToken();
        if (refreshToken) {
          // 使用统一的刷新函数
          const newToken = await refreshAccessToken();
          if (newToken) {
            return newToken;
          }
          // 刷新失败
          throw new Error('Failed to refresh admin token');
        } else if (isTokenExpired()) {
          // 没有 refresh token 且 token 已过期，无法继续
          throw new Error('Admin token expired and no refresh token available');
        }
      }

      const token = await getAccessTokenDecrypted();
      if (!token) {
        throw new Error('No admin access token available');
      }
      return token;
    },

    /**
     * 检查是否已登录
     *
     * RTC Agent 组件用来判断是否需要触发登录流程。
     */
    isLoggedIn: (): boolean => {
      return isAuthenticated();
    },

    /**
     * 登出处理
     *
     * 由 RTC Agent 组件在检测到认证失败时调用。
     * 宿主应用负责：
     * 1. 调用 admin-server 撤销 refresh_token
     * 2. 清除 localStorage
     * 3. 跳转登录页（由调用方处理）
     */
    logout: async (): Promise<void> => {
      const refreshToken = await getRefreshToken();
      if (refreshToken) {
        try {
          await apiLogout({ refresh_token: refreshToken });
        } catch (error) {
          // 即使撤销失败也继续清除本地状态
          console.warn('Failed to revoke refresh token:', error);
        }
      }
      clearAuth();
    },

    /**
     * 返回当前管理员 ID
     *
     * 用于构造 IndexedDB 名称（{databaseName}-{userId}）。
     */
    getUserId: (): string => {
      const userInfo = getUserInfo();
      return userInfo?.id ?? '';
    },

    /**
     * Device ID
     *
     * 必须与 JWT 中的 device_id 一致，否则 RTC 脚本执行会被过滤。
     */
    deviceId: getOrCreateDeviceId(),
  };
}
