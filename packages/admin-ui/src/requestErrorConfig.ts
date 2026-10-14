import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { getIntl, history, request } from '@umijs/max';
import { PUBLIC_PATHS } from '@/constants/routes';
import { ApiErrorCodes, ErrorShowType } from '@/services/types';
import {
  clearAuth,
  getAccessTokenDecrypted,
  getRefreshToken,
  refreshAccessToken,
} from '@/utils/auth-storage';
import { getGlobalFeedbackInstances } from '@/utils/globalFeedback';
import { fetchAndBuildCurrentUser } from '@/utils/user-utils';

// ============================================================================
// Request Body Sanitization for Logging
// ============================================================================

/**
 * Sanitize request body before logging to prevent sensitive data leaks.
 * Removes password, token, and other sensitive fields.
 */
function sanitizeRequestBody(body: unknown, depth = 0): unknown {
  if (typeof body !== 'object' || body === null) {
    return body;
  }

  // Guard against circular references and excessively deep objects
  if (depth > 5) {
    return '[MAX_DEPTH]';
  }

  const sensitiveFields = [
    'password',
    'token',
    'refresh_token',
    'access_token',
    'secret',
    'otp',
  ];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (
      sensitiveFields.some((field) =>
        key.toLowerCase().includes(field.toLowerCase()),
      )
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (Array.isArray(value)) {
      // Recursively sanitize arrays
      sanitized[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? sanitizeRequestBody(item, depth + 1)
          : item,
      );
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeRequestBody(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ============================================================================
// Global State Management for Permission Sync
// ============================================================================
// Lifecycle:
// 1. App initializes -> requestErrorConfig loaded -> globalSetInitialState = null
// 2. Layout mounts (app.tsx) -> calls setGlobalSetInitialState(fn) -> globalSetInitialState set
// 3. Token refresh occurs -> uses globalSetInitialState to sync permissions
// 4. Layout unmounts -> calls setGlobalSetInitialState(null) -> globalSetInitialState cleared
//
// Race Condition Handling:
// - If token refresh occurs BEFORE layout mount (step 2), globalSetInitialState is null
// - Solution: Store pendingUserInfo, apply when setInitialState becomes available
// - If token refresh occurs AFTER layout unmount (step 4), same race handling applies
// ============================================================================

/**
 * Global reference to setInitialState function from app.tsx layout.
 * Used to sync permission data after token refresh.
 *
 * Lifecycle:
 * - null initially (before layout mount)
 * - set to function when layout mounts
 * - set back to null when layout unmounts
 *
 * @see setGlobalSetInitialState for race condition handling
 */
type SetInitialStateFn = (
  fn: (prev: Record<string, unknown>) => Record<string, unknown>,
) => Promise<void>;
let globalSetInitialState: SetInitialStateFn | null = null;

// Pending permission update for race condition: token refresh before layout mount
// When token refresh occurs before layout mounts, globalSetInitialState is null.
// Store the currentUser and apply it when setInitialState becomes available.
let pendingCurrentUser: API.CurrentUser | null = null;

/**
 * 重定向到登录页
 * 用于 401 错误或未认证场景
 */
function redirectToLogin(): void {
  clearAuth();
  const { pathname, search, hash } = history.location;
  history.replace(
    `${PUBLIC_PATHS.login}?redirect=${encodeURIComponent(pathname + search + hash)}`,
  );
}

/**
 * 设置全局的 setInitialState 函数
 * 在 app.tsx 的 layout 中调用
 *
 * 如果有待处理的权限更新（token 刷新发生在 layout mount 前），
 * 立即应用该更新，确保权限数据同步。
 */
export function setGlobalSetInitialState(fn: SetInitialStateFn | null) {
  globalSetInitialState = fn;

  // Apply pending permission update when layout becomes available
  if (fn && pendingCurrentUser) {
    const currentUserToApply = pendingCurrentUser;
    pendingCurrentUser = null;
    // Apply asynchronously to avoid blocking the caller
    // Error boundary: prevent unhandled promise rejection
    fn((prev) => ({
      ...prev,
      currentUser: currentUserToApply,
    })).catch((error) => {
      // Defensive: log error but don't throw.
      // This is a fire-and-forget state update; failure is non-critical
      // as the data is already persisted in localStorage.
      console.error(
        '[setGlobalSetInitialState] Failed to apply pending permission update:',
        error,
      );
    });
  }
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

  // 同时刷新权限数据（不派发事件，避免在 token 刷新期间触发不必要的更新）
  try {
    const currentUser = await fetchAndBuildCurrentUser(undefined, false);
    if (currentUser && globalSetInitialState) {
      // 直接使用 setInitialState 更新权限数据
      // 等待状态更新完成，确保权限数据同步
      // Error boundary: wrap in try-catch to prevent unhandled promise rejection
      try {
        await globalSetInitialState((prev) => ({
          ...prev,
          currentUser,
        }));
      } catch (stateError) {
        // Log but don't throw - state update failure is non-critical
        // The token refresh succeeded, and user info is persisted in localStorage
        console.error(
          '[refreshTokenAndUpdatePermissions] Failed to update global state with new user info:',
          stateError,
        );
      }
    } else if (currentUser && !globalSetInitialState) {
      // Layout 还未 mount，无法直接更新权限数据
      // 存储 currentUser，待 setInitialState 可用时立即应用
      // 这确保了 token 刷新发生在 layout mount 前时，权限数据不会丢失
      pendingCurrentUser = currentUser;
      console.info(
        '[refreshTokenAndUpdatePermissions] Layout not ready, permission update queued.',
      );
    }
  } catch (error) {
    console.error(
      '[refreshTokenAndUpdatePermissions] 刷新权限数据失败:',
      error,
    );
    // 权限数据刷新失败时，通知管理员可能需要刷新页面
    // 但不阻断 token 刷新流程
    const { message } = getGlobalFeedbackInstances();
    message.warning(
      getIntl().formatMessage({
        id: 'pages.request.permissionSyncFailed',
        defaultMessage:
          'Permission data synchronization failed. Some features may be limited. It is recommended to refresh the page to get the latest permissions.',
      }),
    );
  }

  return newToken;
}

// ============================================================================
// Response Interceptor Helper Functions
// ============================================================================

/**
 * Log response error with context for debugging
 */
function logResponseError(
  response: {
    config?: { url?: string; method?: string };
    data?: { errorCode?: string; errorMessage?: string };
  },
  error?: unknown,
): void {
  console.error('[Response Interceptor Error]', {
    url: response.config?.url,
    method: (response.config?.method || 'unknown').toUpperCase(),
    errorCode: response.data?.errorCode,
    errorMessage: response.data?.errorMessage,
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle authentication errors (401 Unauthorized)
 * Attempts to refresh token and retry the request.
 *
 * @returns Response if token refresh succeeded and request retried, null otherwise
 */
async function handleAuthError(
  response: {
    data: { success?: boolean; errorCode?: string; data?: unknown };
    config?: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      _responseRetryCount?: number;
    };
  },
): Promise<{
  data: unknown;
  config?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    _responseRetryCount?: number;
  };
} | null> {
  const { data, config } = response;

  // Check if this is a 401 error
  if (data?.success !== false || data?.errorCode !== ApiErrorCodes.UNAUTHORIZED) {
    return null;
  }

  // Check retry count to prevent infinite loops
  const retryCount = config?._responseRetryCount || 0;
  if (retryCount >= 1) {
    redirectToLogin();
    return Promise.reject(response);
  }

  // Check if refresh token exists
  const refreshTokenValue = await getRefreshToken();
  if (!refreshTokenValue) {
    const { message } = getGlobalFeedbackInstances();
    message.warning(
      getIntl().formatMessage({
        id: 'pages.auth.sessionExpired',
        defaultMessage: '登录已过期，请重新登录',
      }),
    );
    redirectToLogin();
    return Promise.reject(response);
  }

  // Attempt token refresh and retry
  try {
    const newToken = await refreshTokenAndUpdatePermissions();

    if (!newToken) {
      const { message } = getGlobalFeedbackInstances();
      message.warning(
        getIntl().formatMessage({
          id: 'pages.auth.sessionExpired',
          defaultMessage: '登录已过期，请重新登录',
        }),
      );
      redirectToLogin();
      return Promise.reject(response);
    }

    // Retry original request with new token
    if (config) {
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${newToken}`,
      };
      config._responseRetryCount = retryCount + 1;

      // Important: must use getResponse: true to get full response object
      // Response interceptor needs to return response object (with .data property)
      return request(config.url, { ...config, getResponse: true });
    }

    return null;
  } catch (refreshError) {
    console.error('[Token Refresh Failed]', {
      url: config?.url,
      method: (config?.method || 'unknown').toUpperCase(),
      error: refreshError instanceof Error ? refreshError.message : String(refreshError),
      timestamp: new Date().toISOString(),
    });
    return Promise.reject(refreshError);
  }
}

/**
 * Handle business errors from API responses
 * Extracts error message and shows user feedback
 */
function handleBusinessError(
  response: {
    data: { success?: boolean; errorCode?: string; errorMessage?: string; showType?: ErrorShowType };
  },
): void {
  const { data } = response;

  // Only handle failed responses
  if (data?.success !== false) {
    return;
  }

  const { errorMessage, errorCode, showType } = data;
  const { message, notification } = getGlobalFeedbackInstances();

  // Show error based on showType
  switch (showType) {
    case ErrorShowType.SILENT:
      // Do nothing
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
      window.location.href = PUBLIC_PATHS.login;
      break;
    default:
      // Default: show error message
      if (errorMessage) {
        message.error(errorMessage);
      }
  }
}

// ============================================================================
// Token Management Utilities
// ============================================================================

/**
 * Parse JWT token expiration time.
 * Returns expiration timestamp in milliseconds, or null if parsing fails.
 */
function getTokenExpirationTime(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp) {
      return payload.exp * 1000; // Convert to milliseconds
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired or about to expire.
 * Buffer of 60 seconds to refresh before actual expiration.
 * Increased from 30s to 60s to accommodate slow network conditions.
 */
function isTokenExpired(token: string): boolean {
  const expirationTime = getTokenExpirationTime(token);
  if (!expirationTime) {
    return false; // Can't parse, assume valid
  }
  const BUFFER_MS = 60 * 1000; // 60 seconds buffer - sufficient for slow networks
  return Date.now() >= expirationTime - BUFFER_MS;
}

// 与后端约定的响应数据格式
interface ResponseStructure {
  success: boolean;
  data: unknown;
  errorCode?: string;
  errorMessage?: string;
  showType?: ErrorShowType;
}

// 自动重试配置：针对瞬态网络错误和服务端错误
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * 判断错误是否可重试
 * 仅对网络错误（无响应）和 5xx 服务端错误进行重试
 */
function isRetryableError(error: {
  request?: unknown;
  response?: { status: number };
}): boolean {
  // 网络错误：请求已发出但无响应（超时、断网等）
  if (error.request && !error.response) {
    return true;
  }
  // 5xx 服务端错误
  if (error.response && error.response.status >= 500) {
    return true;
  }
  return false;
}

/**
 * Calculate retry delay with exponential backoff and jitter.
 * Jitter prevents thundering herd problem when multiple clients retry simultaneously.
 * Formula: baseDelay * 2^attempt + random(0, baseDelay)
 */
function calculateRetryDelay(attempt: number): number {
  const exponentialDelay = RETRY_DELAY_MS * 2 ** attempt;
  const jitter = Math.random() * RETRY_DELAY_MS;
  return exponentialDelay + jitter;
}

/**
 * 延迟指定毫秒数
 */
function retryDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        const error: Error & { name: string; info: unknown } = new Error(
          errorMessage,
        );
        error.name = 'BizError';
        error.info = { errorCode, errorMessage, showType, data };
        throw error; // 抛出自制的错误
      }
    },
    // 错误接收及处理 - 注意：errorHandler 不能异步阻塞！
    // 401 错误处理已移到响应拦截器中
    errorHandler: (
      error: Error & {
        name: string;
        response?: { status: number; data: unknown };
        request?: unknown;
        config?: { url?: string; method?: string; data?: unknown };
      },
      opts?: { skipErrorHandler?: boolean },
    ): void => {
      if (opts?.skipErrorHandler) throw error;

      // 记录请求失败日志（含请求上下文）
      // Include request body for debugging (excluding sensitive fields)
      if (error.response) {
        const serverData = error.response.data as { errorCode?: string };
        const requestBody = error.config?.data;
        const sanitizedBody = requestBody
          ? sanitizeRequestBody(requestBody)
          : undefined;
        console.error('[API Error]', {
          url: error.config?.url || 'unknown',
          method: (error.config?.method || 'unknown').toUpperCase(),
          status: error.response.status,
          errorCode: serverData?.errorCode,
          requestBody: sanitizedBody,
          timestamp: new Date().toISOString(),
        });
      } else if (error.request) {
        const requestBody = error.config?.data;
        const sanitizedBody = requestBody
          ? sanitizeRequestBody(requestBody)
          : undefined;
        console.error('[Network Error]', {
          url: error.config?.url || 'unknown',
          method: (error.config?.method || 'unknown').toUpperCase(),
          error: error.message || 'No response received',
          requestBody: sanitizedBody,
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
        const errorInfo = error.info as ResponseStructure | undefined;
        if (errorInfo) {
          const { errorMessage, errorCode } = errorInfo;
          const { message, notification } = getGlobalFeedbackInstances();
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
              window.location.href = PUBLIC_PATHS.login;
              break;
            default:
              message.error(errorMessage);
          }
        }
      } else if (error.response) {
        // Axios 的错误
        // 请求成功发出且服务器也响应了状态码，但状态代码超出了 2xx 的范围

        // 尝试从响应体中提取错误信息
        const serverError = error.response.data as { errorMessage?: string };
        const errorMessage =
          typeof serverError === 'object' && serverError?.errorMessage
            ? serverError.errorMessage
            : getIntl().formatMessage(
                {
                  id: 'pages.request.failure',
                  defaultMessage: 'Request failed ({status})',
                },
                { status: error.response.status || 'unknown' },
              );
        const { message } = getGlobalFeedbackInstances();
        message.error(errorMessage);
      } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const { message } = getGlobalFeedbackInstances();
        message.error(
          getIntl().formatMessage({
            id: 'app.request.offline',
            defaultMessage:
              'Network unavailable. Please check your connection and try again.',
          }),
        );
      } else if (error.request) {
        const { message } = getGlobalFeedbackInstances();
        message.error(
          getIntl().formatMessage({
            id: 'pages.request.noResponse',
            defaultMessage: 'No response! Please retry.',
          }),
        );
      } else {
        const { message } = getGlobalFeedbackInstances();
        message.error(
          getIntl().formatMessage({
            id: 'pages.request.error',
            defaultMessage: 'Request error, please retry.',
          }),
        );
      }
    },
  },

  // 请求拦截器
  //
  // Attaches JWT token to request headers.
  // If token is expired, skip attachment and let 401 handler trigger refresh.
  //
  // NOTE: Concurrent refresh prevention is handled by `refreshAccessToken` in utils/auth-storage.ts,
  // which implements Promise deduplication to ensure only one refresh request is in-flight at a time.
  requestInterceptors: [
    async (config: RequestOptions) => {
      // 从 localStorage 获取 JWT token（异步解密）
      const accessToken = await getAccessTokenDecrypted();
      if (accessToken) {
        // Check if token is expired before sending request
        // If expired, skip adding token and let 401 handler trigger refresh
        if (isTokenExpired()) {
          console.warn(
            '[Request Interceptor] Token expired, skipping token attachment. 401 handler will trigger refresh.',
            {
              url: config.url,
            },
          );
          return config;
        }

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
    // 数据解包和 401 处理
    async (response: {
      data: { success?: boolean; errorCode?: string; data?: unknown };
      config?: {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        _responseRetryCount?: number;
      };
    }) => {
      try {
        const { data } = response;

        // Safety check: ensure response data exists and has expected structure
        if (data === undefined || data === null) {
          console.warn(
            '[Response Interceptor] Unexpected null/undefined response data',
            {
              url: response.config?.url,
              method: (response.config?.method || 'unknown').toUpperCase(),
            },
          );
          return response;
        }

        // Check if response follows expected envelope structure
        const hasEnvelopeStructure = 'success' in data;
        if (!hasEnvelopeStructure) {
          // Backend may return raw data without envelope
          const isDev = process.env.NODE_ENV === 'development';
          if (isDev) {
            console.warn(
              '[Response Interceptor] Response without envelope structure detected. ' +
                'Backend should return { success, data } format per API specification.',
              {
                url: response.config?.url,
                dataType: typeof data,
                responseKeys: Object.keys(data || {}),
              },
            );
          } else {
            console.debug(
              '[Response Interceptor] Response without envelope structure, passing through',
              {
                url: response.config?.url,
                dataType: typeof data,
              },
            );
          }
          return response;
        }

        // Success response: unwrap data
        if (data.success === true) {
          if (data.data === undefined) {
            console.warn(
              '[Response Interceptor] Success response but data.data is undefined',
              {
                url: response.config?.url,
              },
            );
          }
          response.data = data.data;
          return response;
        }

        // Handle 401 authentication errors with token refresh
        const authRetryResponse = await handleAuthError(response);
        if (authRetryResponse) {
          return authRetryResponse;
        }

        // Handle other business errors (show user feedback)
        handleBusinessError(response);

        return response;
      } catch (interceptorError) {
        // Catch unexpected errors during interceptor processing
        logResponseError(response, interceptorError);
        const { message } = getGlobalFeedbackInstances();
        message.error(
          getIntl().formatMessage({
            id: 'pages.request.responseError',
            defaultMessage:
              'Response processing error, please refresh the page and try again',
          }),
        );
        return Promise.reject(interceptorError);
      }
    },
    // 自动重试拦截器：对瞬态错误（网络错误、5xx）进行自动重试
    // 使用 tuple 格式 [successHandler, errorHandler]
    // NOTE: IErrorInterceptor 类型定义为 (error: Error) => Promise<Error>，
    // 但 axios 运行时允许错误拦截器返回响应（resolve）以完成重试。
    // 类型断言用于绕过 TypeScript 限制。
    [
      // Success handler: 直接通过，由前一个拦截器处理
      (response: unknown) => response,
      // Error handler: 自动重试网络错误和 5xx 错误
      async (error: {
        config?: { url?: string; method?: string; _requestRetryCount?: number };
        request?: unknown;
        response?: { status: number };
      }) => {
        const config = error?.config;

        // 无法获取配置或已跳过错误处理，直接拒绝
        if (!config) {
          return Promise.reject(error);
        }

        // 检查是否可重试且未达到最大重试次数
        const retryCount = config._requestRetryCount || 0;
        if (isRetryableError(error) && retryCount < MAX_RETRIES) {
          config._requestRetryCount = retryCount + 1;

          console.warn(
            `[Retry] Attempt ${retryCount + 1}/${MAX_RETRIES} for ${config.method?.toUpperCase()} ${config.url}`,
          );

          await retryDelay(calculateRetryDelay(retryCount));

          // 重试请求，使用 getResponse: true 获取完整响应对象
          return request(config.url, { ...config, getResponse: true });
        }

        // 不可重试或已达最大重试次数，传递错误
        return Promise.reject(error);
      },
    ] as const,
  ],
};
