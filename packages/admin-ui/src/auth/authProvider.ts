/**
 * AuthProvider implementation for RTC Agent component integration
 *
 * Implements the AuthProvider interface from @rtc-agent/component with
 * type: 'token-exchange' mode. The admin JWT is exchanged for an RTC JWT
 * via the OAuth2 token exchange endpoint.
 */

import type { AuthProvider } from '@rtc-agent/component';
import { useAuthStore } from '@/stores/authStore';

// ========== Device ID Management ==========

/**
 * localStorage key for the device ID.
 * Must match the key used by @rtc-agent/component (see STORAGE_KEYS.deviceId in config/auth.ts).
 */
const DEVICE_ID_KEY = 'rtc_device_id';

/**
 * Generate a UUID v4 for device identification.
 * Uses crypto.randomUUID() when available, falls back to manual generation.
 */
function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get or create a persistent device ID.
 * The device ID is stored in localStorage and reused across sessions.
 */
function getOrCreateDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

// ========== AuthProvider Factory ==========

/**
 * Create an AuthProvider instance for the RTC Agent component.
 *
 * This provider uses 'token-exchange' mode: the admin JWT from the auth store
 * is provided as the external JWT, and the RTC Agent component exchanges it
 * for an RTC JWT via the OAuth2 token exchange endpoint.
 *
 * @param serverURL - The RTC Agent server URL for token exchange
 * @returns AuthProvider instance compatible with createRtcAgent()
 */
export function createAuthProvider(serverURL: string): AuthProvider {
  const deviceId = getOrCreateDeviceId();

  return {
    type: 'token-exchange',

    /**
     * Returns the admin JWT for token exchange.
     * If the token is expired, attempts to refresh it first.
     */
    getExchangeToken: async (): Promise<string> => {
      const state = useAuthStore.getState();
      const { accessToken, refreshToken } = state;

      if (!accessToken) {
        throw new Error('No access token available - user not authenticated');
      }

      // Check if token is about to expire (within 60 seconds)
      if (isTokenExpiringSoon(accessToken)) {
        if (refreshToken) {
          try {
            await state.refreshAccessToken();
            // Get the new token after refresh
            const newState = useAuthStore.getState();
            if (!newState.accessToken) {
              throw new Error('Token refresh failed');
            }
            return newState.accessToken;
          } catch {
            throw new Error('Token refresh failed - please login again');
          }
        }
      }

      return accessToken;
    },

    /**
     * Refresh the access token.
     * Delegates to the auth store's refreshAccessToken method.
     */
    refreshToken: async () => {
      const state = useAuthStore.getState();
      await state.refreshAccessToken();
      const newState = useAuthStore.getState();
      return {
        accessToken: newState.accessToken ?? '',
        refreshToken: newState.refreshToken ?? undefined,
      };
    },

    /**
     * Check if the user is currently logged in.
     */
    isLoggedIn: (): boolean => {
      return useAuthStore.getState().isAuthenticated;
    },

    /**
     * Logout handler - clears tokens and redirects to login page.
     */
    logout: async () => {
      const state = useAuthStore.getState();
      await state.logout();
      window.location.href = '/login';
    },

    /**
     * Returns the current user's ID.
     * Used for per-user IndexedDB database naming.
     */
    getUserId: (): string => {
      const user = useAuthStore.getState().user;
      return user?.id ?? 'anonymous';
    },

    /**
     * Device ID - must match the device ID embedded in the JWT by the server.
     * Persisted in localStorage across sessions.
     */
    deviceId,
  };
}

// ========== Helpers ==========

/**
 * Check if a JWT token is expiring soon (within 60 seconds).
 * Decodes the token payload without verification (for expiry check only).
 * Returns false if the token is malformed (caller should handle auth failure elsewhere).
 */
function isTokenExpiringSoon(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload.exp !== 'number') {
      return false;
    }
    const expiresAt = payload.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const bufferMs = 60 * 1000; // 60 seconds buffer
    return expiresAt - now < bufferMs;
  } catch {
    // Malformed token -- assume it's fine; auth flow will reject it later.
    return false;
  }
}
