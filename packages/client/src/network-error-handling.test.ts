/**
 * Network Error Handling Tests
 *
 * Comprehensive unit tests for network error scenarios:
 * - Request timeout handling (AbortController)
 * - DNS resolution failures
 * - Connection refused / network unreachable
 * - SSL/TLS errors
 * - HTTP error status codes (401, 403, 404, 500, 503)
 * - Error retry logic (tokenExchange)
 * - User-friendly error messages
 * - RTCAgentClient WebSocket error scenarios (invalid token, account banned, message size limit)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RTCAgentClient } from './client.js';
import { OAuth2Client } from './oauth2-client.js';
import type { RTCAgentClientOptions, TokenExchangeRequest } from './types.js';
import { TokenExchangeError } from './types.js';

/**
 * Flush pending microtasks (Promise resolutions, etc.).
 * Needed when code uses fire-and-forget promises (void someAsyncFn()).
 */
async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

// =============================================================================
// OAuth2Client Network Errors
// =============================================================================

describe('OAuth2Client: Network Error Handling', () => {
  let client: OAuth2Client;
  const serverURL = 'https://api.example.com';
  const redirectUri = 'https://example.com/callback';

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OAuth2Client({ serverURL, redirectUri, timeout: 5000 });
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---------- Timeout Handling ----------

  describe('Request Timeout', () => {
    it('should abort request when timeout is exceeded', async () => {
      // Simulate a request that never resolves until aborted
      vi.mocked(fetch).mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                reject(
                  new DOMException('The operation was aborted.', 'AbortError'),
                );
              });
            }
          }),
      );

      const promise = client.getProviders();
      const resultPromise = promise.catch((err) => err);

      // Advance past the 5000ms timeout
      await vi.advanceTimersByTimeAsync(6000);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AbortError');
    });

    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ providers: ['github'] }),
      } as Response);

      await client.getProviders();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear timeout on error response', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(client.getProviders()).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  // ---------- DNS Resolution Failures ----------

  describe('DNS Resolution Failure', () => {
    it('should throw error when DNS lookup fails for getProviders', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(client.getProviders()).rejects.toThrow();
    });

    it('should throw error when DNS lookup fails for getAuthorizationUrl', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      const pkceParams = {
        codeVerifier: 'test-verifier',
        codeChallenge: 'test-challenge',
        codeChallengeMethod: 'S256' as const,
      };

      await expect(
        client.getAuthorizationUrl('github', pkceParams),
      ).rejects.toThrow();
    });

    it('should throw error when DNS lookup fails for exchangeToken', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        client.exchangeToken('code', 'state', 'verifier'),
      ).rejects.toThrow();
    });

    it('should throw TokenExchangeError with statusCode 0 when DNS fails for tokenExchange', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      const params: TokenExchangeRequest = {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'external-jwt',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        device_id: 'device-123',
      };

      // Catch the promise rejection immediately to avoid unhandled rejection
      const promise = client.tokenExchange(params);
      const resultPromise = promise.catch((err) => err);

      // Advance past the 1s retry delay
      await vi.advanceTimersByTimeAsync(1500);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(TokenExchangeError);
      expect((error as TokenExchangeError).statusCode).toBe(0);
    });
  });

  // ---------- Connection Refused / Network Unreachable ----------

  describe('Connection Refused', () => {
    it('should throw error when connection is refused', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Connection refused'));

      await expect(client.getProviders()).rejects.toThrow();
    });

    it('should throw error when network is unreachable', async () => {
      vi.mocked(fetch).mockRejectedValue(
        new TypeError('NetworkError when attempting to fetch resource.'),
      );

      await expect(client.refreshToken('refresh-token')).rejects.toThrow();
    });
  });

  // ---------- SSL/TLS Errors ----------

  describe('SSL/TLS Errors', () => {
    it('should throw error on certificate validation failure', async () => {
      vi.mocked(fetch).mockRejectedValue(
        new TypeError(
          'SSL certificate problem: unable to get local issuer certificate',
        ),
      );

      await expect(client.getProviders()).rejects.toThrow();
    });

    it('should throw error on SSL handshake failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('SSL handshake failed'));

      await expect(
        client.exchangeToken('code', 'state', 'verifier'),
      ).rejects.toThrow();
    });
  });

  // ---------- HTTP Error Status Codes (fetchWithTimeout) ----------

  describe('HTTP Error Status Codes', () => {
    it('should throw Error with status code 401 for Unauthorized', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Unauthorized'),
      } as Response);

      try {
        await client.getProviders();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('401');
      }
    });

    it('should throw Error with status code 403 for Forbidden', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve('Forbidden'),
      } as Response);

      try {
        await client.getProviders();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('403');
      }
    });

    it('should throw Error with status code 404 for Not Found', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Not Found'),
      } as Response);

      try {
        await client.getProviders();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('404');
      }
    });

    it('should throw Error with status code 500 for Internal Server Error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Internal Server Error'),
      } as Response);

      try {
        await client.getProviders();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('500');
      }
    });

    it('should throw Error with status code 503 for Service Unavailable', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve('Service Unavailable'),
      } as Response);

      try {
        await client.getProviders();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('503');
      }
    });

    it('should not expose server response body in error message (security)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () =>
          Promise.resolve(
            '{"error":"database connection failed at /var/lib/db"}',
          ),
      } as Response);

      try {
        await client.getProviders();
        expect.fail('Should have thrown');
      } catch (err) {
        // Error message should only contain the status code, not the body
        expect((err as Error).message).not.toContain('database');
        expect((err as Error).message).not.toContain('/var/lib/db');
        expect((err as Error).message).toBe('OAuth2 API error 500');
      }
    });
  });

  // ---------- Error Retry Logic (tokenExchange) ----------

  describe('Retry Logic: tokenExchange', () => {
    const createParams = (): TokenExchangeRequest => ({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'external-jwt',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      device_id: 'device-123',
    });

    const createSuccessResponse = () =>
      ({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: 'new-token',
            issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
      }) as Response;

    it('should retry once on 502 then succeed', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
        } as Response)
        .mockResolvedValueOnce(createSuccessResponse());

      // Catch the promise immediately to avoid unhandled rejection
      const promise = client.tokenExchange(createParams());
      const resultPromise = promise.catch((err) => {
        throw err;
      });

      // Advance past the 1s retry delay
      await vi.advanceTimersByTimeAsync(1500);

      const result = await resultPromise;
      expect(result.access_token).toBe('new-token');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry once on network error (fetch rejection) then succeed', async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new TypeError('Network error'))
        .mockResolvedValueOnce(createSuccessResponse());

      const promise = client.tokenExchange(createParams());
      const resultPromise = promise.catch((err) => {
        throw err;
      });

      await vi.advanceTimersByTimeAsync(1500);

      const result = await resultPromise;
      expect(result.access_token).toBe('new-token');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry on 400 Bad Request (client error)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      await expect(client.tokenExchange(createParams())).rejects.toThrow(
        TokenExchangeError,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on 401 Unauthorized (client error)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      await expect(client.tokenExchange(createParams())).rejects.toThrow(
        TokenExchangeError,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on 403 Forbidden (client error)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      } as Response);

      await expect(client.tokenExchange(createParams())).rejects.toThrow(
        TokenExchangeError,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw after both attempts fail with 503', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      // Catch the promise immediately to avoid unhandled rejection
      const promise = client.tokenExchange(createParams());
      const resultPromise = promise.catch((err) => err);

      await vi.advanceTimersByTimeAsync(1500);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(TokenExchangeError);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw TokenExchangeError with statusCode 0 after all retries exhausted on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Network is down'));

      // Catch the promise immediately to avoid unhandled rejection
      const promise = client.tokenExchange(createParams());
      const resultPromise = promise.catch((err) => err);

      await vi.advanceTimersByTimeAsync(1500);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(TokenExchangeError);
      expect((error as TokenExchangeError).statusCode).toBe(0);
      expect((error as TokenExchangeError).message).toContain(
        'Network is down',
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should include delay between retries with exponential backoff', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      // Mock Math.random to return 0 for predictable jitter
      vi.spyOn(Math, 'random').mockReturnValue(0);

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        } as Response)
        .mockResolvedValueOnce(createSuccessResponse());

      const promise = client.tokenExchange(createParams());
      const resultPromise = promise.catch((err) => {
        throw err;
      });

      await vi.advanceTimersByTimeAsync(1500);

      await resultPromise;
      // First retry delay should be 1000ms (base) + 0ms (jitter) = 1000ms
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

      // Restore Math.random
      vi.restoreAllMocks();
    });
  });

  // ---------- User-Friendly Error Messages ----------

  describe('User-Friendly Error Messages', () => {
    it('TokenExchangeError should contain HTTP status code for HTTP errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      const params: TokenExchangeRequest = {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'jwt',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        device_id: 'device-123',
      };

      // Catch the promise immediately to avoid unhandled rejection
      const promise = client.tokenExchange(params);
      const resultPromise = promise.catch((err) => err);

      await vi.advanceTimersByTimeAsync(1500);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(TokenExchangeError);
      expect((error as TokenExchangeError).message).toContain('503');
    });

    it('TokenExchangeError should contain original error message for network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(
        new TypeError('Failed to connect to server'),
      );

      const params: TokenExchangeRequest = {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'jwt',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        device_id: 'device-123',
      };

      const promise = client.tokenExchange(params);
      const resultPromise = promise.catch((err) => err);

      await vi.advanceTimersByTimeAsync(1500);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(TokenExchangeError);
      expect((error as TokenExchangeError).message).toContain(
        'Failed to connect to server',
      );
    });

    it('TokenExchangeError should have correct name property', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Network error'));

      const params: TokenExchangeRequest = {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: 'jwt',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        device_id: 'device-123',
      };

      const promise = client.tokenExchange(params);
      const resultPromise = promise.catch((err) => err);

      await vi.advanceTimersByTimeAsync(1500);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(TokenExchangeError);
      expect((error as TokenExchangeError).name).toBe('TokenExchangeError');
    });
  });
});

