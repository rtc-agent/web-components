/**
 * 全局 RTC Agent 组件
 *
 * 作为浮窗凌驾于所有页面之上，登录后自动挂载，登出时销毁。
 * 使用 Token Exchange 模式，通过 admin JWT 交换 RTC JWT。
 *
 * 重要：此组件不使用 useModel，因为它在 rootContainer 中渲染，
 * 此时 model 的 Provider 还未初始化。改为直接读取 localStorage。
 */

import { history } from '@umijs/max';
import React, { useCallback, useEffect, useReducer } from 'react';
import { isPublicPath } from '@/constants/routes';
import {
  AUTH_STATE_CHANGED_EVENT,
  getUserInfo,
  getUserPermissions,
  isAuthenticated,
  refreshAccessToken,
} from '@/utils/auth-storage';
import { mountRtcAgent, unmountRtcAgent } from '@/utils/rtc-agent-manager';

// 权限就绪事件名称
export const PERMISSIONS_READY_EVENT = 'admin-permissions-ready';

// 状态类型定义
interface GlobalRtcAgentState {
  isLoggedIn: boolean;
  isSupported: boolean;
  permissionsReady: boolean;
  userInfoReady: boolean;
  isExcludedRoute: boolean;
}

// Action 类型定义
type Action =
  | { type: 'SET_LOGGED_IN'; payload: boolean }
  | { type: 'SET_SUPPORTED'; payload: boolean }
  | { type: 'SET_PERMISSIONS_READY'; payload: boolean }
  | { type: 'SET_USER_INFO_READY'; payload: boolean }
  | { type: 'SET_EXCLUDED_ROUTE'; payload: boolean }
  | { type: 'RESET_ON_LOGOUT' };

// Reducer 函数
const reducer = (
  state: GlobalRtcAgentState,
  action: Action,
): GlobalRtcAgentState => {
  switch (action.type) {
    case 'SET_LOGGED_IN':
      return { ...state, isLoggedIn: action.payload };
    case 'SET_SUPPORTED':
      return { ...state, isSupported: action.payload };
    case 'SET_PERMISSIONS_READY':
      return { ...state, permissionsReady: action.payload };
    case 'SET_USER_INFO_READY':
      return { ...state, userInfoReady: action.payload };
    case 'SET_EXCLUDED_ROUTE':
      return { ...state, isExcludedRoute: action.payload };
    case 'RESET_ON_LOGOUT':
      return {
        ...state,
        permissionsReady: false,
        userInfoReady: false,
      };
    default:
      return state;
  }
};

// 初始状态
const initialState: GlobalRtcAgentState = {
  isLoggedIn: false,
  isSupported: true,
  permissionsReady: false,
  userInfoReady: false,
  isExcludedRoute: false,
};

/**
 * 全局 RTC Agent 容器组件
 *
 * 特性：
 * - 登录后自动挂载到 body
 * - 登出时自动销毁
 * - Token Exchange 模式：admin JWT → RTC JWT
 * - 浮窗设计：z-index 高于 antd-pro layout
 *
 * 注意：不使用 useModel，直接读取 localStorage 判断登录状态
 * 使用事件驱动 + 轮询（备用）检测 auth 状态变化
 */
