import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateRetryDelay,
  errorConfig,
  getTokenExpirationTime,
  handleAuthError,
  isTokenExpired,
  sanitizeRequestBody,
} from './requestErrorConfig';

vi.mock('antd', () => ({
  message: {
    warning: vi.fn(),
    error: vi.fn(),
  },
  notification: {
    open: vi.fn(),
  },
}));

const mockMessage = {
  warning: vi.fn(),
  error: vi.fn(),
};

const mockNotification = {
  open: vi.fn(),
};

vi.mock('@/utils/globalFeedback', () => ({
  getGlobalFeedbackInstances: vi.fn(() => ({
    message: mockMessage,
    notification: mockNotification,
  })),
}));

const { mockHistoryReplace } = vi.hoisted(() => ({
  mockHistoryReplace: vi.fn(),
}));

vi.mock('@umijs/max', () => ({
  getIntl: vi.fn(() => ({
    formatMessage: vi.fn(({ defaultMessage }) => defaultMessage),
  })),
  history: {
    location: { pathname: '/', search: '', hash: '' },
    replace: mockHistoryReplace,
  },
  request: vi.fn(),
}));

vi.mock('@/utils/auth-storage', () => ({
  clearAuth: vi.fn(),
  getAccessTokenDecrypted: vi.fn(),
  getRefreshToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock('@/utils/user-utils', () => ({
  fetchAndBuildCurrentUser: vi.fn(),
}));

vi.mock('@/constants/routes', () => ({
  PUBLIC_PATHS: {
    login: '/user/login',
  },
}));

vi.mock('@/services/types', () => ({
  ApiErrorCodes: {
    UNAUTHORIZED: 'unauthorized',
  },
  ErrorShowType: {
    SILENT: 0,
    WARN_MESSAGE: 1,
    ERROR_MESSAGE: 2,
    NOTIFICATION: 3,
    REDIRECT: 9,
  },
}));

describe('requestErrorConfig', () => {
  // biome-ignore lint/style/noNonNullAssertion: config handlers are always defined
  const errorThrower = errorConfig.errorConfig!.errorThrower!;
  // biome-ignore lint/style/noNonNullAssertion: config handlers are always defined
  const errorHandler = errorConfig.errorConfig!.errorHandler!;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('errorThrower', () => {
    it('should throw error when success is false', () => {
      const response = {
        success: false,
        data: null,
        errorCode: 'bad_request',
        errorMessage: 'Bad Request',
        showType: 2,
      };

      expect(() => {
        errorThrower(response);
      }).toThrow('Bad Request');
    });

    it('should not throw error when success is true', () => {
      const response = {
        success: true,
        data: { id: 1 },
      };

      expect(() => {
        errorThrower(response);
      }).not.toThrow();
    });

    it('should throw BizError with correct info', () => {
      const response = {
        success: false,
        data: { detail: 'more info' },
        errorCode: 403,
        errorMessage: 'Forbidden',
        showType: 3,
      };

      expect.assertions(5);
      try {
        errorThrower(response);
      } catch (error: any) {
        expect(error.name).toBe('BizError');
        expect(error.info.errorCode).toBe(403);
        expect(error.info.errorMessage).toBe('Forbidden');
        expect(error.info.showType).toBe(3);
        expect(error.info.data).toEqual({ detail: 'more info' });
      }
    });
  });

  describe('errorHandler', () => {
    it('should rethrow error when skipErrorHandler is true', () => {
      const error = new Error('Test error');
      const opts = { skipErrorHandler: true };

      expect(() => {
        errorHandler(error, opts);
      }).toThrow('Test error');
    });

    it('should handle SILENT showType', () => {
      const error: any = new Error('Silent error');
      error.name = 'BizError';
      error.info = {
        errorCode: 1001,
        errorMessage: 'Silent error',
        showType: 0,
      };

      errorHandler(error, {});

      expect(mockMessage.warning).not.toHaveBeenCalled();
      expect(mockMessage.error).not.toHaveBeenCalled();
      expect(mockNotification.open).not.toHaveBeenCalled();
    });

    it('should handle WARN_MESSAGE showType', () => {
      const error: any = new Error('Warning');
      error.name = 'BizError';
      error.info = {
        errorCode: 1002,
        errorMessage: 'This is a warning',
        showType: 1,
      };

      errorHandler(error, {});

      expect(mockMessage.warning).toHaveBeenCalledWith('This is a warning');
    });

    it('should handle ERROR_MESSAGE showType', () => {
      const error: any = new Error('Error message');
      error.name = 'BizError';
      error.info = {
        errorCode: 1003,
        errorMessage: 'This is an error',
        showType: 2,
      };

      errorHandler(error, {});

      expect(mockMessage.error).toHaveBeenCalledWith('This is an error');
    });

    it('should handle NOTIFICATION showType', () => {
      const error: any = new Error('Notification');
      error.name = 'BizError';
      error.info = {
        errorCode: 1004,
        errorMessage: 'This is a notification',
        showType: 3,
      };

      errorHandler(error, {});

      expect(mockNotification.open).toHaveBeenCalledWith({
        title: 1004,
        description: 'This is a notification',
      });
    });

    it('should handle REDIRECT showType', () => {
      const error: any = new Error('Redirect');
      error.name = 'BizError';
      error.info = {
        errorCode: 'unauthorized',
        errorMessage: 'Unauthorized',
        showType: 9,
      };

      errorHandler(error, {});

      // REDIRECT uses history.replace (consistent with rest of app)
      expect(mockHistoryReplace).toHaveBeenCalledWith('/user/login');
      // REDIRECT 分支不应触发任何消息/通知提示
      expect(mockMessage.warning).not.toHaveBeenCalled();
      expect(mockMessage.error).not.toHaveBeenCalled();
      expect(mockNotification.open).not.toHaveBeenCalled();
    });

    it('should handle default case for unknown showType', () => {
      const error: any = new Error('Unknown type');
      error.name = 'BizError';
      error.info = {
        errorCode: 1005,
        errorMessage: 'Unknown error type',
        showType: 99,
      };

      errorHandler(error, {});

      expect(mockMessage.error).toHaveBeenCalledWith('Unknown error type');
    });

    it('should handle axios response error', () => {
      const error: any = new Error('Axios error');
      error.response = {
        status: 500,
        data: {},
      };

      errorHandler(error, {});

      // Error message uses i18n template with status placeholder
      expect(mockMessage.error).toHaveBeenCalledWith(
        'Request failed ({status})',
      );
    });

    it('should handle offline error', () => {
      const error: any = new Error('Network error');
      error.request = {};

      const originalOnLine = navigator.onLine;
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });

      try {
        errorHandler(error, {});

        expect(mockMessage.error).toHaveBeenCalledWith(
          'Network unavailable. Please check your connection and try again.',
        );
      } finally {
        Object.defineProperty(navigator, 'onLine', {
          writable: true,
          value: originalOnLine,
        });
      }
    });

    it('should handle request error with no response', () => {
      const error: any = new Error('Request error');
      error.request = {};

      errorHandler(error, {});

      expect(mockMessage.error).toHaveBeenCalledWith(
        'No response! Please retry.',
      );
    });

    it('should handle generic error', () => {
      const error: any = new Error('Generic error');

      errorHandler(error, {});

      expect(mockMessage.error).toHaveBeenCalledWith(
        'Request error, please retry.',
      );
    });
  });

  describe('requestInterceptors', () => {
    // The interceptor is async (fetches token), so we need to await it
    const interceptor = errorConfig.requestInterceptors?.[0] as (config: {
      url?: string;
      method?: string;
    }) => Promise<{ url?: string }>;

    it('should pass through config without modification', async () => {
      const config = {
        url: 'https://api.example.com/users',
        method: 'GET',
      };

      const result = await interceptor(config);

      // Interceptor attaches JWT token asynchronously; without a mocked token
      // in localStorage, config passes through unchanged — verifying the no-token path.
      expect(result.url).toBe('https://api.example.com/users');
    });

    it('should handle URL without config', async () => {
      const config = {};

      const result = await interceptor(config);

      expect(result.url).toBeUndefined();
    });
  });

  describe('retry interceptor', () => {
    // 重试拦截器是 responseInterceptors 数组的第二个元素，格式为 tuple
    const retryInterceptor = errorConfig.responseInterceptors?.[1] as [
      (response: any) => any,
      (error: any) => Promise<any>,
    ];
    const successHandler = retryInterceptor[0];
    const errorHandler = retryInterceptor[1];

    it('should pass through successful responses', () => {
      const response = { data: { success: true, data: { id: 1 } } };
      const result = successHandler(response);
      expect(result).toBe(response);
    });

    it('should retry on network error (no response)', async () => {
      const error: any = new Error('Network error');
      error.request = {};
      error.config = {
        url: '/api/test',
        method: 'GET',
        _requestRetryCount: 0,
      };

      // Import mocked request
      const { request } = await import('@umijs/max');
      const mockRequest = request as ReturnType<typeof vi.fn>;
      mockRequest.mockResolvedValueOnce({
        data: { success: true, data: { id: 1 } },
      });

      const result = await errorHandler(error);

      expect(error.config._requestRetryCount).toBe(1);
      expect(mockRequest).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should retry on 5xx error', async () => {
      const error: any = new Error('Server error');
      error.response = { status: 500 };
      error.config = {
        url: '/api/test',
        method: 'POST',
        _requestRetryCount: 0,
      };

      const { request } = await import('@umijs/max');
      const mockRequest = request as ReturnType<typeof vi.fn>;
      mockRequest.mockResolvedValueOnce({
        data: { success: true, data: { id: 1 } },
      });

      const result = await errorHandler(error);

      expect(error.config._requestRetryCount).toBe(1);
      expect(mockRequest).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should not retry on 4xx error', async () => {
      const error: any = new Error('Client error');
      error.response = { status: 404 };
      error.config = {
        url: '/api/test',
        method: 'GET',
        _requestRetryCount: 0,
      };

      await expect(errorHandler(error)).rejects.toBe(error);
      expect(error.config._requestRetryCount).toBe(0);
    });

    it('should not retry beyond max attempts', async () => {
      const error: any = new Error('Network error');
      error.request = {};
      error.config = {
        url: '/api/test',
        method: 'GET',
        _requestRetryCount: 2, // Already at max retries
      };

      await expect(errorHandler(error)).rejects.toBe(error);
      expect(error.config._requestRetryCount).toBe(2);
    });

    it('should reject if config is missing', async () => {
      const error: any = new Error('Unknown error');
      // No config property

      await expect(errorHandler(error)).rejects.toBe(error);
    });
  });

  describe('sanitizeRequestBody', () => {
    it('should return primitive values unchanged', () => {
      expect(sanitizeRequestBody('hello')).toBe('hello');
      expect(sanitizeRequestBody(42)).toBe(42);
      expect(sanitizeRequestBody(null)).toBe(null);
      expect(sanitizeRequestBody(undefined)).toBe(undefined);
    });

    it('should redact sensitive fields', () => {
      const body = {
        email: 'admin@example.com',
        password: 'secret123',
        name: 'Admin',
      };
      const result = sanitizeRequestBody(body) as Record<string, unknown>;

      expect(result.email).toBe('admin@example.com');
      expect(result.password).toBe('[REDACTED]');
      expect(result.name).toBe('Admin');
    });

    it('should redact fields containing sensitive keywords', () => {
      const body = {
        access_token: 'jwt-token-value',
        refresh_token: 'refresh-value',
        my_secret_key: 'hidden',
        otp_code: '123456',
      };
      const result = sanitizeRequestBody(body) as Record<string, unknown>;

      expect(result.access_token).toBe('[REDACTED]');
      expect(result.refresh_token).toBe('[REDACTED]');
      expect(result.my_secret_key).toBe('[REDACTED]');
      expect(result.otp_code).toBe('[REDACTED]');
    });

    it('should redact nested sensitive fields recursively', () => {
      const body = {
        user: {
          name: 'Admin',
          credentials: {
            password: 'secret',
            token: 'abc',
          },
        },
      };
      const result = sanitizeRequestBody(body) as Record<string, unknown>;
      const user = result.user as Record<string, unknown>;
      const creds = user.credentials as Record<string, unknown>;

      expect(user.name).toBe('Admin');
      expect(creds.password).toBe('[REDACTED]');
      expect(creds.token).toBe('[REDACTED]');
    });

    it('should handle arrays with sensitive objects', () => {
      const body = {
        users: [
          { name: 'Alice', password: 'pw1' },
          { name: 'Bob', password: 'pw2' },
        ],
      };
      const result = sanitizeRequestBody(body) as Record<string, unknown>;
      const users = result.users as Array<Record<string, unknown>>;

      expect(users[0].name).toBe('Alice');
      expect(users[0].password).toBe('[REDACTED]');
      expect(users[1].password).toBe('[REDACTED]');
    });

    it('should guard against excessively deep objects', () => {
      // Build a deeply nested object (depth > 5)
      let deep: Record<string, unknown> = { password: 'secret' };
      for (let i = 0; i < 7; i++) {
        deep = { nested: deep };
      }

      const result = sanitizeRequestBody(deep) as Record<string, unknown>;
      // At depth > 5, should return '[MAX_DEPTH]' marker.
      // Traverse 6 levels deep to reach the MAX_DEPTH sentinel.
      let current: unknown = result;
      for (let i = 0; i < 6; i++) {
        current = (current as Record<string, unknown>).nested;
      }
      expect(current).toBe('[MAX_DEPTH]');
    });
  });

  describe('getTokenExpirationTime', () => {
    it('should parse JWT exp claim correctly', () => {
      // Create a minimal JWT: header.payload.signature
      const payload = { exp: 1700000000, sub: 'user1' };
      const base64Payload = btoa(JSON.stringify(payload));
      const token = `header.${base64Payload}.signature`;

      const result = getTokenExpirationTime(token);
      expect(result).toBe(1700000000000); // seconds -> milliseconds
    });

    it('should return null for token without exp claim', () => {
      const payload = { sub: 'user1' };
      const base64Payload = btoa(JSON.stringify(payload));
      const token = `header.${base64Payload}.signature`;

      const result = getTokenExpirationTime(token);
      expect(result).toBeNull();
    });

    it('should return null for malformed token', () => {
      expect(getTokenExpirationTime('not-a-jwt')).toBeNull();
      expect(getTokenExpirationTime('')).toBeNull();
      expect(getTokenExpirationTime('a.b.c')).toBeNull(); // invalid base64
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for expired token', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) - 3600 }; // 1 hour ago
      const base64Payload = btoa(JSON.stringify(payload));
      const token = `header.${base64Payload}.signature`;

      expect(isTokenExpired(token)).toBe(true);
    });

    it('should return true for token within 60s buffer', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 30 }; // 30s from now (within 60s buffer)
      const base64Payload = btoa(JSON.stringify(payload));
      const token = `header.${base64Payload}.signature`;

      expect(isTokenExpired(token)).toBe(true);
    });

    it('should return false for token well beyond buffer', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }; // 1 hour from now
      const base64Payload = btoa(JSON.stringify(payload));
      const token = `header.${base64Payload}.signature`;

      expect(isTokenExpired(token)).toBe(false);
    });

    it('should return false for token without exp (unparseable)', () => {
      const payload = { sub: 'user1' };
      const base64Payload = btoa(JSON.stringify(payload));
      const token = `header.${base64Payload}.signature`;

      // Can't determine expiration, assume valid
      expect(isTokenExpired(token)).toBe(false);
    });
  });

  describe('calculateRetryDelay', () => {
    it('should apply exponential backoff', () => {
      // attempt 0: base * 2^0 + jitter = 1000 + [0,1000] => [1000, 2000]
      const delay0 = calculateRetryDelay(0);
      expect(delay0).toBeGreaterThanOrEqual(1000);
      expect(delay0).toBeLessThan(2000);

      // attempt 1: base * 2^1 + jitter = 2000 + [0,1000] => [2000, 3000]
      const delay1 = calculateRetryDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(2000);
      expect(delay1).toBeLessThan(3000);
    });
  });

  describe('handleAuthError', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const makeAuthErrorResponse = (retryCount = 0) => ({
      data: {
        success: false as const,
        errorCode: 'unauthorized',
        errorMessage: 'Token expired',
      },
      config: {
        url: '/api/users',
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        _responseRetryCount: retryCount,
      },
    });

    it('returns null when error is not a 401 unauthorized', async () => {
      const response = {
        data: { success: false, errorCode: 'bad_request', errorMessage: 'Bad Request' },
        config: { url: '/api/test', method: 'GET', headers: {} },
      };

      const result = await handleAuthError(response);
      expect(result).toBeNull();
    });

    it('returns null when response is successful', async () => {
      const response = {
        data: { success: true, data: { id: 1 } },
        config: { url: '/api/test', method: 'GET', headers: {} },
      };

      const result = await handleAuthError(response);
      expect(result).toBeNull();
    });

    it('redirects to login when retry count already reached', async () => {
      const response = makeAuthErrorResponse(1); // retry count = 1

      const { history } = await import('@umijs/max');
      const { clearAuth } = await import('@/utils/auth-storage');

      await expect(handleAuthError(response)).rejects.toBeDefined();
      expect(clearAuth).toHaveBeenCalled();
      expect(history.replace).toHaveBeenCalledWith(
        expect.stringContaining('/user/login'),
      );
    });

    it('redirects to login when refresh token is missing', async () => {
      const response = makeAuthErrorResponse(0);

      const { getRefreshToken } = await import('@/utils/auth-storage');
      (getRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const { history } = await import('@umijs/max');
      const { clearAuth } = await import('@/utils/auth-storage');

      await expect(handleAuthError(response)).rejects.toBeDefined();
      expect(clearAuth).toHaveBeenCalled();
      expect(history.replace).toHaveBeenCalledWith(
        expect.stringContaining('/user/login'),
      );
    });

    it('redirects to login when token refresh returns null', async () => {
      const response = makeAuthErrorResponse(0);

      const { getRefreshToken, refreshAccessToken } = await import(
        '@/utils/auth-storage'
      );
      (getRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'valid-refresh-token',
      );
      (refreshAccessToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        null,
      );

      const { history } = await import('@umijs/max');
      const { clearAuth } = await import('@/utils/auth-storage');

      await expect(handleAuthError(response)).rejects.toBeDefined();
      expect(clearAuth).toHaveBeenCalled();
      expect(history.replace).toHaveBeenCalledWith(
        expect.stringContaining('/user/login'),
      );
    });

    it('retries request with new token when refresh succeeds', async () => {
      const response = makeAuthErrorResponse(0);

      const { getRefreshToken, refreshAccessToken } = await import(
        '@/utils/auth-storage'
      );
      const { request } = await import('@umijs/max');
      const { fetchAndBuildCurrentUser } = await import('@/utils/user-utils');

      (getRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'valid-refresh-token',
      );
      (refreshAccessToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'new-access-token',
      );
      (fetchAndBuildCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        { id: '1', name: 'Admin' },
      );
      (request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { success: true, data: { id: 1 } },
      });

      const result = await handleAuthError(response);

      expect(result).toBeDefined();
      expect(request).toHaveBeenCalledWith(
        '/api/users',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer new-access-token',
          }),
          _responseRetryCount: 1,
          getResponse: true,
        }),
      );
    });

    it('rejects when token refresh throws an error', async () => {
      const response = makeAuthErrorResponse(0);

      const { getRefreshToken, refreshAccessToken } = await import(
        '@/utils/auth-storage'
      );
      (getRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        'valid-refresh-token',
      );
      const refreshError = new Error('Network failure during refresh');
      (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        refreshError,
      );

      await expect(handleAuthError(response)).rejects.toThrow(
        'Network failure during refresh',
      );
    });

    it('does not redirect when already on login page', async () => {
      const response = makeAuthErrorResponse(1); // retry count exceeded

      const { history } = await import('@umijs/max');
      (history.location as { pathname: string }).pathname = '/user/login';

      const { clearAuth } = await import('@/utils/auth-storage');

      await expect(handleAuthError(response)).rejects.toBeDefined();
      // clearAuth should NOT be called since redirectToLogin skips when on login page
      expect(clearAuth).not.toHaveBeenCalled();
      // history.replace should also not be called
      expect(history.replace).not.toHaveBeenCalled();
    });
  });
});
