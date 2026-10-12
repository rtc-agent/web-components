import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { getLocale, history, Link } from '@umijs/max';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
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
import { getCurrentUser } from '@/services/admin-auth';
import type { UserInfo } from '@/services/types';
import {
  getUserInfo,
  isAuthenticated,
  setUserInfo,
} from '@/utils/auth-storage';
import {
  loadDayjsLocale,
  RTL_LOCALES,
  setDocumentDirection,
} from '@/utils/locale-helpers';
import { buildPermissionSet, computeAccessLevel } from '@/utils/permission';
import defaultSettings from '../config/defaultSettings';
import { errorConfig, setGlobalSetInitialState } from './requestErrorConfig';

// Centralized public path configuration
const PUBLIC_PATHS = {
  login: '/user/login',
  register: '/user/register',
  registerResult: '/user/register-result',
} as const;

/** Check if a pathname is a public (unauthenticated) route */
function isPublicPath(pathname: string): boolean {
  // Exact match against known public paths, with optional trailing slash
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    normalized === PUBLIC_PATHS.login ||
    normalized === PUBLIC_PATHS.register ||
    normalized === PUBLIC_PATHS.registerResult
  );
}

// localStorage key for theme settings persistence
const THEME_SETTINGS_KEY = 'admin_ui_theme';

/**
 * Build CurrentUser object from UserInfo
 * Centralizes the conversion logic to avoid duplication
 */
function buildCurrentUser(userInfo: UserInfo): API.CurrentUser {
  const permissionsArray = userInfo.permissions || [];
  const permissionSet = buildPermissionSet(permissionsArray);
  const access = computeAccessLevel(userInfo.roles);

  return {
    userid: userInfo.id,
    name: userInfo.name,
    avatar: userInfo.avatar_url,
    email: userInfo.email,
    access,
    roles: userInfo.roles,
    permissions: permissionSet,
  };
}

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

// Initialization promise for deduplication during rapid route changes
// Single Promise pattern: concurrent calls await the same promise
let initPromise: Promise<API.CurrentUser | undefined> | null = null;

// Clean up init promise on HMR to prevent stale state across hot reloads
if (typeof module !== 'undefined' && module.hot) {
  module.hot.dispose(() => {
    initPromise = null;
  });
}

/**
 * @see https://umijs.org/docs/api/runtime-config#getinitialstate
 * */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: API.CurrentUser;
  loading?: boolean;
  fetchUserInfo?: () => Promise<API.CurrentUser | undefined>;
  settingDrawerOpen?: boolean;
}> {
  try {
    // Set document direction and load dayjs locale early
    setDocumentDirection();
    loadDayjsLocale();

    // Create AbortController for timeout cancellation
    const initAbortController = new AbortController();

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
          // 401 错误已由 responseInterceptors 处理（自动刷新 token 或跳转登录）
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
        const timeoutId = setTimeout(() => {
          initAbortController.abort();
        }, INIT_TIMEOUT_MS);

        initPromise = (async () => {
          try {
            return await fetchUserInfo(initAbortController.signal);
          } finally {
            clearTimeout(timeoutId);
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
    };
  } catch (error) {
    // 顶层 try-catch：防止未捕获的异常导致页面白屏
    console.error(
      '[getInitialState] Unexpected error during initialization:',
      error,
    );
    return {
      fetchUserInfo: async () => undefined,
      settings: loadThemeSettings(),
      settingDrawerOpen: false,
      loading: false,
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
        if (access.has('dashboard:read')) {
          history.replace('/dashboard/grafana/rtc-agent');
          return;
        }
        if (
          access.has('rtc_user:read') ||
          access.has('rtc_session:read') ||
          access.has('rtc_message:read')
        ) {
          history.replace('/rtc-users/management');
          return;
        }
        if (
          access.has('admin_user:read') ||
          access.has('role:read') ||
          access.has('permission:read') ||
          access.has('audit_log:read') ||
          access.has('server_config:read')
        ) {
          history.replace('/system');
          return;
        }
        // 无任何权限，跳转到 403 页面
        history.replace('/exception/403');
        return;
      }

      // Skip auth check for public routes
      if (isPublicPath(location.pathname)) {
        return;
      }

      // Auth check: prefer token presence over currentUser object.
      // If a valid token exists but currentUser failed to load (e.g. network issue),
      // allow access rather than redirecting to login — the request interceptor
      // will handle token expiry and redirect when truly unauthenticated.
      const hasToken = isAuthenticated();
      const hasUser = !!initialState?.currentUser;

      if (!hasToken && !hasUser && location.pathname !== PUBLIC_PATHS.login) {
        history.replace(
          `${PUBLIC_PATHS.login}?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`,
        );
        return;
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
      <OfflineBanner />
      {container}
      {/* 全局 RTC Agent 浮窗 */}
      <GlobalRtcAgent />
    </ErrorBoundary>
  );
}
