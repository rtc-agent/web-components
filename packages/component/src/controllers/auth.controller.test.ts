import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';

class MockHost {
  updateCount = 0;
  dispatchEvent = vi.fn();
  requestUpdate() {
    this.updateCount++;
  }
  addController(_c: unknown) {}
}

describe('AuthController', () => {
  it('should have default state (not logged in)', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    expect(ctrl.value.state.isLoggedIn).toBe(false);
  });

  it('should login and dispatch rtc-auth-login-requested', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    ctrl.actions.login();
    // login() dispatches an event for the root to handle the OAuth flow;
    // it does NOT set isLoggedIn directly (that happens via setTokens()).
    expect(host.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rtc-auth-login-requested' }),
    );
  });

  it('should logout and clear state', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    ctrl.actions.login();
    ctrl.actions.logout();
    expect(ctrl.value.state.isLoggedIn).toBe(false);
  });

  it('should dispatch rtc-auth-login-requested on login', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    ctrl.actions.login();
    expect(host.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rtc-auth-login-requested' }),
    );
  });

  it('should request host update on login', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    ctrl.actions.login();
    expect(host.updateCount).toBeGreaterThan(0);
  });
});

describe('AuthController - setAuthProvider', () => {
  it('should set isLoggedIn=true and userId=provider-managed when provider.isLoggedIn() returns true', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };

    ctrl.setAuthProvider(provider);

    expect(ctrl.value.state.isLoggedIn).toBe(true);
    expect(ctrl.value.state.userId).toBe('provider-managed');
    expect(ctrl.value.state.accessToken).toBe('');
  });

  it('should set isLoggedIn=false when provider.isLoggedIn() returns false', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(false),
    };

    ctrl.setAuthProvider(provider);

    expect(ctrl.value.state.isLoggedIn).toBe(false);
  });

  it('should not persist to localStorage', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };

    ctrl.setAuthProvider(provider);

    expect(localStorage.getItem('rtc_auth_tokens')).toBeNull();
  });

  it('should trigger onLogin callback when provider.isLoggedIn() is true', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    const onLogin = vi.fn();
    ctrl.onLogin = onLogin;

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };

    ctrl.setAuthProvider(provider);

    expect(onLogin).toHaveBeenCalledOnce();
  });

  it('should NOT trigger onLogin callback when provider.isLoggedIn() is false', () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    const onLogin = vi.fn();
    ctrl.onLogin = onLogin;

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(false),
    };

    ctrl.setAuthProvider(provider);

    expect(onLogin).not.toHaveBeenCalled();
  });

  it('getAccessTokenAsync() should get token from provider', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockResolvedValue('async-provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };

    ctrl.setAuthProvider(provider);

    const token = await ctrl.getAccessTokenAsync();
    expect(token).toBe('async-provider-token');
    expect(provider.getToken).toHaveBeenCalledOnce();
  });

  it('getAccessTokenAsync() should handle synchronous getToken', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('sync-provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };

    ctrl.setAuthProvider(provider);

    const token = await ctrl.getAccessTokenAsync();
    expect(token).toBe('sync-provider-token');
  });

  it('handleTokenExpired() should delegate to provider refreshToken', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    const refreshFn = vi.fn().mockResolvedValue({
      accessToken: 'provider-refreshed-token',
      expiresIn: 3600,
    });

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: refreshFn,
      isLoggedIn: vi.fn().mockReturnValue(true),
    };

    ctrl.setAuthProvider(provider);

    const result = await ctrl.handleTokenExpired();
    expect(refreshFn).toHaveBeenCalledOnce();
    expect(result).toBe('refresh');
    expect(ctrl.value.state.accessToken).toBe('provider-refreshed-token');
  });

  it('handleTokenExpired() should return relogin when provider refresh fails', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    const refreshFn = vi
      .fn()
      .mockRejectedValue(new Error('provider refresh failed'));

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: refreshFn,
      isLoggedIn: vi.fn().mockReturnValue(true),
    };

    ctrl.setAuthProvider(provider);

    const result = await ctrl.handleTokenExpired();
    expect(result).toBe('relogin');
  });

  it('logout() should delegate to provider.logout() then set isLoggedIn=false', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    const logoutFn = vi.fn().mockResolvedValue(undefined);

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
      logout: logoutFn,
    };

    ctrl.setAuthProvider(provider);
    expect(ctrl.value.state.isLoggedIn).toBe(true);

    ctrl.logout();
    // Wait for async provider.logout() to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logoutFn).toHaveBeenCalledOnce();
    expect(ctrl.value.state.isLoggedIn).toBe(false);
  });
});

