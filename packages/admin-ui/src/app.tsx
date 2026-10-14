import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { getLocale, history, Link, useIntl } from '@umijs/max';
import { App } from 'antd';
import { useEffect } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { InitialState } from '@/initialState.types';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/zh-tw';
import 'dayjs/locale/ja';
import 'dayjs/locale/ko';
import 'dayjs/locale/fr';
import 'dayjs/locale/de';
import 'dayjs/locale/es';
import 'dayjs/locale/pt';
import 'dayjs/locale/pt-br';
import 'dayjs/locale/ru';
import 'dayjs/locale/ar';
import 'dayjs/locale/id';
import 'dayjs/locale/bn';
import 'dayjs/locale/bn-bd';
import 'dayjs/locale/fa';
import React from 'react';

// Initialize dayjs plugins globally
dayjs.extend(relativeTime);

import {
  AvatarDropdown,
  DocLink,
  ErrorBoundary,
  Footer,
  GlobalRtcAgent,
  LangDropdown,
  OfflineBanner,
} from '@/components';
import {
  PERM_ADMIN_USER_READ,
  PERM_AUDIT_LOG_READ,
  PERM_DASHBOARD_READ,
  PERM_PERMISSION_READ,
  PERM_ROLE_READ,
  PERM_RTC_MESSAGE_READ,
  PERM_RTC_SESSION_READ,
  PERM_RTC_USER_READ,
  PERM_SERVER_CONFIG_READ,
} from '@/constants/permissions';
import { isPublicPath, PUBLIC_PATHS } from '@/constants/routes';
import { getCurrentUser } from '@/services/admin-auth';
import { AUTH_STATE_CHANGED_EVENT } from '@/utils/auth-storage';
import {
  cancelPendingRefresh,
  getUserInfo,
  isAuthenticated,
  setUserInfo,
} from '@/utils/auth-storage';
import {
  loadDayjsLocale,
  RTL_LOCALES,
  setDocumentDirection,
} from '@/utils/locale-helpers';
import { buildCurrentUser } from '@/utils/permission';
import {
  getGlobalFeedbackInstances,
  setGlobalFeedbackInstances,
} from '@/utils/globalFeedback';
import defaultSettings from '../config/defaultSettings';
import { errorConfig, setGlobalSetInitialState } from './requestErrorConfig';

// localStorage key for theme settings persistence
const THEME_SETTINGS_KEY = 'admin_ui_theme';

/**
 * Message Theme Configurator
 *
 * Ant Design's static message API (message.success, message.error, etc.) doesn't
 * automatically consume ConfigProvider theme context. This component bridges that gap
 * by registering the context-aware instances globally for use in non-component code.
 *
 * Usage: Render once in the component tree, typically near the root.
 */
const MessageThemeConfig: React.FC = () => {
  const { message, notification } = App.useApp();

  useEffect(() => {
    // Register global instances so non-component code (request interceptors, utilities)
    // can access context-aware feedback APIs
    setGlobalFeedbackInstances({ message, notification });

    return () => {
      // Cleanup on unmount (optional, but good practice)
      setGlobalFeedbackInstances(null as any);
    };
  }, [message, notification]);

  return null;
};

/**
 * Load theme settings from localStorage, fallback to system preference
 */
const loadThemeSettings = (): Partial<LayoutSettings> => {
  try {
    const stored = localStorage.getItem(THEME_SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored) as Partial<LayoutSettings>;
    }
  } catch (_e) {
    // Ignore parse errors, use defaults
  }

  // Detect system color scheme preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    ...defaultSettings,
    navTheme: prefersDark ? 'realDark' : 'light',
  } as Partial<LayoutSettings>;
};

/**
 * Save theme settings to localStorage
 */
