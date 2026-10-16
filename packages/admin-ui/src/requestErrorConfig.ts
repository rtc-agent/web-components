import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { getIntl, history, request } from '@umijs/max';
import { message, notification } from 'antd';
import { getCurrentUser } from '@/services/admin-auth';
import { ErrorShowType } from '@/services/types';
import {
  clearAuth,
  getAccessTokenDecrypted,
  getRefreshToken,
  refreshAccessToken,
} from '@/utils/auth-storage';
import { buildPermissionSet, computeAccessLevel } from '@/utils/permission';

const loginPath = '/user/login';

// 全局的 setInitialState 函数引用，用于在 token 刷新后更新权限
// 在 app.tsx 的 layout 中设置
type SetInitialStateFn = (fn: (prev: any) => any) => Promise<void>;
let globalSetInitialState: SetInitialStateFn | null = null;

/**
 * 重定向到登录页
 * 用于 401 错误或未认证场景
 */
function redirectToLogin(): void {
  clearAuth();
  const { pathname, search, hash } = history.location;
  history.replace(
    `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
  );
}

/**
 * 设置全局的 setInitialState 函数
 * 在 app.tsx 的 layout 中调用
 */
export function setGlobalSetInitialState(fn: SetInitialStateFn | null) {
  globalSetInitialState = fn;
}

/**
 * 刷新 access token 并同步权限数据
 *
 * 使用统一的 refreshAccessToken 函数刷新 token，
 * 然后重新获取用户权限信息并更新全局状态。
 */
async function refreshTokenAndUpdatePermissions(): Promise<string | null> {
  // 使用统一的刷新函数刷新 token
  const newToken = await refreshAccessToken();

  if (!newToken) {
    return null;
  }

  // 同时刷新权限数据
  try {
    const userInfo = await getCurrentUser();
    if (userInfo && globalSetInitialState) {
      // 构建权限集合和访问级别
      const permissionSet = buildPermissionSet(userInfo.permissions);
      const access = computeAccessLevel(userInfo.roles);

      // 直接使用 setInitialState 更新权限数据
      // 等待状态更新完成，确保权限数据同步
      await globalSetInitialState((prev: any) => ({
        ...prev,
        currentUser: {
          ...prev?.currentUser,
          userid: userInfo.id,
          name: userInfo.name,
          email: userInfo.email,
          avatar: userInfo.avatar_url,
          roles: userInfo.roles,
          access,
          permissions: permissionSet,
        },
      }));
    } else if (userInfo && !globalSetInitialState) {
      // 注意：如果 globalSetInitialState 为 null，说明 layout 还未 mount
      // 此时权限数据无法更新，管理员可能需要刷新页面才能看到最新权限
      console.warn(
        '[refreshTokenAndUpdatePermissions] globalSetInitialState is null, permission data not updated.',
      );
    }
  } catch (error) {
    console.error(
      '[refreshTokenAndUpdatePermissions] 刷新权限数据失败:',
      error,
    );
    // 权限数据刷新失败时，通知管理员可能需要刷新页面
    // 但不阻断 token 刷新流程
    message.warning(
      '权限数据同步失败，部分功能可能受限。建议刷新页面获取最新权限。',
    );
  }

  return newToken;
}

// 与后端约定的响应数据格式
interface ResponseStructure {
  success: boolean;
  data: unknown;
  errorCode?: string;
  errorMessage?: string;
  showType?: ErrorShowType;
}

/**
 * @name 错误处理
 * pro 自带的错误处理， 可以在在这里做自己的改动
 * @doc https://umijs.org/docs/max/request#配置
 */
export const errorConfig: RequestConfig = {
  // 错误处理： umi@3 的错误处理方案。
  errorConfig: {
    // 错误抛出
    errorThrower: (res) => {
      const { success, data, errorCode, errorMessage, showType } =
        res as unknown as ResponseStructure;
      if (!success) {
        const error: any = new Error(errorMessage);
        error.name = 'BizError';
        error.info = { errorCode, errorMessage, showType, data };
        throw error; // 抛出自制的错误
      }
    },
    // 错误接收及处理 - 注意：errorHandler 不能异步阻塞！
    // 401 错误处理已移到响应拦截器中
    errorHandler: (error: any, opts: any): any => {
      if (opts?.skipErrorHandler) throw error;

      // 记录请求失败日志（含请求上下文）
      if (error.response) {
        const serverData = error.response.data;
        console.error('[API Error]', {
          url: error.config?.url || 'unknown',
          method: (error.config?.method || 'unknown').toUpperCase(),
          status: error.response.status,
          errorCode: serverData?.errorCode,
          timestamp: new Date().toISOString(),
        });
      } else if (error.request) {
        console.error('[Network Error]', {
          url: error.config?.url || 'unknown',
          method: (error.config?.method || 'unknown').toUpperCase(),
          error: error.message || 'No response received',
          timestamp: new Date().toISOString(),
        });
      } else {
        console.error('[Request Error]', {
          error: error.message || 'unknown',
          timestamp: new Date().toISOString(),
        });
      }

      // 我们的 errorThrower 抛出的错误。
      if (error.name === 'BizError') {
        const errorInfo: ResponseStructure | undefined = error.info;
        if (errorInfo) {
          const { errorMessage, errorCode } = errorInfo;
          switch (errorInfo.showType) {
            case ErrorShowType.SILENT:
              // do nothing
              break;
            case ErrorShowType.WARN_MESSAGE:
              message.warning(errorMessage);
              break;
            case ErrorShowType.ERROR_MESSAGE:
              message.error(errorMessage);
              break;
            case ErrorShowType.NOTIFICATION:
              notification.open({
                title: errorCode,
                description: errorMessage,
              });
              break;
            case ErrorShowType.REDIRECT:
              window.location.href = '/user/login';
              break;
            default:
              message.error(errorMessage);
          }
        }
      } else if (error.response) {
        // Axios 的错误
        // 请求成功发出且服务器也响应了状态码，但状态代码超出了 2xx 的范围

        // 尝试从响应体中提取错误信息
        const serverError = error.response.data;
        const errorMessage =
          typeof serverError === 'object' && serverError?.errorMessage
            ? serverError.errorMessage
            : `请求失败 (${error.response.status || 'unknown'})`;
        message.error(errorMessage);
      } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
        message.error(
          getIntl().formatMessage({
            id: 'app.request.offline',
            defaultMessage:
              'Network unavailable. Please check your connection and try again.',
          }),
        );
      } else if (error.request) {
        message.error('None response! Please retry.');
      } else {
        message.error('Request error, please retry.');
      }
    },
  },

  // 请求拦截器
  requestInterceptors: [
    async (config: RequestOptions) => {
      // 从 localStorage 获取 JWT token（异步解密）
      // P1 修复：必须使用 getAccessTokenDecrypted()，因为 getAccessToken() 返回的是加密值，
      // 直接作为 Bearer token 会被服务器拒绝（401），导致无限刷新循环。
      const accessToken = await getAccessTokenDecrypted();
      if (accessToken) {
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${accessToken}`,
        };
      }
      return config;
    },
  ],

  // 响应拦截器 - 统一解包 { success, data } 格式 + 处理 401 token 刷新
  responseInterceptors: [
    async (response: any) => {
      try {
        const { data } = response;

        // 检查是否成功
        if (data?.success === true) {
          // 成功响应，解包数据
          response.data = data.data;
          return response;
        }

        // 检查是否是 401 错误（unauthorized）
        if (data?.success === false && data?.errorCode === 'unauthorized') {
          // Use retry count instead of boolean flag to prevent infinite loops
          // Max retry count is 1
          const retryCount = response.config?._retryCount || 0;
          if (retryCount >= 1) {
            redirectToLogin();
            return Promise.reject(response);
          }

          // 检查是否有 refresh token
          // P1 修复：getRefreshToken() 是 async 的（涉及解密），必须 await
          const refreshTokenValue = await getRefreshToken();
          if (!refreshTokenValue) {
            message.warning(
              getIntl().formatMessage({
                id: 'pages.auth.sessionExpired',
                defaultMessage: '登录已过期，请重新登录',
              }),
            );
            redirectToLogin();
            return Promise.reject(response);
          }

          // 使用统一的刷新函数（内部已处理并发控制）
          return refreshTokenAndUpdatePermissions()
            .then((newToken) => {
              if (!newToken) {
                // 刷新失败，提示用户后跳转登录
                message.warning(
                  getIntl().formatMessage({
                    id: 'pages.auth.sessionExpired',
                    defaultMessage: '登录已过期，请重新登录',
                  }),
                );
                redirectToLogin();
                return Promise.reject(response);
              }

              // 重试原请求
              const config = response.config;
              config.headers = {
                ...config.headers,
                Authorization: `Bearer ${newToken}`,
              };
              // Increment retry count to prevent infinite loops
              config._retryCount = retryCount + 1;

              // ⚠️ 重要：必须使用 getResponse: true 获取完整 response 对象
              // 原因：响应拦截器需要返回 response 对象（含 .data 属性），umi-request 会从中提取 response.data
              // 如果不传 getResponse: true，request() 默认返回解包后的 data，导致 umi-request 提取不到 .data 而返回 undefined
              return request(config.url, { ...config, getResponse: true });
            })
            .catch((refreshError) => {
              // Log token refresh failure with context
              console.error('[Token Refresh Failed]', {
                url: response.config?.url,
                method: (response.config?.method || 'unknown').toUpperCase(),
                error:
                  refreshError instanceof Error
                    ? refreshError.message
                    : String(refreshError),
                timestamp: new Date().toISOString(),
              });
              return Promise.reject(refreshError);
            });
        }

        // 其他错误响应，返回原始响应
        return response;
      } catch (interceptorError) {
        // Catch unexpected errors during interceptor processing (e.g., malformed data)
        console.error('[Response Interceptor Error]', {
          url: response.config?.url,
          method: (response.config?.method || 'unknown').toUpperCase(),
          error:
            interceptorError instanceof Error
              ? interceptorError.message
              : String(interceptorError),
          timestamp: new Date().toISOString(),
        });
        return Promise.reject(interceptorError);
      }
    },
  ],
};