export const GlobalRtcAgent: React.FC = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    isLoggedIn,
    isSupported,
    permissionsReady,
    userInfoReady,
    isExcludedRoute,
  } = state;

  // 检查当前路由是否需要排除（使用共享的 isPublicPath 函数，避免重复定义公开路由）
  const checkRoute = useCallback(() => {
    const { pathname } = history.location;
    dispatch({ type: 'SET_EXCLUDED_ROUTE', payload: isPublicPath(pathname) });
  }, []);

  // 检查浏览器是否支持所需特性
  useEffect(() => {
    const supported =
      typeof customElements !== 'undefined' &&
      typeof window.ShadowRoot !== 'undefined' &&
      typeof window.SharedWorker !== 'undefined' &&
      typeof window.indexedDB !== 'undefined' &&
      typeof localStorage !== 'undefined';

    if (!supported) {
      console.error(
        '[GlobalRtcAgent] Browser does not support required features',
      );
      dispatch({ type: 'SET_SUPPORTED', payload: false });
    }

    // 初始检查路由
    checkRoute();
  }, [checkRoute]);

  // 监听路由变化
  useEffect(() => {
    // 监听 history 变化
    const unlisten = history.listen(() => {
      checkRoute();
    });

    return () => {
      unlisten();
    };
  }, [checkRoute]);

  // 防止并发 refresh 请求（已移到 auth-storage.ts 的 refreshAccessToken 中）

  const checkAuth = useCallback(async () => {
    // 如果在排除的路由上，不检查认证状态
    if (isExcludedRoute) {
      dispatch({ type: 'SET_LOGGED_IN', payload: false });
      console.debug('[GlobalRtcAgent] On excluded route, forcing logout');
      return;
    }

    let authenticated = isAuthenticated();

    // Token 过期但 refresh token 仍在？先尝试刷新，避免误判为未登录
    if (!authenticated) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        authenticated = true;
      }
    }

    dispatch({ type: 'SET_LOGGED_IN', payload: authenticated });
    console.debug('[GlobalRtcAgent] Auth state changed:', authenticated);
  }, [isExcludedRoute]);

  useEffect(() => {
    console.debug('[GlobalRtcAgent] Component mounted');

    // 初始检查
    checkAuth();

    // 监听 auth 状态变化事件（同标签页内即时响应）
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, checkAuth);

    // 监听 storage 事件（跨标签页同步）
    window.addEventListener('storage', checkAuth);

    // 监听网络状态变化
    const handleOnline = () => {
      console.debug('[GlobalRtcAgent] Network online');
      // 网络恢复时，如果已登录且 agent 已挂载，组件会自动重连
    };

    const handleOffline = () => {
      console.debug('[GlobalRtcAgent] Network offline');
      // 网络断开时，组件会自动处理重连逻辑
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 监听页面可见性变化（优化性能）
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.debug('[GlobalRtcAgent] Tab hidden');
        // 页面隐藏时，可以减少轮询频率或暂停某些操作
      } else {
        console.debug('[GlobalRtcAgent] Tab visible');
        // 页面可见时，立即检查 auth 状态
        checkAuth();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 备用：定期检查登录状态变化（每 5 秒）
    // 作为事件驱动的后备方案，确保不会错过任何状态变化
    // 注意：轮询间隔从 2 秒增加到 5 秒，减少不必要的检查
    const interval = setInterval(checkAuth, 5000);

    return () => {
      console.debug('[GlobalRtcAgent] Component unmounting');
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, checkAuth);
      window.removeEventListener('storage', checkAuth);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [checkAuth]);

  // 路由变化时重新检查认证状态
  useEffect(() => {
    console.debug('[GlobalRtcAgent] Route changed, excluded:', isExcludedRoute);
    checkAuth();
  }, [isExcludedRoute, checkAuth]);

  // 等待权限信息和用户信息加载完成
  useEffect(() => {
    if (!isLoggedIn) {
      dispatch({ type: 'RESET_ON_LOGOUT' });
      return;
    }

    // 检查权限和用户信息是否已加载
    const checkData = () => {
      const permissions = getUserPermissions();
      const userInfo = getUserInfo();

      if (permissions.length > 0) {
        console.debug('[GlobalRtcAgent] Permissions loaded:', permissions);
        dispatch({ type: 'SET_PERMISSIONS_READY', payload: true });
      }

      if (userInfo?.id) {
        console.debug('[GlobalRtcAgent] User info loaded:', userInfo.id);
        dispatch({ type: 'SET_USER_INFO_READY', payload: true });
      }

      return permissions.length > 0 && !!userInfo?.id;
    };

    // 立即检查一次
    if (checkData()) {
      return;
    }

    // 监听权限就绪事件（由 app.tsx 的 fetchUserInfo 成功后触发）
    const handlePermissionsReady = () => {
      console.debug('[GlobalRtcAgent] Permissions ready event received');
      checkData();
    };

    window.addEventListener(PERMISSIONS_READY_EVENT, handlePermissionsReady);

    // 兜底：5 秒超时后强制设置就绪状态
    const startTime = Date.now();
    const timeout = setInterval(() => {
      if (checkData() || Date.now() - startTime > 5000) {
        clearInterval(timeout);
        if (!permissionsReady) {
          console.warn(
            '[GlobalRtcAgent] Permissions not loaded after 5s, mounting with empty permissions',
          );
          dispatch({ type: 'SET_PERMISSIONS_READY', payload: true });
        }
        if (!userInfoReady) {
          console.warn(
            '[GlobalRtcAgent] User info not loaded after 5s, mounting may use fallback userId',
          );
          dispatch({ type: 'SET_USER_INFO_READY', payload: true });
        }
      }
    }, 100);

    return () => {
      window.removeEventListener(
        PERMISSIONS_READY_EVENT,
        handlePermissionsReady,
      );
      clearInterval(timeout);
    };
  }, [isLoggedIn]);

  // Handle mount/unmount based on auth state, permissions, user info, and browser support.
  // Mount and unmount are in separate effects so that permission/userInfo state changes
  // do not re-trigger unmount calls (which would cause double-unmount).
  useEffect(() => {
    console.debug(
      '[GlobalRtcAgent] isLoggedIn:',
      isLoggedIn,
      'permissionsReady:',
      permissionsReady,
      'userInfoReady:',
      userInfoReady,
    );

    if (!isSupported) {
      console.warn('[GlobalRtcAgent] Browser not supported, skipping mount');
      return;
    }

    // 等待权限和用户信息都加载完成再挂载，确保 getUserId() 能返回有效值
    if (isLoggedIn && permissionsReady && userInfoReady) {
      console.debug('[GlobalRtcAgent] Mounting RTC Agent...');
      // 从 localStorage 读取管理员权限，传递给 mountRtcAgent 进行 Function 过滤
      const permissions = getUserPermissions();
      console.debug('[GlobalRtcAgent] User permissions:', permissions);
      mountRtcAgent(permissions);
    }
  }, [isLoggedIn, isSupported, permissionsReady, userInfoReady]);

  // Unmount effect: separate from mount so that permissionsReady changes
  // do not cause a second unmountRtcAgent() call.
  useEffect(() => {
    if (!isSupported) return;
    if (!isLoggedIn) {
      console.debug('[GlobalRtcAgent] Unmounting RTC Agent...');
      unmountRtcAgent();
    }
  }, [isLoggedIn, isSupported]);

  // Cleanup on component unmount only (not on dependency changes).
  // This ensures the RTC Agent is destroyed when the component is removed
  // from the tree while logged in.
  useEffect(() => {
    return () => {
      console.debug(
        '[GlobalRtcAgent] Component unmounting, cleaning up RTC Agent',
      );
      unmountRtcAgent();
    };
  }, []);

  // 不渲染任何 DOM
  return null;
};
