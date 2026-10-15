import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { getLocale, history, Link, useIntl } from '@umijs/max';
import { App } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useEffect } from 'react';
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

import access from '@/access';
import {
  AvatarDropdown,
  DocLink,
  ErrorBoundary,
  Footer,
  GlobalLoadingOverlay,
  GlobalRtcAgent,
  LangDropdown,
  OfflineBanner,
} from '@/components';
import { getTopLevelRedirectTarget } from '@/constants/permission-priority';
import { isPublicPath, PUBLIC_PATHS } from '@/constants/routes';
import {
  AUTH_STATE_CHANGED_EVENT,
  cancelPendingRefresh,
  getUserInfo,
  isAuthenticated,
} from '@/utils/auth-storage';
import {
  getGlobalFeedbackInstances,
  setGlobalFeedbackInstances,
} from '@/utils/globalFeedback';
import {
  loadDayjsLocale,
  RTL_LOCALES,
  setDocumentDirection,
} from '@/utils/locale-helpers';
import { buildCurrentUser } from '@/utils/permission';
import { fetchAndBuildCurrentUser } from '@/utils/user-utils';
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
      setGlobalFeedbackInstances(null);
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
  } catch (error) {
    // Log parse errors in development for easier debugging
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[loadThemeSettings] Failed to parse theme settings from localStorage, using defaults',
        error,
      );
    }
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

/**
 * InitManager encapsulates module-level state for getInitialState deduplication.
 *
 * Design rationale:
 * - Single Promise pattern: concurrent calls await the same promise
 * - Shared AbortController: all concurrent awaiters share one abort/timeout
 *   (see design note in original code about shared fate)
 * - HMR cleanup: dispose() aborts in-flight requests and resets state
 * - Auth reset: resetDegradedWarning() allows re-warning after re-login
 */
class InitManager {
  private _initPromise: Promise<API.CurrentUser | undefined> | null = null;
  private _initAbortController: AbortController | null = null;
  private _initTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _degradedWarningShown = false;

  get initPromise(): Promise<API.CurrentUser | undefined> | null {
    return this._initPromise;
  }

  set initPromise(value: Promise<API.CurrentUser | undefined> | null) {
    this._initPromise = value;
  }

  get initAbortController(): AbortController | null {
    return this._initAbortController;
  }

  set initAbortController(value: AbortController | null) {
    this._initAbortController = value;
  }

  get initTimeoutId(): ReturnType<typeof setTimeout> | null {
    return this._initTimeoutId;
  }

  set initTimeoutId(value: ReturnType<typeof setTimeout> | null) {
    this._initTimeoutId = value;
  }

  get degradedWarningShown(): boolean {
    return this._degradedWarningShown;
  }

  set degradedWarningShown(value: boolean) {
    this._degradedWarningShown = value;
  }

  /**
   * Dispose all pending state — called during HMR to prevent stale state
   * and orphan timers/callbacks across hot reloads.
   */
  dispose(): void {
    this._initPromise = null;
    if (this._initAbortController) {
      this._initAbortController.abort();
      this._initAbortController = null;
    }
    if (this._initTimeoutId) {
      clearTimeout(this._initTimeoutId);
      this._initTimeoutId = null;
    }
    this._degradedWarningShown = false;
    cancelPendingRefresh();
  }

  /**
   * Reset degraded warning flag on auth state changes (logout/re-login).
   * Ensures the warning can re-appear for the new session if needed.
   */
  resetDegradedWarning(): void {
    this._degradedWarningShown = false;
  }
}

const initManager = new InitManager();

// Clean up init promise on HMR to prevent stale state across hot reloads
if (typeof module !== 'undefined' && module.hot) {
  module.hot.dispose(() => {
    initManager.dispose();
  });
}

// Reset degraded warning flag on auth state changes (logout/re-login without page reload).
// This ensures the warning can re-appear for the new session if needed.
window.addEventListener(AUTH_STATE_CHANGED_EVENT, () => {
  initManager.resetDegradedWarning();
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
    } catch (error) {
      const currentLocale = navigator.language || 'unknown';
      const errorMessage = `[getInitialState] setDocumentDirection failed (locale: ${currentLocale}), using default ltr`;
      console.warn(errorMessage, error);
      // Dispatch custom event for optional error reporting integration (e.g., Sentry, Datadog)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('rtc:i18n-error', {
            detail: {
              type: 'setDocumentDirection',
              locale: currentLocale,
              error,
            },
          }),
        );
      }
    }
    try {
      loadDayjsLocale();
    } catch (error) {
      const currentLocale = navigator.language || 'unknown';
      const errorMessage = `[getInitialState] loadDayjsLocale failed (locale: ${currentLocale}), using default en`;
      console.warn(errorMessage, error);
      // Dispatch custom event for optional error reporting integration (e.g., Sentry, Datadog)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('rtc:i18n-error', {
            detail: { type: 'loadDayjsLocale', locale: currentLocale, error },
          }),
        );
      }
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
        // Fetch user info and build CurrentUser object using shared helper
        const currentUser = await fetchAndBuildCurrentUser({ signal }, true);

        // Check if aborted during the request — data is already persisted,
        // but skip the in-memory state update to avoid racing with a new init
        if (signal?.aborted) {
          console.warn(
            '[getInitialState] fetchUserInfo aborted after completion, skipping state update',
          );
          return undefined;
        }

        return currentUser;
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
      if (!initManager.initPromise) {
        // Set up timeout to abort the request if it takes too long
        // Stored in initManager for proper cleanup during HMR
        const controller = new AbortController();
        initManager.initAbortController = controller;

        initManager.initTimeoutId = setTimeout(() => {
          controller.abort();
        }, INIT_TIMEOUT_MS);

        const timeoutId = initManager.initTimeoutId;
        initManager.initPromise = (async () => {
          try {
            return await fetchUserInfo(controller.signal);
          } finally {
            clearTimeout(timeoutId);
            initManager.initTimeoutId = null;
            // Design note: Clear promise immediately after completion to allow
            // future re-initialization. This is intentional behavior:
            // - Fast consecutive calls may trigger duplicate fetches
            // - This is acceptable because:
            //   1. Concurrent refresh is prevented by auth-storage.refreshAccessToken (Promise dedup)
            //   2. Route changes are typically spaced out in practice
            //   3. The alternative (keeping promise forever) would prevent legitimate re-fetches
            // If duplicate fetches become problematic, consider implementing a debounce
            // or time-window based deduplication strategy.
            initManager.initPromise = null;
          }
        })();
      }

      try {
        // Wait for initialization to complete
        // initManager.initPromise is guaranteed to be non-null here due to the check above
        const currentUser = await initManager.initPromise;
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
      degraded: true, // P0 修复：明确标记为降级状态，让 onPageChange 能够正确处理
    };
  }
}