// =============================================================================
// RTCAgentClient WebSocket Network Errors
// =============================================================================

describe('RTCAgentClient: WebSocket Network Error Handling', () => {
  let client: RTCAgentClient;
  let mockOptions: RTCAgentClientOptions;
  let mockOnConnectionStateChange: ReturnType<typeof vi.fn>;
  let mockOnTokenExpired: ReturnType<typeof vi.fn>;
  let mockOnAccountBanned: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnConnectionStateChange = vi.fn();
    mockOnTokenExpired = vi.fn().mockResolvedValue('refresh');
    mockOnAccountBanned = vi.fn();

    mockOptions = {
      endpoint: 'wss://test.example.com/connection',
      getToken: () => 'test-token',
      userId: 'test-user-id',
      onConnectionStateChange: mockOnConnectionStateChange,
      onTokenExpired: mockOnTokenExpired,
      onAccountBanned: mockOnAccountBanned,
      getLastOffset: vi
        .fn()
        .mockResolvedValue({ offset: 0, epoch: 'test-epoch' }),
    };

    client = new RTCAgentClient(mockOptions);
  });

  afterEach(() => {
    vi.useRealTimers();
    client.disconnect();
  });

  // Helper to access the Centrifuge instance
  const getCentrifuge = () => {
    // @ts-expect-error - accessing private field for testing
    return client.centrifuge;
  };

  // ---------- Account Banned (code 4501) ----------

  describe('Account Banned (disconnect code 4501)', () => {
    it('should stop reconnecting when account is banned', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        code: 4501,
        reason: 'account banned',
      } as any);

      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(false);
    });

    it('should call onAccountBanned callback when account is banned', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        code: 4501,
        reason: 'violated terms of service',
      } as any);

      expect(mockOnAccountBanned).toHaveBeenCalledWith(
        'violated terms of service',
      );
    });

    it('should set connection state to disconnected when account is banned', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        code: 4501,
        reason: 'account banned',
      } as any);

      expect(client.getConnectionState()).toBe('disconnected');
      expect(mockOnConnectionStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'disconnected',
          reason: expect.stringContaining('4501'),
        }),
      );
    });

    it('should reset wasConnected flag when account is banned', async () => {
      await client.connect();

      // Simulate successful connection first (sets wasConnected = true)
      const centrifuge = getCentrifuge();
      centrifuge?.emit('connected', {} as any);

      // @ts-expect-error - accessing private field for testing
      expect(client.wasConnected).toBe(true);

      centrifuge?.emit('disconnected', {
        code: 4501,
        reason: 'account banned',
      } as any);

      // @ts-expect-error - accessing private field for testing
      expect(client.wasConnected).toBe(false);
    });

    it('should use default ban reason when none provided', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', { code: 4501, reason: '' } as any);

      expect(mockOnAccountBanned).toHaveBeenCalledWith('account banned');
    });

    it('should not call onAccountBanned if callback is not provided', async () => {
      const clientWithoutCallback = new RTCAgentClient({
        ...mockOptions,
        onAccountBanned: undefined,
      });

      await clientWithoutCallback.connect();

      // @ts-expect-error - accessing private field for testing
      const centrifuge = clientWithoutCallback.centrifuge;
      // Should not throw even without callback
      centrifuge?.emit('disconnected', {
        code: 4501,
        reason: 'banned',
      } as any);

      clientWithoutCallback.disconnect();
    });
  });

  // ---------- Invalid Token ----------

  describe('Invalid Token Handling', () => {
    it('should trigger token refresh when server rejects token as invalid', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        code: 0,
        reason: 'invalid token',
      } as any);

      // Flush microtasks so handleInvalidToken() runs
      await flushMicrotasks();

      expect(mockOnTokenExpired).toHaveBeenCalled();
    });

    it('should stop reconnecting when token refresh returns relogin', async () => {
      mockOnTokenExpired.mockResolvedValue('relogin');

      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        code: 0,
        reason: 'invalid token',
      } as any);

      await flushMicrotasks();

      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(false);
    });

    it('should schedule reconnect when token refresh returns refresh', async () => {
      mockOnTokenExpired.mockResolvedValue('refresh');

      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        code: 0,
        reason: 'invalid token',
      } as any);

      // Flush microtasks so handleInvalidToken completes its async work
      await flushMicrotasks();

      // After handleInvalidToken resolves with 'refresh', it sets _reconnectTimer
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectTimer).toBeDefined();
    });

    it('should disconnect old Centrifuge instance when token is invalid', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      const disconnectSpy = vi.spyOn(centrifuge, 'disconnect');

      centrifuge?.emit('disconnected', {
        code: 0,
        reason: 'invalid token',
      } as any);

      expect(disconnectSpy).toHaveBeenCalled();
    });

    it('should handle onTokenExpired throwing an error as relogin required', async () => {
      mockOnTokenExpired.mockRejectedValue(new Error('refresh endpoint down'));

      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        code: 0,
        reason: 'invalid token',
      } as any);

      // Flush microtasks so handleInvalidToken completes
      await flushMicrotasks();

      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(false);
      expect(client.getConnectionState()).toBe('disconnected');
    });

    it('should handle missing onTokenExpired callback gracefully', async () => {
      const clientNoCallback = new RTCAgentClient({
        ...mockOptions,
        onTokenExpired: undefined,
      });

      await clientNoCallback.connect();

      // @ts-expect-error - accessing private field for testing
      const centrifuge = clientNoCallback.centrifuge;
      centrifuge?.emit('disconnected', {
        code: 0,
        reason: 'invalid token',
      } as any);

      // Should not throw, should remain in disconnected state
      expect(clientNoCallback.getConnectionState()).toBe('disconnected');

      clientNoCallback.disconnect();
    });
  });

  // ---------- Message Size Limit Exceeded ----------

  describe('Message Size Limit Exceeded', () => {
    it('should schedule reconnect when message size limit exceeded', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        reason: 'message size limit exceeded',
      } as any);

      // Should schedule reconnect synchronously
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectTimer).toBeDefined();
    });

    it('should use 3 second delay before reconnecting after size limit error', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        reason: 'message size limit exceeded',
      } as any);

      // Advance timer just before the reconnect delay
      await vi.advanceTimersByTimeAsync(2999);

      const callsBefore = mockOnConnectionStateChange.mock.calls.length;

      // Advance past the delay
      await vi.advanceTimersByTimeAsync(2);

      // Should have triggered reconnect (additional state change events)
      expect(mockOnConnectionStateChange.mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });

  // ---------- RPC Errors When Not Connected ----------

  describe('RPC Errors When Not Connected', () => {
    it('should throw when calling RPC methods before connect', async () => {
      await expect(client.listSessions()).rejects.toThrow(
        'RTCAgentClient not connected',
      );
    });

    it('should throw when calling RPC methods after disconnect', async () => {
      await client.connect();
      client.disconnect();

      await expect(
        client.sendMessage({ session_id: 's1', content: 'hi' }),
      ).rejects.toThrow('RTCAgentClient not connected');
    });

    it('should include RPC method name in error when connection state is not connected', async () => {
      await client.connect();
      // Force state to disconnected without nulling centrifuge
      // @ts-expect-error - accessing private field for testing
      client.connectionState = 'disconnected';

      // The rpc() method checks connectionState before calling centrifuge.rpc()
      await expect(client.getSession('session-1')).rejects.toThrow(
        "Cannot call RPC 'v1.session.get': connection state is disconnected",
      );
    });
  });

  // ---------- Connection State Transitions ----------

  describe('Connection State Transitions on Errors', () => {
    it('should emit connection state change on disconnect with reason', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        code: 1000,
        reason: 'connection lost',
      } as any);

      expect(mockOnConnectionStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'disconnected',
          reason: 'connection lost',
        }),
      );
    });

    it('should emit error event on centrifuge error', async () => {
      await client.connect();

      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      const centrifuge = getCentrifuge();
      centrifuge?.emit('error', {
        error: { message: 'WebSocket closed unexpectedly' },
      } as any);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'WebSocket closed unexpectedly',
        }),
      );
    });

    it('should emit generic error message when centrifuge error has no message', async () => {
      await client.connect();

      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      const centrifuge = getCentrifuge();
      centrifuge?.emit('error', {} as any);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'centrifuge error',
        }),
      );
    });
  });

  // ---------- Token Expired (Client-Side Detection) ----------

  describe('Client-Side Token Expiry Detection', () => {
    it('should detect expired JWT', () => {
      // Create an expired JWT (exp = 60 seconds ago)
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const expiredPayload = btoa(
        JSON.stringify({
          sub: 'user-123',
          exp: Math.floor(Date.now() / 1000) - 60,
        }),
      );
      const expiredToken = `${header}.${expiredPayload}.fake-signature`;

      // @ts-expect-error - accessing private method
      const isExpired = client._isTokenExpired(expiredToken);
      expect(isExpired).toBe(true);
    });

    it('should not flag valid JWT as expired', () => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const validPayload = btoa(
        JSON.stringify({
          sub: 'user-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      const validToken = `${header}.${validPayload}.fake-signature`;

      // @ts-expect-error - accessing private method
      expect(client._isTokenExpired(validToken)).toBe(false);
    });

    it('should return true for malformed JWT (treat as expired to trigger refresh)', () => {
      // @ts-expect-error - accessing private method
      expect(client._isTokenExpired('not-a-jwt')).toBe(true);
      // @ts-expect-error - accessing private method
      expect(client._isTokenExpired('a.b')).toBe(true);
      // @ts-expect-error - accessing private method
      expect(client._isTokenExpired('')).toBe(true);
    });

    it('should return true when JWT payload has no exp claim', () => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const noExpPayload = btoa(JSON.stringify({ sub: 'user-123' }));
      const noExpToken = `${header}.${noExpPayload}.fake-sig`;

      // @ts-expect-error - accessing private method
      expect(client._isTokenExpired(noExpToken)).toBe(true);
    });
  });

  // ---------- Reconnect Cleanup ----------

  describe('Reconnect Cleanup on Network Errors', () => {
    it('should clear pending reconnect timer on explicit disconnect', async () => {
      await client.connect();

      // Trigger a reconnect schedule
      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        reason: 'message size limit exceeded',
      } as any);

      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectTimer).toBeDefined();

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectTimer).toBeUndefined();
    });

    it('should not reconnect after explicit disconnect even if timer was pending', async () => {
      await client.connect();

      const centrifuge = getCentrifuge();
      centrifuge?.emit('disconnected', {
        reason: 'message size limit exceeded',
      } as any);

      client.disconnect();

      const reconnectSpy = vi.spyOn(client, 'reconnect');

      // Advance past the reconnect delay
      await vi.advanceTimersByTimeAsync(5000);

      expect(reconnectSpy).not.toHaveBeenCalled();
    });
  });
});
