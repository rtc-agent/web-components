/**
 * Admin API HTTP client
 *
 * Axios-based HTTP client with authentication interceptors for the admin API.
 * Automatically attaches Bearer tokens and handles 401 responses by redirecting to login.
 */

import axios from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';

// ========== Response Types ==========

/**
 * localStorage keys shared between api.ts and authStore.ts.
 *
 * SECURITY: The access token is deliberately excluded from persistent storage.
 * It lives only in memory (zustand store) so that an XSS attack cannot steal it
 * via localStorage.  Only the refresh token is persisted; it can be rotated /
 * revoked server-side if compromised.
 *
 * Centralized here to prevent drift between modules.
 */
export const STORAGE_KEYS = {
  refreshToken: 'refreshToken',
  user: 'user',
} as const;

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: UserResponse;
}

export interface UserResponse {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface ApiError {
  error: string;
  error_description?: string;
}

// ========== HTTP Client ==========

const baseURL = import.meta.env.VITE_ADMIN_API_URL || '';

const httpClient: AxiosInstance = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ========== Request Interceptor ==========

httpClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Read access token from zustand store (memory-only, not persisted).
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ========== Response Interceptor ==========

httpClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      // Delegate token clearing to the auth store to avoid duplicated logic
      useAuthStore.getState().clearAuth();

      // Redirect to login if not already there
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

// ========== API Methods ==========

/**
 * Admin authentication API.
 */
export const authApi = {
  /**
   * Login with email and password.
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await httpClient.post<LoginResponse>('/api/auth/login', {
      email,
      password,
    });
    return response.data;
  },

  /**
   * Get current authenticated user info.
   */
  async getMe(): Promise<UserResponse> {
    const response = await httpClient.get<UserResponse>('/api/auth/me');
    return response.data;
  },

  /**
   * Refresh the access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<RefreshResponse> {
    const response = await httpClient.post<RefreshResponse>('/api/auth/refresh', {
      refresh_token: refreshToken,
    });
    return response.data;
  },

  /**
   * Logout and revoke the refresh token.
   */
  async logout(refreshToken: string): Promise<void> {
    await httpClient.post('/api/auth/logout', {
      refresh_token: refreshToken,
    });
  },
};

export default httpClient;
