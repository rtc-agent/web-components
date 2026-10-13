/**
 * RTC Agent AuthProvider 工厂
 *
 * 为 admin-ui 提供 Token Exchange 模式下的 AuthProvider 实现。
 * admin-server 签发的 admin JWT 作为外部 JWT，通过 RTC Agent 的 Token Exchange
 * 端点交换为 RTC JWT，用于 WebSocket 连接认证。
 *
 * ARCHITECTURE NOTE (P2-6):
 * -------------------------
 * This file imports AuthProvider from @rtc-agent/component, which is an internal
 * type definition from the component package. This creates a coupling between
 * admin-ui and component's internal implementation details.
 *
 * Ideally, AuthProvider should be defined in a shared protocol/types package that
 * both component and admin-ui can depend on. This would establish a cleaner
 * dependency hierarchy and make it easier to evolve the auth interface independently.
 *
 * FUTURE IMPROVEMENT:
 * Move AuthProvider interface to @rtc-agent/protocol or create a new
 * @rtc-agent/auth-types package:
 *   - @rtc-agent/protocol/src/auth.ts (AuthProvider, AuthConfig)
 *   - Both component and admin-ui import from protocol
 *
 * For now, importing from component is acceptable because:
 * - AuthProvider is part of the public API (exported from component's index.ts)
 * - The interface is stable and unlikely to change frequently
 * - admin-ui is tightly coupled to component anyway (it hosts the component)
 *
 * @see docs/admin-system-requirements.md 第四章 Token Exchange 流程
 */

/**
 * ARCHITECTURE NOTE (P2-6):
 * AuthProvider is imported from component (internal type).
 * See file-level comment for improvement suggestions.
 */
import type { AuthProvider } from '@rtc-agent/component';
import { logout as apiLogout } from '@/services/admin-auth';
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  getUserInfo,
  isAuthenticated,
  isTokenExpired,
  isTokenExpiringSoon,
  refreshAccessToken,
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
     * 如果 admin JWT 即将过期（提前 5 分钟），先刷新再返回。
     * 使用统一的 refreshAccessToken 函数防止并发刷新请求。
     */
    getExchangeToken: async (): Promise<string> => {
      // 检查是否需要刷新（提前 5 分钟）
      if (isTokenExpiringSoon()) {
        const refreshToken = await getRefreshToken(); // 异步获取（可能需要解密）
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

      const token = getAccessToken();
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
      const refreshToken = await getRefreshToken(); // 异步获取（可能需要解密）
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
