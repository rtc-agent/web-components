import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { getLocale, history, Link } from '@umijs/max';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
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
import {
  getUserInfo,
  isAuthenticated,
  setUserInfo,
} from '@/utils/auth-storage';
import { buildPermissionSet, computeAccessLevel } from '@/utils/permission';
import defaultSettings from '../config/defaultSettings';
import { errorConfig, setGlobalSetInitialState } from './requestErrorConfig';

const loginPath = '/user/login';

// RTL (Right-to-Left) languages
const RTL_LOCALES = ['fa-IR', 'ar-EG', 'he-IL'];

// localStorage key for theme settings persistence
const THEME_SETTINGS_KEY = 'admin_ui_theme';

/**
 * Set document direction (ltr/rtl) based on current locale
 */
const setDocumentDirection = () => {
  const locale = getLocale();
  const isRTL = RTL_LOCALES.some((rtl) => locale.startsWith(rtl.split('-')[0]));
  document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  document.documentElement.lang = locale;
};

/**
 * Load theme settings from localStorage, fallback to defaults
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
  return defaultSettings as Partial<LayoutSettings>;
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
    // Set document direction early
    setDocumentDirection();

    const fetchUserInfo = async () => {
      // 先检查 localStorage 是否有有效的 token
      if (!isAuthenticated()) {
        return undefined;
      }

      try {
        // 调用真正的 API 获取管理员信息
        const userInfo = await getCurrentUser();

        // 确保 userInfo 存在
        if (!userInfo) {
          return undefined;
        }

        // 更新 localStorage 中的管理员信息（包含权限）
        // 这样 GlobalRtcAgent 可以读取权限进行 Function 过滤
        setUserInfo(userInfo);

        // 从 localStorage 重新读取权限，确保单一数据源
        // 避免内存中的 permissions 与持久化存储不一致
        const persistedUserInfo = getUserInfo();
        const permissionsArray = persistedUserInfo?.permissions || userInfo.permissions || [];

        // 构建权限集合和访问级别
        const permissionSet = buildPermissionSet(permissionsArray);
        const access = computeAccessLevel(userInfo.roles);

        // 通知权限数据已就绪（事件驱动，替代轮询）
        window.dispatchEvent(new CustomEvent('admin-permissions-ready'));

        // 转换为 Ant Design Pro 的 CurrentUser 格式
        return {
          userid: userInfo.id,
          name: userInfo.name,
          avatar: userInfo.avatar_url || '',
          email: userInfo.email,
          access,
          roles: userInfo.roles,
          permissions: permissionSet,
        } as API.CurrentUser;
      } catch (_error: any) {
        // 401 错误已由 responseInterceptors 处理（自动刷新 token 或跳转登录）
        // 尝试从 localStorage 读取旧的用户信息作为 fallback
        const cachedUserInfo = getUserInfo();
        if (cachedUserInfo) {
          console.warn(
            '[getInitialState] fetchUserInfo failed, using cached user info as fallback',
          );
          const permissionSet = buildPermissionSet(cachedUserInfo.permissions);
          const access = computeAccessLevel(cachedUserInfo.roles);

          return {
            userid: cachedUserInfo.id,
            name: cachedUserInfo.name,
            avatar: cachedUserInfo.avatar_url || '',
            email: cachedUserInfo.email,
            access,
            roles: cachedUserInfo.roles,
            permissions: permissionSet,
          } as API.CurrentUser;
        }

        return undefined;
      }
    };

    // 如果不是登录页面，执行
    const { location } = history;
    if (
      ![loginPath, '/user/register', '/user/register-result'].includes(
        location.pathname,
      )
    ) {
      // Use Promise deduplication to prevent race conditions
      if (!initPromise) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('Initialization timeout')),
            INIT_TIMEOUT_MS,
          );
        });

        initPromise = Promise.race([fetchUserInfo(), timeoutPromise]).finally(
          () => {
            initPromise = null;
          },
        );
      }

      try {
        // Wait for initialization to complete
        const currentUser = await initPromise;
        return {
          fetchUserInfo,
          currentUser,
          settings: loadThemeSettings(),
          settingDrawerOpen: false,
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
    };
  } catch (error) {
    // 顶层 try-catch：防止未捕获的异常导致页面白屏
    console.error(
      '[getInitialState] Unexpected error during initialization:',
      error,
    );
    return {
      settings: loadThemeSettings(),
      settingDrawerOpen: false,
    };
  }
}

// ProLayout 支持的api https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => {
  // Set document direction based on locale
  setDocumentDirection();

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
      // 如果正在初始化，不检查登录状态（防止误跳转）
      if (initPromise) {
        return;
      }

      const { location } = history;
      // 如果没有登录，重定向到 login
      if (!initialState?.currentUser && location.pathname !== loginPath) {
        history.replace(
          `${loginPath}?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`,
        );
        return;
      }

      // 根路由智能重定向：根据用户权限动态决定默认页面
      if (location.pathname === '/') {
        const access = initialState?.currentUser?.permissions;
        if (!access) return;

        // 权限检查优先级：Dashboard > RTC Users > System
        if (access.has('dashboard:read')) {
          history.replace('/dashboard/grafana/rtc-agent');
        } else if (
          access.has('rtc_user:read') ||
          access.has('rtc_session:read') ||
          access.has('rtc_message:read')
        ) {
          history.replace('/rtc-users/management');
        } else if (
          access.has('admin_user:read') ||
          access.has('role:read') ||
          access.has('permission:read') ||
          access.has('audit_log:read') ||
          access.has('server_config:read')
        ) {
          history.replace('/system');
        } else {
          // 无任何权限，跳转到 403 页面
          history.replace('/exception/403');
        }
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
    childrenRender: (children) => {
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

// Timeout for initialization to prevent permanent pending state
const INIT_TIMEOUT_MS = 30000; // 30 seconds

// Initialization promise to prevent race conditions during rapid route changes
let initPromise: Promise<API.CurrentUser | undefined> | null = null;

export function rootContainer(container: React.ReactNode) {
  return (
    <>
      <OfflineBanner />
      <ErrorBoundary>
        {container}
        {/* 全局 RTC Agent 浮窗 */}
        <GlobalRtcAgent />
      </ErrorBoundary>
    </>
  );
}
