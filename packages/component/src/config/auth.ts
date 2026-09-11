/**
 * Auth Configuration
 *
 * Centralized configuration for OAuth2 authentication flow.
 */

/**
 * Runtime-overridable server URL.
 *
 * Set via `<rtc-agent server-url="...">` attribute (wired in RtcAgent setter).
 * Precedence: explicit setServerUrl() > VITE_SERVER_URL env > 'http://localhost:28080'.
 */
let _serverUrl: string | null = null;

/**
 * Runtime-overridable redirect URI.
 *
 * Set via `<rtc-agent redirect-uri="...">` attribute (wired in RtcAgent setter).
 * Precedence: explicit setRedirectUri() > window.location.origin + '/auth/callback.html'.
 */
let _redirectUri: string | null = null;

/**
 * Override the backend server URL.
 *
 * Called by the <rtc-agent> component when its `server-url` attribute is set.
 * Safe to call multiple times; takes effect immediately for subsequent reads.
 */
export function setServerUrl(url: string | null): void {
    _serverUrl = url && url.length > 0 ? url.replace(/\/+$/, '') : null;
}

/**
 * Override the OAuth redirect URI.
 *
 * Called by the <rtc-agent> component when its `redirect-uri` attribute is set.
 * Safe to call multiple times; takes effect immediately for subsequent reads.
 */
export function setRedirectUri(uri: string | null): void {
    _redirectUri = uri && uri.length > 0 ? uri.replace(/\/+$/, '') : null;
}

/** Get server URL (runtime override > env > default). */
function getServerUrl(): string {
    if (_serverUrl) return _serverUrl;
    // Vite injects env vars at build time (typed via vite/client in vite-env.d.ts)
    try {
        const env = import.meta.env;
        if (env?.VITE_SERVER_URL) return env.VITE_SERVER_URL;
    } catch {
        // ignore
    }
    return 'http://localhost:28080';
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

    /** Callback URL (runtime override > dynamically generated from current origin) */
    get redirectUri(): string {
        if (_redirectUri) return _redirectUri;
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