/**
 * Redirect to the appropriate page based on user permissions.
 * Used by both root route ("/") redirect and login page redirect to avoid duplication.
 *
 * Priority order: Dashboard > RTC Users > System > 403 (no permissions)
 *
 * Design note: This function uses the access object (computed from access.ts) rather than
 * raw permission constants. This ensures consistency with menu visibility logic defined
 * in access.ts and avoids duplicating permission combination rules.
 *
 * @param accessObj - Computed access object from access.ts
 * @returns true if a redirect was performed, false if permissions are not loaded (caller should handle fallback)
 */
const redirectByPermissions = (
  accessObj: ReturnType<typeof access>,
): boolean => {
  // Use centralized permission priority configuration
  const targetPath = getTopLevelRedirectTarget(accessObj);
  if (targetPath) {
    history.replace(targetPath);
    return true;
  }
  return false;
};

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
        // 如果用户信息尚未加载，根据认证状态决定下一步
        if (!initialState?.currentUser) {
          if (isAuthenticated()) {
            // Token 有效但用户信息加载失败（网络错误/API 异常），
            // 跳转到账户页（任意已登录用户可访问，无权限要求）
            history.replace('/account/center');
          }
          // 未认证：由下方的 auth check 处理重定向到登录页
          return;
        }

        // Use shared helper to redirect based on permissions
        // Compute access object to ensure consistency with menu visibility logic
        const accessObj = access(initialState);
        redirectByPermissions(accessObj);
        return;
      }

      // Skip auth check for public routes, but redirect authenticated users
      // away from the login page to avoid confusion (they're already logged in).
      if (isPublicPath(location.pathname)) {
        if (location.pathname === PUBLIC_PATHS.login && isAuthenticated()) {
          // Authenticated user on login page: redirect directly to the page
          // they have permission for, avoiding the intermediate `/` redirect
          // that would cause 2-3 unnecessary route hops.
          if (!initialState?.currentUser) {
            // Permissions not yet loaded, fallback to root for normal routing
            history.replace('/');
          } else {
            // Compute access object to ensure consistency with menu visibility logic
            const accessObj = access(initialState);
            redirectByPermissions(accessObj);
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

      // Race condition fix: token exists but currentUser not yet loaded.
      // Show loading state instead of rendering the page with undefined user.
      // This prevents permission checks from failing due to missing currentUser.
      if (hasToken && !initialState?.currentUser && !initialState?.degraded) {
        // currentUser is still being fetched, wait for it to load
        // The layout will show a loading indicator via initialState.loading
        return;
      }

      // Degraded state: token exists but user info failed to load.
      // Allow access (token is valid), but notify the user that data may be incomplete.
      // This can happen when the /api/auth/me endpoint fails but the token is still valid.
      //
      // Use initialState.degraded flag (set in getInitialState) instead of recalculating
      // to ensure consistency between initial state and route-change handling.
      if (initialState?.degraded) {
        console.warn(
          '[onPageChange] Degraded state: token present but currentUser unavailable. ' +
            'User info may be incomplete. The request interceptor will redirect to login if the token expires.',
        );
        // Use message.warning for user-visible notification
        // Only show once per session to avoid repeated toasts on every route change
        if (!initManager.degradedWarningShown) {
          initManager.degradedWarningShown = true;
          const { message } = getGlobalFeedbackInstances();
          message.warning(
            intl.formatMessage({
              id: 'app.degradedState.warning',
              defaultMessage:
                'User information failed to load. Some features may be limited. Please log in again if the issue persists.',
            }),
          );
        }
      } else if (initialState?.currentUser) {
        // Reset warning flag once user info is available (e.g., after successful refresh)
        initManager.resetDegradedWarning();
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
      return (
        <>
          {initialState?.loading && <GlobalLoadingOverlay />}
          {children}
          <SettingDrawer
            disableUrlParams
            enableDarkTheme
            collapse={initialState?.settingDrawerOpen}
            onCollapseChange={(open) => {
              try {
                setInitialState((s) => ({
                  ...s,
                  settingDrawerOpen: open,
                }));
              } catch (error) {
                console.error(
                  '[app.tsx] Failed to toggle setting drawer:',
                  error,
                );
              }
            }}
            settings={initialState?.settings}
            onSettingChange={(settings) => {
              saveThemeSettings(settings);
              try {
                setInitialState((s) => ({
                  ...s,
                  settings,
                }));
              } catch (error) {
                console.error('[app.tsx] Failed to update settings:', error);
              }
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
  // Pass current pathname to ErrorBoundary for route-based reset
  const { location } = history;
  return (
    <ErrorBoundary locationPathname={location.pathname}>
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
