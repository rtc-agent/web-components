/**
 * Authentication state management using Zustand
 *
 * Manages user authentication state, tokens, and provides login/logout/refresh methods.
 *
 * Security model:
 *   - access token: held in memory only (zustand store).  Never written to
 *     localStorage so that XSS cannot exfiltrate it.
 *   - refresh token + user profile: persisted in localStorage to survive page
 *     reloads.  On startup we use the refresh token to silently obtain a fresh
 *     access token.
 */

import { create } from 'zustand';
import { authApi, STORAGE_KEYS } from '@/services/api';
import type { UserResponse } from '@/services/api';

// ========== State Types ==========

interface AuthState {
  /** Current authenticated user */
  user: UserResponse | null;
  /** JWT access token for API calls (memory-only, never persisted) */
  accessToken: string | null;
  /** JWT refresh token for token renewal (persisted in localStorage) */
  refreshToken: string | null;
  /** Whether the user is currently authenticated */
  isAuthenticated: boolean;
  /** Whether an auth operation is in progress */
  isLoading: boolean;
  /** Last authentication error message */
  error: string | null;
}

interface AuthActions {
  /**
   * Login with email and password.
   * On success, stores tokens and user info in state.
   * Only the refresh token is persisted; the access token stays in memory.
   */
  login(email: string, password: string): Promise<void>;

  /**
   * Logout the current user.
   * Revokes the refresh token and clears all auth state.
   */
  logout(): Promise<void>;

  /**
   * Refresh the access token using the stored refresh token.
   * Updates the access token in memory and optionally rotates the refresh token.
   */
  refreshAccessToken(): Promise<void>;

  /**
   * Initialize auth state from localStorage (called on app startup).
   * Uses the persisted refresh token to silently obtain a new access token.
   */
  initialize(): Promise<void>;

  /**
   * Clear all auth state (used on error/logout).
   */
  clearAuth(): void;

  /**
   * Set auth state directly (used after successful login).
   */
  setAuth(
    accessToken: string,
    refreshToken: string,
    user: UserResponse,
  ): void;
}

type AuthStore = AuthState & AuthActions;

// ========== Store ==========

export const useAuthStore = create<AuthStore>((set, get) => ({
  // Initial state
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  // Actions
  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.login(email, password);
      const { access_token, refresh_token, user } = response;

      // Persist only the refresh token and user profile.
      // The access token stays in memory to mitigate XSS theft.
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
    } catch (err) {
      const message =
        err instanceof Error
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
    } catch {
      // Ignore logout API errors - clear local state regardless
    } finally {
      get().clearAuth();
    }
  },

  refreshAccessToken: async () => {
    const { refreshToken: token } = get();
    if (!token) {
      get().clearAuth();
      throw new Error('No refresh token available');
    }

    const response = await authApi.refreshToken(token);
    const { access_token, refresh_token: newRefreshToken } = response;

    // Use the new refresh token if the server rotated it; otherwise keep the old one.
    const effectiveRefreshToken = newRefreshToken ?? token;

    // Persist the (possibly rotated) refresh token.
    localStorage.setItem(STORAGE_KEYS.refreshToken, effectiveRefreshToken);

    set({
      accessToken: access_token,
      refreshToken: effectiveRefreshToken,
      isAuthenticated: true,
    });
  },

  initialize: async () => {
    const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
    const userJson = localStorage.getItem(STORAGE_KEYS.user);

    if (!refreshToken || !userJson) {
      get().clearAuth();
      return;
    }

    try {
      const user: UserResponse = JSON.parse(userJson);

      // Use the persisted refresh token to silently obtain a fresh access token.
      // This way the access token never touches localStorage.
      await get().refreshAccessToken();

      // Reconcile user profile with server (in case it changed).
      try {
        const me = await authApi.getMe();
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(me));
        set({ user: me });
      } catch {
        // getMe failed but refresh succeeded — keep the cached user profile.
        set({ user });
      }
    } catch {
      // Refresh or JSON parse failed — clear and force re-login.
      get().clearAuth();
    }
  },

  clearAuth: () => {
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

  setAuth: (accessToken: string, refreshToken: string, user: UserResponse) => {
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

