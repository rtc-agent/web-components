import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { getIntl, history, request } from '@umijs/max';
import { message, notification } from 'antd';
import {
  getCurrentUser,
  refreshToken as refreshAccessToken,
} from '@/services/admin-auth';
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '@/utils/auth-storage';
import { buildPermissionSet, computeAccessLevel } from '@/utils/permission';

const loginPath = '/user/login';

// Token 刷新相关状态
let refreshPromise: Promise<string | null> | null = null;

// 全局的 setInitialState 函数引用，用于在 token 刷新后更新权限
// 在 app.tsx 的 layout 中设置
type SetInitialStateFn = (fn: (prev: any) => any) => Promise<void>;
let globalSetInitialState: SetInitialStateFn | null = null;

/**
 * 设置全局的 setInitialState 函数
 * 在 app.tsx 的 layout 中调用
 */
export function setGlobalSetInitialState(fn: SetInitialStateFn | null) {
  globalSetInitialState = fn;
}

/**
 * 刷新 access token 并同步权限数据
 */
async function refreshTokenRequest(): Promise<string | null> {
  const refreshTokenValue = getRefreshToken();

  if (!refreshTokenValue) {
    return null;
  }

  try {
    const result = await refreshAccessToken(
      { refresh_token: refreshTokenValue },
      { skipErrorHandler: true },
    );

    // 更新 localStorage 中的 token
    setTokens(
      result.access_token,
      result.refresh_token,
      result.expires_in || 3600,
    );

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
        // 此时权限数据无法更新，用户可能需要刷新页面才能看到最新权限
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            '[refreshTokenRequest] globalSetInitialState is null, permission data not updated. User may need to refresh the page.',
          );
        }
      }
    } catch (error) {
      console.error('[refreshTokenRequest] 刷新权限数据失败:', error);
      // 权限数据刷新失败时，通知用户可能需要刷新页面
      // 但不阻断 token 刷新流程
      message.warning(
        '权限数据同步失败，部分功能可能受限。建议刷新页面获取最新权限。',
      );
    }

    return result.access_token;
  } catch (error) {
    console.error('[refreshTokenRequest] 刷新失败:', error);
    // 刷新失败，清除 auth 信息
    clearAuth();
    return null;
  }
}

// 错误处理方案： 错误类型
enum ErrorShowType {
  SILENT = 0,
  WARN_MESSAGE = 1,
  ERROR_MESSAGE = 2,
  NOTIFICATION = 3,
  REDIRECT = 9,
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
        if (serverError?.errorMessage) {
          // Server 返回了自定义错误信息
          message.error(serverError.errorMessage);
        } else {
          // 通用错误提示
          message.error(`请求失败 (${error.response.status})`);
        }
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
    (config: RequestOptions) => {
      // 从 localStorage 获取 JWT token
      const accessToken = getAccessToken();
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
      const { data } = response;

      // 检查是否成功
      if (data?.success === true) {
        // 成功响应，解包数据
        response.data = data.data;
        return response;
      }

      // 检查是否是 401 错误（unauthorized）
      if (data?.success === false && data?.errorCode === 'unauthorized') {
        // 如果已经重试过，不再重试
        if (response.config?._retry) {
          clearAuth();
          const { pathname, search, hash } = history.location;
          history.replace(
            `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
          );
          return Promise.reject(response);
        }

        // 检查是否有 refresh token
        const refreshTokenValue = getRefreshToken();
        if (!refreshTokenValue) {
          clearAuth();
          const { pathname, search, hash } = history.location;
          history.replace(
            `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
          );
          return Promise.reject(response);
        }

        // 如果当前没有刷新 Promise，创建一个
        // 这样可以确保多个并发请求只会触发一次刷新
        if (!refreshPromise) {
          refreshPromise = refreshTokenRequest().finally(() => {
            // 刷新完成后，清除 Promise，允许下次刷新
            refreshPromise = null;
          });
        }

        // 等待刷新完成
        return new Promise((resolve, reject) => {
          const promise = refreshPromise;
          if (!promise) {
            // 理论上不会发生，因为上面已经检查并创建了
            reject(new Error('Refresh promise is null'));
            return;
          }
          promise
            .then((newToken) => {
              if (!newToken) {
                // 刷新失败，跳转登录
                clearAuth();
                const { pathname, search, hash } = history.location;
                history.replace(
                  `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
                );
                reject(response);
                return;
              }

              // 重试原请求
              const config = response.config;
              config.headers = {
                ...config.headers,
                Authorization: `Bearer ${newToken}`,
              };
              config._retry = true;

              // 重试请求
              request(config.url, config)
                .then((retryResponse) => {
                  resolve(retryResponse);
                })
                .catch((error) => reject(error));
            })
            .catch((refreshError) => {
              reject(refreshError);
            });
        });
      }

      // 其他错误响应，返回原始响应
      return response;
    },
  ],
};