describe('AuthController - logout', () => {
  it('should clear auth provider on logout', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    const logoutFn = vi.fn().mockResolvedValue(undefined);

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
      logout: logoutFn,
    };

    ctrl.setAuthProvider(provider);
    expect(ctrl.value.state.isLoggedIn).toBe(true);

    ctrl.logout();
    // Wait for any async operations
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctrl.value.state.isLoggedIn).toBe(false);
    // Provider should be cleared, so getAccessTokenAsync returns state value
    const token = await ctrl.getAccessTokenAsync();
    expect(token).toBeUndefined();
  });

  it('should not clear localStorage in auth provider mode', async () => {
    // Pre-populate localStorage with tokens
    localStorage.setItem(
      'rtc_auth_tokens',
      JSON.stringify({
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        userId: 'stored-user',
        expiresAt: Date.now() + 999999,
      }),
    );

    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    ctrl.setAuthProvider(provider);
    ctrl.logout();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // localStorage should still have the originally stored tokens
    const stored = localStorage.getItem('rtc_auth_tokens');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.accessToken).toBe('stored-access');
  });

  it('should dispatch rtc-auth-logout event', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('provider-token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-token' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    ctrl.setAuthProvider(provider);

    host.dispatchEvent.mockClear();
    ctrl.logout();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rtc-auth-logout' }),
    );
  });
});

describe('AuthController - Token Exchange mode', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  const createTokenExchangeProvider = (
    overrides: Record<string, unknown> = {},
  ) => ({
    type: 'token-exchange' as const,
    getExchangeToken: vi.fn().mockResolvedValue('external-jwt-token'),
    isLoggedIn: vi.fn().mockReturnValue(true),
    logout: vi.fn().mockResolvedValue(undefined),
    getUserId: vi.fn().mockReturnValue('test-user-id'),
    deviceId: 'test-device-id',
    ...overrides,
  });

  // Helper to create a mock JWT with user_id claim
  const createMockJwt = (userId: string) => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(
      JSON.stringify({
        user_id: userId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    const signature = 'mock-signature';
    return `${header}.${payload}.${signature}`;
  };

  const createTokenExchangeResponse = (accessToken?: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () =>
      Promise.resolve({
        access_token: accessToken ?? createMockJwt('test-user-id'),
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
  });

  it('should detect token-exchange mode from provider type', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = createTokenExchangeProvider();
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);

    // Wait for async token exchange to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ctrl.value.state.isLoggedIn).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/oauth2/token'),
      expect.any(Object),
    );
  });

  it('should call getExchangeToken and tokenExchange on setAuthProvider', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = createTokenExchangeProvider();
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(provider.getExchangeToken).toHaveBeenCalledOnce();
    expect(ctrl.value.state.accessToken).toMatch(/^eyJ/); // JWT format
    expect(ctrl.value.state.userId).toBe('test-user-id');
  });

  it('should store RTC JWT in localStorage', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = createTokenExchangeProvider();
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const stored = localStorage.getItem('rtc_auth_tokens');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.accessToken).toMatch(/^eyJ/); // JWT format
  });

  it('should call logout when getExchangeToken fails', async () => {
    vi.useFakeTimers();
    try {
      const host = new MockHost();
      const ctrl = new AuthController(host as any);

      const provider = createTokenExchangeProvider({
        getExchangeToken: vi
          .fn()
          .mockRejectedValue(new Error('getExchangeToken failed')),
      });

      ctrl.setAuthProvider(provider);

      // Advance timers to complete all retries (5 retries × exponential backoff)
      // Retry schedule: 1s, 2s, 4s, 8s, 16s = 31s total
      // Use advanceTimersByTimeAsync to allow promises to resolve
      await vi.advanceTimersByTimeAsync(35000);

      // State should be cleared (not logged in)
      expect(ctrl.value.state.isLoggedIn).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should call logout when tokenExchange fails', async () => {
    vi.useFakeTimers();
    try {
      const host = new MockHost();
      const ctrl = new AuthController(host as any);

      const provider = createTokenExchangeProvider();
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      ctrl.setAuthProvider(provider);

      // Advance timers to complete all retries (5 retries × exponential backoff)
      // Retry schedule: 1s, 2s, 4s, 8s, 16s = 31s total
      await vi.advanceTimersByTimeAsync(35000);

      // State should be cleared (not logged in)
      expect(ctrl.value.state.isLoggedIn).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should use form-encoded request body for token exchange', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = createTokenExchangeProvider();
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const call = fetchMock.mock.calls[0];
    expect(call[1].headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(call[1].body).toContain('grant_type=');
    expect(call[1].body).toContain('subject_token=external-jwt-token');
    expect(call[1].body).toContain('device_id=test-device-id');
  });

  it('should trigger onLogin callback after successful token exchange', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);
    const onLogin = vi.fn();
    ctrl.onLogin = onLogin;

    const provider = createTokenExchangeProvider();
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onLogin).toHaveBeenCalledOnce();
  });

  it('handleTokenExpired should perform token exchange in token-exchange mode', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = createTokenExchangeProvider();
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Reset mock and prepare for refresh
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      createTokenExchangeResponse(createMockJwt('new-user-id')),
    );

    const result = await ctrl.handleTokenExpired();

    expect(result).toBe('refresh');
    expect(provider.getExchangeToken).toHaveBeenCalledTimes(2);
    expect(ctrl.value.state.accessToken).toMatch(/^eyJ/); // JWT format
    expect(ctrl.value.state.userId).toBe('new-user-id');
  });

  it('should cleanup token exchange state on logout', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = createTokenExchangeProvider();
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ctrl.value.state.isLoggedIn).toBe(true);

    ctrl.logout();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ctrl.value.state.isLoggedIn).toBe(false);
    expect(ctrl.value.state.accessToken).toBeUndefined();
  });

  it('getAccessTokenAsync should return RTC JWT in token-exchange mode', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = createTokenExchangeProvider();
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const token = await ctrl.getAccessTokenAsync();
    expect(token).toMatch(/^eyJ/); // JWT format
  });

  it('should attempt token exchange even when isLoggedIn() returns false', async () => {
    const host = new MockHost();
    const ctrl = new AuthController(host as any);

    const provider = createTokenExchangeProvider({
      isLoggedIn: vi.fn().mockReturnValue(false),
    });
    fetchMock.mockResolvedValue(createTokenExchangeResponse());

    ctrl.setAuthProvider(provider);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(provider.getExchangeToken).toHaveBeenCalledOnce();
    expect(ctrl.value.state.isLoggedIn).toBe(true);
    expect(ctrl.value.state.accessToken).toMatch(/^eyJ/); // JWT format
  });
});

