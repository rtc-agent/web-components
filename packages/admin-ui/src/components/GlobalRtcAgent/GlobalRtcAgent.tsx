/**
 * 全局 RTC Agent 组件
 *
 * 作为浮窗凌驾于所有页面之上，登录后自动挂载，登出时销毁。
 * 使用 Token Exchange 模式，通过 admin JWT 交换 RTC JWT。
 *
 * 重要：此组件不使用 useModel，因为它在 rootContainer 中渲染，
 * 此时 model 的 Provider 还未初始化。改为直接读取 localStorage。
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AUTH_STATE_CHANGED_EVENT,
  getUserInfo,
  getUserPermissions,
  isAuthenticated,
} from '@/utils/auth-storage';
import { mountRtcAgent, unmountRtcAgent } from '@/utils/rtc-agent-manager';

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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [userInfoReady, setUserInfoReady] = useState(false);

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
      setIsSupported(false);
    }
  }, []);

  const checkAuth = useCallback(() => {
    const authenticated = isAuthenticated();
    setIsLoggedIn((prev) => {
      if (prev !== authenticated) {
        console.log('[GlobalRtcAgent] Auth state changed:', authenticated);
        return authenticated;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    console.log('[GlobalRtcAgent] Component mounted');

    // 初始检查
    checkAuth();

    // 监听 auth 状态变化事件（同标签页内即时响应）
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, checkAuth);

    // 监听 storage 事件（跨标签页同步）
    window.addEventListener('storage', checkAuth);

    // 监听网络状态变化
    const handleOnline = () => {
      console.log('[GlobalRtcAgent] Network online');
      // 网络恢复时，如果已登录且 agent 已挂载，组件会自动重连
    };

    const handleOffline = () => {
      console.log('[GlobalRtcAgent] Network offline');
      // 网络断开时，组件会自动处理重连逻辑
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 监听页面可见性变化（优化性能）
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('[GlobalRtcAgent] Tab hidden');
        // 页面隐藏时，可以减少轮询频率或暂停某些操作
      } else {
        console.log('[GlobalRtcAgent] Tab visible');
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
      console.log('[GlobalRtcAgent] Component unmounting');
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, checkAuth);
      window.removeEventListener('storage', checkAuth);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [checkAuth]);

  // 等待权限信息和用户信息加载完成
  useEffect(() => {
    if (!isLoggedIn) {
      setPermissionsReady(false);
      setUserInfoReady(false);
      return;
    }

    // 检查权限和用户信息是否已加载
    const checkData = () => {
      const permissions = getUserPermissions();
      const userInfo = getUserInfo();

      if (permissions.length > 0) {
        console.log('[GlobalRtcAgent] Permissions loaded:', permissions);
        setPermissionsReady(true);
      }

      if (userInfo?.id) {
        console.log('[GlobalRtcAgent] User info loaded:', userInfo.id);
        setUserInfoReady(true);
      }

      return permissions.length > 0 && !!userInfo?.id;
    };

    // 立即检查一次
    if (checkData()) {
      return;
    }

    // 如果还没有，轮询等待（最多 5 秒）
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (checkData() || Date.now() - startTime > 5000) {
        clearInterval(interval);
        if (!permissionsReady) {
          console.warn(
            '[GlobalRtcAgent] Permissions not loaded after 5s, mounting with empty permissions',
          );
          setPermissionsReady(true);
        }
        if (!userInfoReady) {
          console.warn(
            '[GlobalRtcAgent] User info not loaded after 5s, mounting may use fallback userId',
          );
          setUserInfoReady(true);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isLoggedIn]);

  // Handle mount/unmount based on auth state, permissions, user info, and browser support.
  // Mount and unmount are in separate effects so that permission/userInfo state changes
  // do not re-trigger unmount calls (which would cause double-unmount).
  useEffect(() => {
    console.log(
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
      console.log('[GlobalRtcAgent] Mounting RTC Agent...');
      // 从 localStorage 读取管理员权限，传递给 mountRtcAgent 进行 Function 过滤
      const permissions = getUserPermissions();
      console.log('[GlobalRtcAgent] User permissions:', permissions);
      mountRtcAgent(permissions);
    }
  }, [isLoggedIn, isSupported, permissionsReady, userInfoReady]);

  // Unmount effect: separate from mount so that permissionsReady changes
  // do not cause a second unmountRtcAgent() call.
  useEffect(() => {
    if (!isSupported) return;
    if (!isLoggedIn) {
      console.log('[GlobalRtcAgent] Unmounting RTC Agent...');
      unmountRtcAgent();
    }
  }, [isLoggedIn, isSupported]);

  // Cleanup on component unmount only (not on dependency changes).
  // This ensures the RTC Agent is destroyed when the component is removed
  // from the tree while logged in.
  useEffect(() => {
    return () => {
      console.log(
        '[GlobalRtcAgent] Component unmounting, cleaning up RTC Agent',
      );
      unmountRtcAgent();
    };
  }, []);

  // 不渲染任何 DOM
  return null;
};
