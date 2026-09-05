/**
 * Auth Configuration
 *
 * Centralized configuration for OAuth2 authentication flow.
 */

/** Get server URL from env or use default */
function getServerUrl(): string {
    // Vite injects env vars at build time (typed via vite/client in vite-env.d.ts)
    try {
        const env = import.meta.env;
        return env?.VITE_SERVER_URL || 'http://localhost:8888';
    } catch {
        return 'http://localhost:8888';
    }
}

/** Auth-related configuration */
export const AUTH_CONFIG = {
    /** Backend server URL */
    get serverUrl(): string {
        return getServerUrl();
    },

    /** Centrifuge WebSocket endpoint (derived from server URL) */
    get wsEndpoint(): string {
        const http = getServerUrl();
        // http:// → ws://, https:// → wss://
        return http.replace(/^http/, 'ws') + '/connection/websocket';
    },

    /** OAuth2 Provider name */
    provider: 'mock',

    /** Callback URL (dynamically generated from current origin) */
    get redirectUri(): string {
        return `${window.location.origin}/auth/callback.html`;
    },

    /** Token refresh buffer time (5 minutes before expiry) */
    refreshBufferMs: 5 * 60 * 1000,
} as const;

/** localStorage keys */
export const STORAGE_KEYS = {
    tokens: 'rtc_auth_tokens',
    deviceId: 'rtc_device_id',
    deviceName: 'rtc_device_name',
    oauthState: 'rtc_oauth_state',
    mode: 'rtc_mode',
} as const;