const saveThemeSettings = (settings: Partial<LayoutSettings>): void => {
  try {
    localStorage.setItem(THEME_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_e) {
    // Ignore storage errors
  }
};

// Timeout for initialization to prevent permanent pending state
const INIT_TIMEOUT_MS = 30000; // 30 seconds

// Track whether degraded-state warning has been shown (once per session)
// Note: Module-level variable persists across re-renders but resets on HMR/page reload.
// This is intentional: show the warning once per session to avoid repeated toasts,
// but allow it to reappear after page reload (which may indicate a real issue).
let degradedWarningShown = false;

// Initialization promise for deduplication during rapid route changes
// Single Promise pattern: concurrent calls await the same promise
//
// Design note on shared AbortController:
// All concurrent awaiters share a single AbortController and timeout.
// This is intentional: the deduplication pattern ensures only ONE fetch request
// is in-flight regardless of how many getInitialState calls occur concurrently
// (e.g., rapid route changes). Since all awaiters want the same data (currentUser),
// they should share the same fate — if the fetch times out or fails, all callers
// receive the same result (undefined or cached fallback). Creating per-caller
// AbortControllers would defeat deduplication and cause redundant network requests.
let initPromise: Promise<API.CurrentUser | undefined> | null = null;

// Module-level references for proper cleanup during HMR
let initAbortController: AbortController | null = null;
let initTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Clean up init promise on HMR to prevent stale state across hot reloads
if (typeof module !== 'undefined' && module.hot) {
  module.hot.dispose(() => {
    initPromise = null;
    // Abort any in-flight request to prevent orphan callbacks
    if (initAbortController) {
      initAbortController.abort();
      initAbortController = null;
    }
    // Clear the timeout to prevent orphan timer from firing
    if (initTimeoutId) {
      clearTimeout(initTimeoutId);
      initTimeoutId = null;
    }
    // Reset degraded warning flag so it re-appears after HMR if the issue persists
    degradedWarningShown = false;
    // Cancel any pending token refresh to prevent orphan requests
    cancelPendingRefresh();
  });
}

// Reset degraded warning flag on auth state changes (logout/re-login without page reload).
// This ensures the warning can re-appear for the new session if needed.
window.addEventListener(AUTH_STATE_CHANGED_EVENT, () => {
  degradedWarningShown = false;
});

/**
 * @see https://umijs.org/docs/api/runtime-config#getinitialstate
 * */
export async function getInitialState(): Promise<InitialState> {
  try {
    // Set document direction and load dayjs locale early.
    // These are non-critical cosmetic initializations — wrap individually
    // so their failure never blocks the authentication flow.
    try {
      setDocumentDirection();
    } catch (e) {
      const currentLocale = navigator.language || 'unknown';
      console.warn(
        `[getInitialState] setDocumentDirection failed (locale: ${currentLocale}), using default ltr`,
        e,
      );
    }
    try {
      loadDayjsLocale();
    } catch (e) {
      const currentLocale = navigator.language || 'unknown';
      console.warn(
        `[getInitialState] loadDayjsLocale failed (locale: ${currentLocale}), using default en`,
        e,
      );
    }

    const fetchUserInfo = async (
      signal?: AbortSignal,
    ): Promise<API.CurrentUser | undefined> => {
      // Check if already aborted before starting
      if (signal?.aborted) {
        return undefined;
      }

      // 先检查 localStorage 是否有有效的 token
      if (!isAuthenticated()) {
        return undefined;
      }

      try {
        // 调用真正的 API 获取管理员信息
        const userInfo = await getCurrentUser({ signal });

        // 确保 userInfo 存在
        if (!userInfo) {
          return undefined;
        }

        // 更新 localStorage 中的管理员信息（包含权限）
        // 即使后续 abort 检查命中，已持久化的数据可作为下次启动的 fallback
        setUserInfo(userInfo);

        // 通知权限数据已就绪（事件驱动,替代轮询）
        window.dispatchEvent(new CustomEvent('admin-permissions-ready'));

        // Check if aborted during the request — data is already persisted,
        // but skip the in-memory state update to avoid racing with a new init
        if (signal?.aborted) {
          console.warn(
            '[getInitialState] fetchUserInfo aborted after completion, skipping state update',
          );
          return undefined;
        }

        // 转换为 Ant Design Pro 的 CurrentUser 格式
        return buildCurrentUser(userInfo);
      } catch (_error: unknown) {
        // Check if this was an abort — fall through to cached fallback below
        const errName = _error instanceof Error ? _error.name : undefined;
        if (errName === 'AbortError' || signal?.aborted) {
          console.warn('[getInitialState] fetchUserInfo aborted');
        } else {
          // Non-abort errors: network failures, 5xx, etc.
          // Note: 401 errors are typically handled by responseInterceptors (token refresh/redirect),
          // but may reach here if the interceptor itself fails or is bypassed.
          console.warn('[getInitialState] fetchUserInfo failed', _error);
        }

        // 尝试从 localStorage 读取旧的用户信息作为 fallback
        const cachedUserInfo = getUserInfo();
        if (cachedUserInfo) {
          console.warn('[getInitialState] Using cached user info as fallback');
          return buildCurrentUser(cachedUserInfo);
        }

        return undefined;
      }
    };

    // 如果不是登录页面，执行
    const { location } = history;
    if (!isPublicPath(location.pathname)) {
      // Single Promise deduplication pattern: concurrent calls await the same promise
      // This eliminates the need for dual flags (initPromise + isInitializing)
      if (!initPromise) {
        // Set up timeout to abort the request if it takes too long
        // Stored at module level for proper cleanup during HMR
        const controller = new AbortController();
        initAbortController = controller;

        initTimeoutId = setTimeout(() => {
          controller.abort();
        }, INIT_TIMEOUT_MS);

        const timeoutId = initTimeoutId;
        initPromise = (async () => {
          try {
            return await fetchUserInfo(controller.signal);
          } finally {
            clearTimeout(timeoutId);
            initTimeoutId = null;
            // Clear promise after completion to allow future re-initialization
            initPromise = null;
          }
        })();
      }

      try {
        // Wait for initialization to complete
        // initPromise is guaranteed to be non-null here due to the check above
        const currentUser = await initPromise;
        return {
          fetchUserInfo,
          currentUser,
          settings: loadThemeSettings(),
          settingDrawerOpen: false,
          loading: false,
          // Degraded flag: token exists but user info failed to load.
          // Downstream code (onPageChange) uses this to show a warning toast.
          degraded: !currentUser && isAuthenticated(),
        };
      } catch (error) {
        console.error('[getInitialState] Initialization failed:', error);
        // Fall through to return without currentUser
      }
    }
    return {
      fetchUserInfo,
      settings: loadThemeSettings(),
      settingDrawerOpen: false,
      loading: false,
      degraded: false,
    };
  } catch (error) {
    // 顶层 try-catch：防止未捕获的异常导致页面白屏
    console.error(
      '[getInitialState] Unexpected error during initialization:',
      error,
    );
    return {
      fetchUserInfo: async (_signal?: AbortSignal) => undefined,
      currentUser: undefined, // 明确设置 currentUser，防止后续依赖代码出现未定义错误
      settings: loadThemeSettings(),
      settingDrawerOpen: false,
      loading: false,
      degraded: false,
    };
  }
}

// ProLayout 支持的api https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => {
  // 设置全局的 setInitialState 函数，用于 token 刷新后更新权限
  React.useEffect(() => {
    setGlobalSetInitialState(setInitialState);
    return () => {
      setGlobalSetInitialState(null);
    };
  }, [setInitialState]);

  const locale = getLocale();
  const intl = useIntl();
  const isRTL = RTL_LOCALES.some((rtl) => locale.startsWith(rtl.split('-')[0]));

  return {
    direction: isRTL ? 'rtl' : 'ltr',
    menuItemRender: (item, dom) => {
      if (item.path) {
        return (
          <Link to={item.path} prefetch>
            {dom}
          </Link>
        );
      }
      return dom;
    },
    actionsRender: () => {
      // `locale: false` opts out of the language switcher. ProLayout's own
      // `locale` prop is a locale string, so narrow to the boolean toggle here.
      const localeEnabled =
        (initialState?.settings as { locale?: boolean })?.locale !== false;
      return [
        <DocLink key="doc" />,
        //<VersionDropdown key="version" />,
        localeEnabled && <LangDropdown key="lang" />,
      ].filter(Boolean);
    },
    avatarProps: {
      src: initialState?.currentUser?.avatar,
      title: initialState?.currentUser?.name || 'Admin',
      render: (_, avatarChildren) => (
        <AvatarDropdown>{avatarChildren}</AvatarDropdown>
      ),
    },
    // waterMarkProps: {
    //   content: initialState?.currentUser?.name,
    // },
    footerRender: () => <Footer />,
    onPageChange: () => {
      const { location } = history;

      // 根路由智能重定向：根据用户权限动态决定默认页面
      // 必须在登录检查之前执行，避免未登录用户被重定向到登录页后再跳回
      if (location.pathname === '/') {
        const access = initialState?.currentUser?.permissions;

        // 如果权限信息尚未加载，根据认证状态决定下一步
        if (!access) {
          if (isAuthenticated()) {
            // Token 有效但用户信息加载失败（网络错误/API 异常），
            // 跳转到账户页（任意已登录用户可访问，无权限要求）
            history.replace('/account/center');
          }
          // 未认证：由下方的 auth check 处理重定向到登录页
          return;
        }

        // 权限检查优先级：Dashboard > RTC Users > System
        if (access.has(PERM_DASHBOARD_READ)) {
          history.replace('/dashboard/grafana/rtc-agent');
          return;
        }
        if (
          access.has(PERM_RTC_USER_READ) ||
          access.has(PERM_RTC_SESSION_READ) ||
          access.has(PERM_RTC_MESSAGE_READ)
        ) {
          history.replace('/rtc-users/management');
          return;
        }
        if (
          access.has(PERM_ADMIN_USER_READ) ||
          access.has(PERM_ROLE_READ) ||
          access.has(PERM_PERMISSION_READ) ||
          access.has(PERM_AUDIT_LOG_READ) ||
          access.has(PERM_SERVER_CONFIG_READ)
        ) {
          history.replace('/system');
          return;
        }
        // 无任何权限，跳转到 403 页面
        history.replace('/exception/403');
        return;
      }

      // Skip auth check for public routes, but redirect authenticated users
      // away from the login page to avoid confusion (they're already logged in).
      if (isPublicPath(location.pathname)) {
        if (location.pathname === PUBLIC_PATHS.login && isAuthenticated()) {
          // Authenticated user on login page: redirect directly to the page
          // they have permission for, avoiding the intermediate `/` redirect
          // that would cause 2-3 unnecessary route hops.
          const access = initialState?.currentUser?.permissions;
          if (access) {
            // Permission-based priority: Dashboard > RTC Users > System
            if (access.has(PERM_DASHBOARD_READ)) {
              history.replace('/dashboard/grafana/rtc-agent');
            } else if (
              access.has(PERM_RTC_USER_READ) ||
              access.has(PERM_RTC_SESSION_READ) ||
              access.has(PERM_RTC_MESSAGE_READ)
            ) {
              history.replace('/rtc-users/management');
            } else if (
              access.has(PERM_ADMIN_USER_READ) ||
              access.has(PERM_ROLE_READ) ||
              access.has(PERM_PERMISSION_READ) ||
              access.has(PERM_AUDIT_LOG_READ) ||
              access.has(PERM_SERVER_CONFIG_READ)
            ) {
              history.replace('/system');
            } else {
              history.replace('/exception/403');
            }
          } else {
            // Permissions not yet loaded, fallback to root for normal routing
            history.replace('/');
          }
        }
        return;
      }

      // Auth check: token is the source of truth.
      // If no token, redirect to login immediately — do not wait for currentUser.
      // This avoids a race condition where hasToken=true but hasUser=false,
      // which would grant access but fail all permission checks in access.ts.
      const hasToken = isAuthenticated();

      if (!hasToken && location.pathname !== PUBLIC_PATHS.login) {
        history.replace(
          `${PUBLIC_PATHS.login}?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`,
        );
        return;
      }

      const hasUser = !!initialState?.currentUser;

      // Degraded state: token exists but user info failed to load.
      // Allow access (token is valid), but notify the user that data may be incomplete.
      // This can happen when the /api/auth/me endpoint fails but the token is still valid.
      if (hasToken && !hasUser) {
        console.warn(
          '[onPageChange] Degraded state: token present but currentUser unavailable. ' +
            'User info may be incomplete. The request interceptor will redirect to login if the token expires.',
        );
        // Use message.warning for user-visible notification
        // Only show once per session to avoid repeated toasts on every route change
        if (!degradedWarningShown) {
          degradedWarningShown = true;
          const { message } = getGlobalFeedbackInstances();
          message.warning(
            intl.formatMessage({
              id: 'app.degradedState.warning',
              defaultMessage:
                'User information failed to load. Some features may be limited. Please log in again if the issue persists.',
            }),
          );
        }
      } else if (hasUser) {
        // Reset warning flag once user info is available (e.g., after successful refresh)
        degradedWarningShown = false;
      }
    },
    bgLayoutImgList: [
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/D2LWSqNny4sAAAAAAAAAAAAAFl94AQBr',
        left: 85,
        bottom: 100,
        height: '303px',
      },
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/C2TWRpJpiC0AAAAAAAAAAAAAFl94AQBr',
        bottom: -68,
        right: -45,
        height: '303px',
      },
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/F6vSTbj8KpYAAAAAAAAAAAAAFl94AQBr',
        bottom: 0,
        left: 0,
        width: '331px',
      },
    ],
    // Replace ProLayout's default ErrorBoundary with our offline-aware version,
    // so chunk load errors show friendly messages instead of "Something went wrong."
    ErrorBoundary,
    menuHeaderRender: undefined,
    // 自定义 403 页面
    // unAccessible: <div>unAccessible</div>,
    // 增加一个 loading 的状态
    childrenContentRender: (children: React.ReactNode) => {
      // if (initialState?.loading) return <PageLoading />;
      return (
        <>
          {children}
          <SettingDrawer
            disableUrlParams
            enableDarkTheme
            collapse={initialState?.settingDrawerOpen}
            onCollapseChange={(open) => {
              setInitialState((s) => ({
                ...s,
                settingDrawerOpen: open,
              }));
            }}
            settings={initialState?.settings}
            onSettingChange={(settings) => {
              saveThemeSettings(settings);
              setInitialState((s) => ({
                ...s,
                settings,
              }));
            }}
          />
        </>
      );
    },
    ...initialState?.settings,
  };
};

/**
 * @name request 配置，可以配置错误处理
 * 它基于 axios 提供了一套统一的网络请求和错误处理方案。
 * @doc https://umijs.org/docs/max/request#配置
 */
export const request: RequestConfig = {
  baseURL: '',
  ...errorConfig,
};

export function rootContainer(container: React.ReactNode) {
  return (
    <ErrorBoundary>
      <App>
        <MessageThemeConfig />
        <OfflineBanner />
        {container}
        {/* 全局 RTC Agent 浮窗 */}
        <GlobalRtcAgent />
      </App>
    </ErrorBoundary>
  );
}
