import {describe, it, expect, vi} from 'vitest';
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

describe('AuthController - setExternalTokens (Mode 1)', () => {
    it('should set tokens without persisting to localStorage', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        ctrl.setExternalTokens({
            accessToken: 'ext-access-token',
            refreshToken: 'ext-refresh-token',
            userId: 'ext-user-123',
            expiresIn: 3600,
        });

        expect(ctrl.value.state.isLoggedIn).toBe(true);
        expect(ctrl.value.state.accessToken).toBe('ext-access-token');
        expect(ctrl.value.state.refreshToken).toBe('ext-refresh-token');
        expect(ctrl.value.state.userId).toBe('ext-user-123');
        // Tokens should NOT be persisted to localStorage
        expect(localStorage.getItem('rtc_auth_tokens')).toBeNull();
    });

    it('should trigger onLogin callback', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        const onLogin = vi.fn();
        ctrl.onLogin = onLogin;

        ctrl.setExternalTokens({
            accessToken: 'ext-access-token',
            refreshToken: 'ext-refresh-token',
            userId: 'ext-user-123',
            expiresIn: 3600,
        });

        expect(onLogin).toHaveBeenCalledOnce();
    });

    it('should request host update', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        ctrl.setExternalTokens({
            accessToken: 'ext-access-token',
            refreshToken: 'ext-refresh-token',
            userId: 'ext-user-123',
            expiresIn: 3600,
        });

        expect(host.updateCount).toBeGreaterThan(0);
    });
});

describe('AuthController - setDynamicTokenProvider (Mode 2)', () => {
    it('should set state with isLoggedIn=true, correct userId, and empty accessToken', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        ctrl.setDynamicTokenProvider({
            getToken: () => 'dynamic-token',
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
            userId: 'dynamic-user-456',
        });

        expect(ctrl.value.state.isLoggedIn).toBe(true);
        expect(ctrl.value.state.userId).toBe('dynamic-user-456');
        expect(ctrl.value.state.accessToken).toBe('');
    });

    it('should not persist to localStorage', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        ctrl.setDynamicTokenProvider({
            getToken: () => 'dynamic-token',
            userId: 'dynamic-user-456',
        });

        expect(localStorage.getItem('rtc_auth_tokens')).toBeNull();
    });

    it('should trigger onLogin callback', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        const onLogin = vi.fn();
        ctrl.onLogin = onLogin;

        ctrl.setDynamicTokenProvider({
            getToken: () => 'dynamic-token',
            userId: 'dynamic-user-456',
        });

        expect(onLogin).toHaveBeenCalledOnce();
    });

    it('getAccessTokenAsync() should retrieve token from provider', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        ctrl.setDynamicTokenProvider({
            getToken: () => Promise.resolve('async-dynamic-token'),
            userId: 'dynamic-user-456',
        });

        const token = await ctrl.getAccessTokenAsync();
        expect(token).toBe('async-dynamic-token');
    });

    it('getAccessTokenAsync() should handle synchronous getToken', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        ctrl.setDynamicTokenProvider({
            getToken: () => 'sync-token',
            userId: 'dynamic-user-456',
        });

        const token = await ctrl.getAccessTokenAsync();
        expect(token).toBe('sync-token');
    });

    it('handleTokenExpired() should delegate to provider refreshToken', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        const refreshFn = vi.fn().mockResolvedValue({
            accessToken: 'refreshed-token',
            refreshToken: 'new-refresh',
            expiresIn: 7200,
        });

        ctrl.setDynamicTokenProvider({
            getToken: () => 'dynamic-token',
            refreshToken: refreshFn,
            userId: 'dynamic-user-456',
        });

        const result = await ctrl.handleTokenExpired();
        expect(refreshFn).toHaveBeenCalledOnce();
        expect(result).toBe('refresh');
        expect(ctrl.value.state.accessToken).toBe('refreshed-token');
    });

    it('handleTokenExpired() should return relogin when refresh fails', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        const refreshFn = vi.fn().mockRejectedValue(new Error('refresh failed'));

        ctrl.setDynamicTokenProvider({
            getToken: () => 'dynamic-token',
            refreshToken: refreshFn,
            userId: 'dynamic-user-456',
        });

        const result = await ctrl.handleTokenExpired();
        expect(result).toBe('relogin');
    });
});

describe('AuthController - setAuthProvider (Mode 3)', () => {
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
    it('should clear dynamic token provider on logout', async () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        ctrl.setDynamicTokenProvider({
            getToken: () => 'dynamic-token',
            refreshToken: vi.fn().mockResolvedValue({accessToken: 'new-token'}),
            userId: 'dynamic-user-456',
        });

        expect(ctrl.value.state.isLoggedIn).toBe(true);

        ctrl.logout();
        // Wait for any async operations
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(ctrl.value.state.isLoggedIn).toBe(false);
        // After logout, getAccessTokenAsync should fall through to state.accessToken (which is cleared)
        const token = await ctrl.getAccessTokenAsync();
        expect(token).toBeUndefined();
    });

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
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(ctrl.value.state.isLoggedIn).toBe(false);
        // Provider should be cleared, so getAccessTokenAsync returns state value
        const token = await ctrl.getAccessTokenAsync();
        expect(token).toBeUndefined();
    });

    it('should not clear localStorage in external token mode (setExternalTokens)', () => {
        // Pre-populate localStorage with tokens
        localStorage.setItem('rtc_auth_tokens', JSON.stringify({
            accessToken: 'stored-access',
            refreshToken: 'stored-refresh',
            userId: 'stored-user',
            expiresAt: Date.now() + 999999,
        }));

        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        // Use setExternalTokens (mode 1)
        ctrl.setExternalTokens({
            accessToken: 'ext-access-token',
            refreshToken: 'ext-refresh-token',
            userId: 'ext-user',
            expiresIn: 3600,
        });

        // Now logout
        ctrl.logout();

        // localStorage should still have the originally stored tokens
        const stored = localStorage.getItem('rtc_auth_tokens');
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed.accessToken).toBe('stored-access');
    });

    it('should not clear localStorage in dynamic token provider mode', () => {
        // Pre-populate localStorage with tokens
        localStorage.setItem('rtc_auth_tokens', JSON.stringify({
            accessToken: 'stored-access',
            refreshToken: 'stored-refresh',
            userId: 'stored-user',
            expiresAt: Date.now() + 999999,
        }));

        const host = new MockHost();
        const ctrl = new AuthController(host as any);

        ctrl.setDynamicTokenProvider({
            getToken: () => 'dynamic-token',
            userId: 'dynamic-user',
        });

        ctrl.logout();

        // localStorage should still have the originally stored tokens
        const stored = localStorage.getItem('rtc_auth_tokens');
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed.accessToken).toBe('stored-access');
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

        ctrl.setExternalTokens({
            accessToken: 'ext-access-token',
            refreshToken: 'ext-refresh-token',
            userId: 'ext-user',
            expiresIn: 3600,
        });

        host.dispatchEvent.mockClear();
        ctrl.logout();

        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-auth-logout'})
        );
    });
});
