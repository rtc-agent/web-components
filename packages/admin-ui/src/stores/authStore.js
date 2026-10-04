/**
 * Authentication state management using Zustand
 *
 * Manages user authentication state, tokens, and provides login/logout/refresh methods.
 * Tokens are persisted in localStorage for session persistence across page reloads.
 */
import { create } from 'zustand';
import { authApi } from '@/services/api';
// ========== Storage Keys ==========
const STORAGE_KEYS = {
    accessToken: 'accessToken',
    refreshToken: 'refreshToken',
    user: 'user',
};
// ========== Store ==========
export const useAuthStore = create((set, get) => ({
    // Initial state
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    // Actions
    login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
            const response = await authApi.login(email, password);
            const { access_token, refresh_token, user } = response;
            // Persist to localStorage
            localStorage.setItem(STORAGE_KEYS.accessToken, access_token);
            localStorage.setItem(STORAGE_KEYS.refreshToken, refresh_token);
            localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
            set({
                user,
                accessToken: access_token,
                refreshToken: refresh_token,
                isAuthenticated: true,
                isLoading: false,
                error: null,
            });
        }
        catch (err) {
            const message = err instanceof Error
                ? err.message
                : 'Login failed. Please check your email and password.';
            set({ isLoading: false, error: message });
            throw err;
        }
    },
    logout: async () => {
        const { refreshToken: token } = get();
        try {
            if (token) {
                await authApi.logout(token);
            }
        }
        catch {
            // Ignore logout API errors - clear local state regardless
        }
        finally {
            get().clearAuth();
        }
    },
    refreshAccessToken: async () => {
        const { refreshToken: token } = get();
        if (!token) {
            get().clearAuth();
            return;
        }
        try {
            const response = await authApi.refreshToken(token);
            const { access_token, refresh_token: newRefreshToken } = response;
            // Update localStorage
            localStorage.setItem(STORAGE_KEYS.accessToken, access_token);
            if (newRefreshToken) {
                localStorage.setItem(STORAGE_KEYS.refreshToken, newRefreshToken);
            }
            set({
                accessToken: access_token,
                refreshToken: newRefreshToken ?? token,
                isAuthenticated: true,
            });
        }
        catch {
            // Refresh failed - user must re-login
            get().clearAuth();
        }
    },
    initialize: async () => {
        const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
        const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
        const userJson = localStorage.getItem(STORAGE_KEYS.user);
        if (!accessToken || !refreshToken || !userJson) {
            get().clearAuth();
            return;
        }
        try {
            const user = JSON.parse(userJson);
            set({
                user,
                accessToken,
                refreshToken,
                isAuthenticated: true,
                isLoading: false,
                error: null,
            });
            // Verify the token is still valid by fetching user info
            try {
                const me = await authApi.getMe();
                set({ user: me });
                localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(me));
            }
            catch {
                // Token invalid - try to refresh
                await get().refreshAccessToken();
            }
        }
        catch {
            get().clearAuth();
        }
    },
    clearAuth: () => {
        localStorage.removeItem(STORAGE_KEYS.accessToken);
        localStorage.removeItem(STORAGE_KEYS.refreshToken);
        localStorage.removeItem(STORAGE_KEYS.user);
        set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
        });
    },
    setAuth: (accessToken, refreshToken, user) => {
        localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
        localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
        set({
            user,
            accessToken,
            refreshToken,
            isAuthenticated: true,
            isLoading: false,
            error: null,
        });
    },
}));
//# sourceMappingURL=authStore.js.map