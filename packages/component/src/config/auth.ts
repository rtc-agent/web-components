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
    /** 窗口状态：mode, position, size */
    windowState: 'rtc_window_state',
    /** 会话树展开状态：sessionId → isExpanded */
    sessionTreeExpanded: 'rtc_session_tree_expanded',
    /** Tab 栏状态：tabs + activeSessionId */
    sessionTabs: 'rtc_session_tabs',
    /** Activity Bar 状态：active activity + sidebarVisible */
    activityBar: 'rtc_activity_bar',
    /** Editor Area 状态：打开的 tabs + activeFilePath */
    editorArea: 'rtc_editor_area',
    /** 全局设置状态 */
    settings: 'rtc_settings',
} as const;
