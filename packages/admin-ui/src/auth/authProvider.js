/**
 * AuthProvider implementation for RTC Agent component integration
 *
 * Implements the AuthProvider interface from @rtc-agent/component with
 * type: 'token-exchange' mode. The admin JWT is exchanged for an RTC JWT
 * via the OAuth2 token exchange endpoint.
 */
import { useAuthStore } from '@/stores/authStore';
// ========== Device ID Management ==========
const DEVICE_ID_KEY = 'rtc-agent-device-id';
/**
 * Generate a UUID v4 for device identification.
 * Uses crypto.randomUUID() when available, falls back to manual generation.
 */
function generateDeviceId() {
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
function getOrCreateDeviceId() {
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
export function createAuthProvider(serverURL) {
    const deviceId = getOrCreateDeviceId();
    return {
        type: 'token-exchange',
        /**
         * Returns the admin JWT for token exchange.
         * If the token is expired, attempts to refresh it first.
         */
        getExchangeToken: async () => {
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
                    }
                    catch {
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
        isLoggedIn: () => {
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
        getUserId: () => {
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
 */
function isTokenExpiringSoon(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (!payload.exp) {
            return false;
        }
        const expiresAt = payload.exp * 1000; // Convert to milliseconds
        const now = Date.now();
        const bufferMs = 60 * 1000; // 60 seconds buffer
        return expiresAt - now < bufferMs;
    }
    catch {
        // If we can't decode the token, assume it's fine
        return false;
    }
}
//# sourceMappingURL=authProvider.js.map