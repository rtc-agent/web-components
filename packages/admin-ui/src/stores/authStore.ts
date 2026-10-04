/**
 * Authentication state management using Zustand
 *
 * Manages user authentication state, tokens, and provides login/logout/refresh methods.
 * Tokens are persisted in localStorage for session persistence across page reloads.
 */

import { create } from 'zustand';
import { authApi, STORAGE_KEYS } from '@/services/api';
import type { UserResponse } from '@/services/api';

// ========== State Types ==========

interface AuthState {
  /** Current authenticated user */
  user: UserResponse | null;
  /** JWT access token for API calls */
  accessToken: string | null;
  /** JWT refresh token for token renewal */
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
   * On success, stores tokens and user info in state and localStorage.
   */
  login(email: string, password: string): Promise<void>;

  /**
   * Logout the current user.
   * Revokes the refresh token and clears all auth state.
   */
  logout(): Promise<void>;

  /**
   * Refresh the access token using the stored refresh token.
   * Updates both tokens in state and localStorage.
   */
  refreshAccessToken(): Promise<void>;

  /**
   * Initialize auth state from localStorage (called on app startup).
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

    // Persist updated tokens to localStorage.
    localStorage.setItem(STORAGE_KEYS.accessToken, access_token);
    localStorage.setItem(STORAGE_KEYS.refreshToken, effectiveRefreshToken);

    set({
      accessToken: access_token,
      refreshToken: effectiveRefreshToken,
      isAuthenticated: true,
    });
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
      const user: UserResponse = JSON.parse(userJson);

      // Check if access token is expired before using it.
      // Decode the JWT payload (without verification) to read the exp claim.
      // If expired, attempt silent refresh before falling back to login page.
      if (isTokenExpired(accessToken)) {
        await get().refreshAccessToken();
        // Refresh succeeded — state is now updated with new tokens.
        return;
      }

      // Token not expired locally — set state immediately so the UI can render.
      set({
        user,
        accessToken,
        refreshToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      // Verify the token is still valid server-side by fetching user info.
      // If the token was revoked server-side, attempt a silent refresh.
      try {
        const me = await authApi.getMe();
        set({ user: me });
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(me));
      } catch {
        // Token invalid server-side — try to refresh.
        await get().refreshAccessToken();
      }
    } catch {
      // Refresh or JSON parse failed — clear and force re-login.
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

  setAuth: (accessToken: string, refreshToken: string, user: UserResponse) => {
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

// ========== Helpers ==========

/**
 * Check whether a JWT has expired by decoding its payload without verification.
 * Returns true if the token is malformed or past its exp claim.
 *
 * A 30-second buffer is applied so we treat tokens that are about to expire
 * as already expired, avoiding race conditions with in-flight requests.
 */
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload.exp !== 'number') return false;
    const bufferMs = 30 * 1000; // 30-second safety margin
    return payload.exp * 1000 - bufferMs < Date.now();
  } catch {
    // Malformed token — treat as expired so caller attempts refresh.
    return true;
  }
}
