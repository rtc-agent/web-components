import {describe, it, expect, vi, beforeEach} from 'vitest';
import {AuthController} from './auth.controller.js';

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
            expect.objectContaining({type: 'rtc-auth-login-requested'})
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
            expect.objectContaining({type: 'rtc-auth-login-requested'})
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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
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
        const refreshFn = vi.fn().mockRejectedValue(new Error('provider refresh failed'));

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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
            isLoggedIn: vi.fn().mockReturnValue(true),
            logout: logoutFn,
        };

        ctrl.setAuthProvider(provider);
        expect(ctrl.value.state.isLoggedIn).toBe(true);

        ctrl.logout();
        // Wait for async provider.logout() to resolve
        await new Promise(resolve => setTimeout(resolve, 0));

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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
            isLoggedIn: vi.fn().mockReturnValue(true),
            logout: logoutFn,
        };

        ctrl.setAuthProvider(provider);
        expect(ctrl.value.state.isLoggedIn).toBe(true);

        ctrl.logout();
        // Wait for any async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(ctrl.value.state.isLoggedIn).toBe(false);
        // Provider should be cleared, so getAccessTokenAsync returns state value
        const token = await ctrl.getAccessTokenAsync();
        expect(token).toBeUndefined();
    });

    it('should not clear localStorage in auth provider mode', async () => {
        // Pre-populate localStorage with tokens
        localStorage.setItem('rtc_auth_tokens', JSON.stringify({
            accessToken: 'stored-access',
            refreshToken: 'stored-refresh',
            userId: 'stored-user',
            expiresAt: Date.now() + 999999,
        }));

        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        const provider = {
            getToken: vi.fn().mockReturnValue('provider-token'),
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
            isLoggedIn: vi.fn().mockReturnValue(true),
            logout: vi.fn().mockResolvedValue(undefined),
        };

        ctrl.setAuthProvider(provider);
        ctrl.logout();
        await new Promise(resolve => setTimeout(resolve, 0));

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
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
            isLoggedIn: vi.fn().mockReturnValue(true),
            logout: vi.fn().mockResolvedValue(undefined),
        };

        ctrl.setAuthProvider(provider);

        host.dispatchEvent.mockClear();
        ctrl.logout();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-auth-logout'})
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

    const createTokenExchangeProvider = (overrides: Record<string, unknown> = {}) => ({
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
        const payload = btoa(JSON.stringify({ user_id: userId, exp: Math.floor(Date.now() / 1000) + 3600 }));
        const signature = 'mock-signature';
        return `${header}.${payload}.${signature}`;
    };

    const createTokenExchangeResponse = (accessToken?: string) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({
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
        await new Promise(resolve => setTimeout(resolve, 10));

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
        await new Promise(resolve => setTimeout(resolve, 10));

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
        await new Promise(resolve => setTimeout(resolve, 10));

        const stored = localStorage.getItem('rtc_auth_tokens');
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed.accessToken).toMatch(/^eyJ/); // JWT format
    });

    it('should call logout when getExchangeToken fails', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        const provider = createTokenExchangeProvider({
            getExchangeToken: vi.fn().mockRejectedValue(new Error('getExchangeToken failed')),
        });

        ctrl.setAuthProvider(provider);
        await new Promise(resolve => setTimeout(resolve, 10));

        // State should be cleared (not logged in)
        expect(ctrl.value.state.isLoggedIn).toBe(false);
    });

    it('should call logout when tokenExchange fails', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        const provider = createTokenExchangeProvider();
        fetchMock.mockResolvedValue({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
        });

        ctrl.setAuthProvider(provider);
        await new Promise(resolve => setTimeout(resolve, 10));

        // State should be cleared (not logged in)
        expect(ctrl.value.state.isLoggedIn).toBe(false);
    });

    it('should use form-encoded request body for token exchange', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        const provider = createTokenExchangeProvider();
        fetchMock.mockResolvedValue(createTokenExchangeResponse());

        ctrl.setAuthProvider(provider);
        await new Promise(resolve => setTimeout(resolve, 10));

        const call = fetchMock.mock.calls[0];
        expect(call[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
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
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(onLogin).toHaveBeenCalledOnce();
    });

    it('handleTokenExpired should perform token exchange in token-exchange mode', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        const provider = createTokenExchangeProvider();
        fetchMock.mockResolvedValue(createTokenExchangeResponse());

        ctrl.setAuthProvider(provider);
        await new Promise(resolve => setTimeout(resolve, 10));

        // Reset mock and prepare for refresh
        fetchMock.mockClear();
        fetchMock.mockResolvedValue(createTokenExchangeResponse(createMockJwt('new-user-id')));

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
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(ctrl.value.state.isLoggedIn).toBe(true);

        ctrl.logout();
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(ctrl.value.state.isLoggedIn).toBe(false);
        expect(ctrl.value.state.accessToken).toBeUndefined();
    });

    it('getAccessTokenAsync should return RTC JWT in token-exchange mode', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        const provider = createTokenExchangeProvider();
        fetchMock.mockResolvedValue(createTokenExchangeResponse());

        ctrl.setAuthProvider(provider);
        await new Promise(resolve => setTimeout(resolve, 10));

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
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(provider.getExchangeToken).toHaveBeenCalledOnce();
        expect(ctrl.value.state.isLoggedIn).toBe(true);
        expect(ctrl.value.state.accessToken).toMatch(/^eyJ/); // JWT format
    });
});
