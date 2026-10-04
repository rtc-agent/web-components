import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { getIntl, history, request } from '@umijs/max';
import { message, notification } from 'antd';
import { refreshToken as refreshAccessToken } from '@/services/admin-auth';
import { clearAuth, getRefreshToken, setTokens } from '@/utils/auth-storage';

const loginPath = '/user/login';

// 标记是否正在刷新 token，避免并发刷新
let isRefreshing = false;
// 等待刷新的请求队列
let refreshSubscribers: Array<(token: string) => void> = [];

/**
 * 将等待的请求加入队列
 */
function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

/**
 * 通知所有等待的请求，token 已刷新
 */
function onTokenRefreshed(newToken: string) {
  refreshSubscribers.forEach((cb) => {
    cb(newToken);
  });
  refreshSubscribers = [];
}

/**
 * 刷新 access token
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
  errorCode?: number;
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

  // 中间件 - 处理 401 错误和 token 刷新
  middlewares: [
    async function (ctx, next) {
      // 执行下一个中间件/实际请求
      await next();

      // 检查响应状态
      const { res, req } = ctx;
      const { url, options } = req;

      // 如果响应是 401，尝试刷新 token 并重试
      if (res?.status === 401) {
        // 如果已经重试过，不再重试
        if (options?._retry) {
          throw res;
        }

        // 检查是否有 refresh token
        const refreshTokenValue = getRefreshToken();
        if (!refreshTokenValue) {
          clearAuth();
          const { pathname, search, hash } = history.location;
          history.replace(
            `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
          );
          throw res;
        }

        // 如果当前没有在刷新 token，开始刷新
        if (!isRefreshing) {
          isRefreshing = true;

          try {
            const newToken = await refreshTokenRequest();

            if (!newToken) {
              // 刷新失败，跳转登录
              isRefreshing = false;
              refreshSubscribers = [];
              clearAuth();
              const { pathname, search, hash } = history.location;
              history.replace(
                `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
              );
              throw res;
            }

            // 刷新成功，通知所有等待的请求
            isRefreshing = false;
            onTokenRefreshed(newToken);

            // 使用新 token 重试原请求
            options.headers = {
              ...options.headers,
              Authorization: `Bearer ${newToken}`,
            };
            options._retry = true;

            // 重新发起请求
            const retryResponse = await request(url, options);
            // 将重试结果赋值给 ctx.res
            ctx.res = retryResponse;
            return;
          } catch (refreshError) {
            isRefreshing = false;
            refreshSubscribers = [];
            throw refreshError;
          }
        }

        // 如果已经在刷新 token，等待刷新完成后重试
        return new Promise((resolve, reject) => {
          subscribeTokenRefresh(async (newToken: string) => {
            options.headers = {
              ...options.headers,
              Authorization: `Bearer ${newToken}`,
            };
            options._retry = true;

            try {
              const retryResponse = await request(url, options);
              ctx.res = retryResponse;
              resolve(retryResponse);
            } catch (error) {
              reject(error);
            }
          });
        });
      }
    },
  ],

  // 请求拦截器
  requestInterceptors: [
    (config: RequestOptions) => {
      // 从 localStorage 获取 JWT token
      const accessToken = localStorage.getItem('admin_access_token');
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

        // 如果当前没有在刷新 token，开始刷新
        if (!isRefreshing) {
          isRefreshing = true;

          try {
            const newToken = await refreshTokenRequest();

            if (!newToken) {
              // 刷新失败，跳转登录
              isRefreshing = false;
              refreshSubscribers = [];
              clearAuth();
              const { pathname, search, hash } = history.location;
              history.replace(
                `${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`,
              );
              return Promise.reject(response);
            }

            // 刷新成功，通知所有等待的请求
            isRefreshing = false;
            onTokenRefreshed(newToken);

            // 重试原请求
            const config = response.config;
            config.headers = {
              ...config.headers,
              Authorization: `Bearer ${newToken}`,
            };
            config._retry = true;

            // 重试请求，返回的是完整的响应对象
            const retryResponse = await request(config.url, config);
            return retryResponse;
          } catch (refreshError) {
            isRefreshing = false;
            refreshSubscribers = [];
            return Promise.reject(refreshError);
          }
        }

        // 如果已经在刷新 token，将请求加入队列等待
        return new Promise((resolve, reject) => {
          subscribeTokenRefresh(async (newToken: string) => {
            const config = response.config;
            config.headers = {
              ...config.headers,
              Authorization: `Bearer ${newToken}`,
            };
            config._retry = true;

            try {
              const retryResponse = await request(config.url, config);
              resolve(retryResponse);
            } catch (error) {
              reject(error);
            }
          });
        });
      }

      // 其他错误响应，返回原始响应
      return response;
    },
  ],
};
