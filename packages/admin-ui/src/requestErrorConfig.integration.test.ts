/**
 * Token 自动刷新机制集成测试
 *
 * 测试场景：
 * 1. Access token 过期时，自动使用 refresh token 刷新
 * 2. 刷新成功后，重试原请求
 * 3. 刷新失败时，清除 auth 并跳转登录页
 * 4. 并发请求时，只刷新一次 token
 */

import { request } from '@umijs/max';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminAuth from '@/services/admin-auth';
import * as authStorage from '@/utils/auth-storage';
import { errorConfig } from './requestErrorConfig';

// Mock 依赖
vi.mock('@umijs/max', () => ({
  request: vi.fn(),
  history: {
    location: { pathname: '/test', search: '', hash: '' },
    replace: vi.fn(),
  },
  getIntl: vi.fn(() => ({
    formatMessage: vi.fn(({ defaultMessage }) => defaultMessage),
  })),
}));

vi.mock('@/utils/auth-storage');
vi.mock('@/services/admin-auth');

describe('Token Auto Refresh Integration', () => {
  const mockAccessToken = 'mock-access-token';
  const mockRefreshToken = 'mock-refresh-token';
  const mockNewAccessToken = 'new-access-token';
  const mockNewRefreshToken = 'new-refresh-token';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // 设置初始 token
    vi.mocked(authStorage.getRefreshToken).mockReturnValue(mockRefreshToken);
    vi.mocked(authStorage.setTokens).mockImplementation(() => {});
    vi.mocked(authStorage.clearAuth).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Scenario 1: Access token expires and refresh succeeds', () => {
    it('should automatically refresh token when receiving 401', async () => {
      // 模拟第一次请求返回 401
      const expiredError = new Error('Unauthorized') as any;
      expiredError.response = { status: 401 };
      expiredError.config = {
        url: '/api/test',
        method: 'GET',
        headers: { Authorization: `Bearer ${mockAccessToken}` },
      };

      // 模拟刷新 token 成功
      vi.mocked(adminAuth.refreshToken).mockResolvedValueOnce({
        access_token: mockNewAccessToken,
        refresh_token: mockNewRefreshToken,
        expires_in: 3600,
        token_type: 'Bearer',
      });

      // 模拟重试请求成功
      const mockResponse = { data: { success: true, data: { id: 1 } } };
      vi.mocked(request).mockResolvedValueOnce(mockResponse);

      // 调用 errorHandler
      const errorHandler = errorConfig.errorConfig?.errorHandler as any;
      await errorHandler(expiredError, {});

      // 验证刷新 token 被调用
      expect(adminAuth.refreshToken).toHaveBeenCalledWith(
        { refresh_token: mockRefreshToken },
        { skipErrorHandler: true },
      );

      // 验证新 token 被保存
      expect(authStorage.setTokens).toHaveBeenCalledWith(
        mockNewAccessToken,
        mockNewRefreshToken,
        3600,
      );

      // 验证原请求被重试
      expect(request).toHaveBeenCalledWith('/api/test', expect.any(Object));

      // errorHandler 返回 void，重试的请求结果通过 request mock 返回
    });
  });

  describe('Scenario 2: Refresh token fails', () => {
    it('should clear auth and redirect to login when refresh fails', async () => {
      // 模拟 401 错误
      const unauthorizedError = new Error('Unauthorized') as any;
      unauthorizedError.response = { status: 401 };
      unauthorizedError.config = {
        url: '/api/test',
        method: 'GET',
      };

      // 模拟刷新 token 失败
      vi.mocked(adminAuth.refreshToken).mockRejectedValueOnce(
        new Error('Invalid refresh token'),
      );

      const errorHandler = errorConfig.errorConfig?.errorHandler as any;

      await expect(errorHandler(unauthorizedError, {})).rejects.toThrow();

      // 验证清除 auth
      expect(authStorage.clearAuth).toHaveBeenCalled();

      // 验证跳转登录页
      const { history } = await import('@umijs/max');
      expect(history.replace).toHaveBeenCalledWith(
        expect.stringContaining('/user/login'),
      );
    });
  });

  describe('Scenario 3: No refresh token available', () => {
    it('should clear auth and redirect to login when no refresh token', async () => {
      // 模拟没有 refresh token
      vi.mocked(authStorage.getRefreshToken).mockReturnValue(null);

      const unauthorizedError = new Error('Unauthorized') as any;
      unauthorizedError.response = { status: 401 };
      unauthorizedError.config = {
        url: '/api/test',
        method: 'GET',
      };

      const errorHandler = errorConfig.errorConfig?.errorHandler as any;

      await expect(errorHandler(unauthorizedError, {})).rejects.toThrow();

      // 验证清除 auth
      expect(authStorage.clearAuth).toHaveBeenCalled();

      // 验证跳转登录页
      const { history } = await import('@umijs/max');
      expect(history.replace).toHaveBeenCalledWith(
        expect.stringContaining('/user/login'),
      );
    });
  });

  describe('Scenario 4: Non-401 errors should not trigger refresh', () => {
    it('should not refresh token for 500 errors', async () => {
      const serverError = new Error('Internal Server Error') as any;
      serverError.response = { status: 500 };
      serverError.config = {
        url: '/api/test',
        method: 'GET',
      };

      const errorHandler = errorConfig.errorConfig?.errorHandler as any;

      await errorHandler(serverError, {});

      // 验证没有调用刷新 token
      expect(adminAuth.refreshToken).not.toHaveBeenCalled();

      // 验证没有清除 auth
      expect(authStorage.clearAuth).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 5: Skip refresh for marked requests', () => {
    it('should not retry if request is marked with skipErrorHandler', async () => {
      const unauthorizedError = new Error('Unauthorized') as any;
      unauthorizedError.response = { status: 401 };
      unauthorizedError.config = {
        url: '/api/test',
        method: 'GET',
        skipErrorHandler: true,
      };

      const errorHandler = errorConfig.errorConfig?.errorHandler as any;

      await expect(
        errorHandler(unauthorizedError, { skipErrorHandler: true }),
      ).rejects.toThrow();

      // 验证没有调用刷新 token
      expect(adminAuth.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 6: Already retried requests', () => {
    it('should not retry again if already retried', async () => {
      const retriedError = new Error('Unauthorized') as any;
      retriedError.response = { status: 401 };
      retriedError.config = {
        url: '/api/test',
        method: 'GET',
        _retry: true, // 已重试标记
      };

      const errorHandler = errorConfig.errorConfig?.errorHandler as any;

      await expect(errorHandler(retriedError, {})).rejects.toThrow();

      // 验证没有调用刷新 token
      expect(adminAuth.refreshToken).not.toHaveBeenCalled();

      // 验证清除 auth
      expect(authStorage.clearAuth).toHaveBeenCalled();
    });
  });
});