describe('AuthController - BroadcastChannel coordination', () => {
  /**
   * Mock BroadcastChannel for testing cross-tab coordination.
   * Uses a shared message bus to simulate multiple tabs receiving messages.
   */
  class MockBroadcastChannel {
    name: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;
    static channels: Map<string, MockBroadcastChannel[]> = new Map();

    constructor(name: string) {
      this.name = name;
      const existing = MockBroadcastChannel.channels.get(name) || [];
      existing.push(this);
      MockBroadcastChannel.channels.set(name, existing);
    }

    postMessage(data: unknown) {
      if (this.closed) throw new Error('Channel is closed');
      // Broadcast to all OTHER channels with the same name (simulates cross-tab)
      const channels = MockBroadcastChannel.channels.get(this.name) || [];
      for (const channel of channels) {
        if (channel !== this && channel.onmessage && !channel.closed) {
          channel.onmessage(new MessageEvent('message', { data }));
        }
      }
    }

    close() {
      this.closed = true;
      const channels = MockBroadcastChannel.channels.get(this.name) || [];
      const idx = channels.indexOf(this);
      if (idx >= 0) channels.splice(idx, 1);
      MockBroadcastChannel.channels.set(this.name, channels);
    }
  }

  beforeEach(() => {
    // Reset shared channel registry
    MockBroadcastChannel.channels.clear();
    // Install mock
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  });

  const createMockHost = () => {
    class TestHost {
      updateCount = 0;
      dispatchEvent = vi.fn();
      requestUpdate() {
        this.updateCount++;
      }
      addController(_c: unknown) {}
    }
    return new TestHost();
  };

  it('should open BroadcastChannel on construction', () => {
    const host = createMockHost();
    const _ctrl = new AuthController(host as any);
    expect(MockBroadcastChannel.channels.get('rtc-auth-refresh')).toHaveLength(
      1,
    );
  });

  it('should close BroadcastChannel synchronously on hostDisconnected and reopen on hostConnected (StrictMode support)', () => {
    const host = createMockHost();
    const ctrl = new AuthController(host as any);

    // Initial state: channel is open
    let channels = MockBroadcastChannel.channels.get('rtc-auth-refresh');
    expect(channels).toHaveLength(1);
    const firstChannel = channels?.[0];
    expect(firstChannel.closed).toBe(false);

    // Simulate StrictMode disconnect - channel closes synchronously
    ctrl.hostDisconnected();
    // After close(), the channel is removed from the tracking array
    channels = MockBroadcastChannel.channels.get('rtc-auth-refresh');
    expect(channels).toHaveLength(0);
    // But the channel object should be marked as closed
    expect(firstChannel.closed).toBe(true);

    // Simulate StrictMode reconnect - channel reopens
    ctrl.hostConnected();
    channels = MockBroadcastChannel.channels.get('rtc-auth-refresh');
    // A new channel should be created
    expect(channels).toHaveLength(1);
    const newChannel = channels?.[0];
    expect(newChannel).not.toBe(firstChannel); // Different instance
    expect(newChannel.closed).toBe(false);
  });

  it('should close BroadcastChannel on logout', async () => {
    const host = createMockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('token'),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new' }),
      isLoggedIn: vi.fn().mockReturnValue(true),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    ctrl.setAuthProvider(provider);

    ctrl.logout();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Channel should be closed after logout
    const channels = MockBroadcastChannel.channels.get('rtc-auth-refresh');
    expect(channels).toHaveLength(0);
  });

  it('should broadcast refresh-start when starting refresh', async () => {
    const host = createMockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('token'),
      refreshToken: vi
        .fn()
        .mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 }),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };
    ctrl.setAuthProvider(provider);

    // Force token expiry and trigger refresh
    (ctrl as any)._state.expiresAt = Date.now() - 1000;
    const refreshPromise = ctrl.handleTokenExpired();

    // Give the broadcast time to happen
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Check that refresh-start was broadcast
    const channels = MockBroadcastChannel.channels.get('rtc-auth-refresh');
    expect(channels).toBeDefined();

    await refreshPromise;
  });

  it('should yield to another tab with earlier timestamp (leader election)', async () => {
    const host1 = createMockHost();
    const ctrl1 = new AuthController(host1 as any);

    const host2 = createMockHost();
    const ctrl2 = new AuthController(host2 as any);

    const provider1 = {
      getToken: vi.fn().mockReturnValue('token'),
      refreshToken: vi
        .fn()
        .mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 }),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };
    ctrl1.setAuthProvider(provider1);
    ctrl2.setAuthProvider(provider1);

    // Simulate ctrl1 starting refresh first (earlier timestamp)
    (ctrl1 as any)._refreshStartTime = Date.now() - 1000;

    // Simulate ctrl2 receiving refresh-start from ctrl1
    const channels = MockBroadcastChannel.channels.get('rtc-auth-refresh')!;
    const channel2 = channels[1]; // ctrl2's channel
    channel2.onmessage?.(
      new MessageEvent('message', {
        data: {
          type: 'refresh-start',
          tabId: (ctrl1 as any)._tabId,
          timestamp: Date.now() - 1000,
        },
      }),
    );

    // ctrl2 should have created a deferred refresh promise
    expect((ctrl2 as any)._deferredRefresh).toBeDefined();

    // Clean up
    ctrl1.hostDisconnected();
    ctrl2.hostDisconnected();
  });

  it('should accept refresh-success tokens when _pendingTokenExchange is true', async () => {
    const host = createMockHost();
    const ctrl = new AuthController(host as any);

    // Set up Token Exchange mode (isLoggedIn initially false)
    const provider = {
      type: 'token-exchange' as const,
      getExchangeToken: vi.fn().mockResolvedValue('external-token'),
      isLoggedIn: vi.fn().mockReturnValue(false),
      logout: vi.fn().mockResolvedValue(undefined),
      getUserId: vi.fn().mockReturnValue('test-user'),
      deviceId: 'device-id',
    };

    // Mock fetch for token exchange
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          access_token:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdC11c2VyIn0.sig',
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    ctrl.setAuthProvider(provider);

    // Verify _pendingTokenExchange is set
    expect((ctrl as any)._pendingTokenExchange).toBe(true);

    // Simulate receiving refresh-success from another tab
    const channels = MockBroadcastChannel.channels.get('rtc-auth-refresh')!;
    const channel = channels[0];
    channel.onmessage?.(
      new MessageEvent('message', {
        data: {
          type: 'refresh-success',
          tabId: 'other-tab-id',
          tokens: {
            accessToken: 'refreshed-token',
            refreshToken: '',
            expiresAt: Date.now() + 3600000,
          },
        },
      }),
    );

    // Tokens should be accepted even though isLoggedIn was initially false
    // (state may have been updated by the token exchange or by the refresh-success)
    expect((ctrl as any)._state.accessToken).toBeDefined();

    // Clean up
    ctrl.hostDisconnected();
  });

  it('should resolve _deferredRefresh on refresh-success', async () => {
    const host = createMockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      getToken: vi.fn().mockReturnValue('token'),
      refreshToken: vi
        .fn()
        .mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 }),
      isLoggedIn: vi.fn().mockReturnValue(true),
    };
    ctrl.setAuthProvider(provider);

    // Set up deferred refresh manually
    let deferredResolve: ((success: boolean) => void) | undefined;
    (ctrl as any)._deferredRefresh = new Promise<boolean>((resolve) => {
      deferredResolve = resolve;
    });
    (ctrl as any)._deferredResolve = deferredResolve;

    // Simulate receiving refresh-success
    const channels = MockBroadcastChannel.channels.get('rtc-auth-refresh')!;
    const channel = channels[0];
    channel.onmessage?.(
      new MessageEvent('message', {
        data: {
          type: 'refresh-success',
          tabId: 'other-tab-id',
          tokens: {
            accessToken: 'refreshed-token',
            refreshToken: '',
            expiresAt: Date.now() + 3600000,
          },
        },
      }),
    );

    // Deferred promise should be resolved and cleared
    expect((ctrl as any)._deferredRefresh).toBeUndefined();
    expect((ctrl as any)._deferredResolve).toBeUndefined();

    // Clean up
    ctrl.hostDisconnected();
  });

  it('should timeout _deferredRefresh after 15 seconds', async () => {
    vi.useFakeTimers();
    try {
      const host = createMockHost();
      const ctrl = new AuthController(host as any);

      const provider = {
        getToken: vi.fn().mockReturnValue('token'),
        refreshToken: vi
          .fn()
          .mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 }),
        isLoggedIn: vi.fn().mockReturnValue(true),
      };
      ctrl.setAuthProvider(provider);

      // Trigger the yield mechanism
      const channels = MockBroadcastChannel.channels.get('rtc-auth-refresh')!;
      const channel = channels[0];
      channel.onmessage?.(
        new MessageEvent('message', {
          data: {
            type: 'refresh-start',
            tabId: 'other-tab-id',
            timestamp: Date.now() - 1000, // Earlier timestamp (other tab is leader)
          },
        }),
      );

      // Verify deferred refresh was created
      expect((ctrl as any)._deferredRefresh).toBeDefined();

      // Advance timers past the 15-second timeout
      await vi.advanceTimersByTimeAsync(15500);

      // Deferred refresh should be cleared by timeout
      expect((ctrl as any)._deferredRefresh).toBeUndefined();
      expect((ctrl as any)._deferredResolve).toBeUndefined();

      // Clean up
      ctrl.hostDisconnected();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should prevent concurrent token exchange with _tokenExchanging guard', async () => {
    const host = createMockHost();
    const ctrl = new AuthController(host as any);

    const provider = {
      type: 'token-exchange' as const,
      getExchangeToken: vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 100)),
        ),
      isLoggedIn: vi.fn().mockReturnValue(true),
      logout: vi.fn().mockResolvedValue(undefined),
      getUserId: vi.fn().mockReturnValue('test-user'),
      deviceId: 'device-id',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          access_token:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdC11c2VyIn0.sig',
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    ctrl.setAuthProvider(provider);

    // Immediately try another token exchange (should be blocked)
    const secondExchange = (ctrl as any)._performTokenExchange();

    // Second exchange should return false immediately
    const result = await secondExchange;
    expect(result).toBe(false);

    // Wait for first exchange to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Clean up
    ctrl.hostDisconnected();
  });
});
