/**
 * Auth Controller
 *
 * Encapsulates authentication state: login status, tokens, persistence, and auto-refresh.
 * On login, dispatches `rtc-auth-login-requested` event on the host element
 * for external consumers.
 *
 * Corresponds to: `authContext` (defined in `contexts/auth.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-login-page>`, `<rtc-content-wrapper>`
 *
 * Note: `setTokens()` is a root-level coordination method, NOT exposed on AuthContext.
 * It is called directly by `<rtc-agent>` when login dialog completes.
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {TokenExpiredAction} from '@rtc-agent/client';
import type {AuthState} from '../types/index.js';
import type {AuthContextValue} from '../contexts/auth.js';
import {DEFAULT_AUTH_STATE} from '../contexts/auth.js';
import {AUTH_CONFIG, STORAGE_KEYS} from '../config/auth.js';

interface StoredTokens {
    accessToken: string;
    refreshToken: string;
    userId: string;
    expiresAt: number;
}

interface SetTokensParams {
    accessToken: string;
    refreshToken: string;
    userId: string;
    expiresIn: number;
}

export class AuthController implements ReactiveController {
    host: ReactiveControllerHost & EventTarget;

    private _state: AuthState = {...DEFAULT_AUTH_STATE};
    private _refreshTimer?: ReturnType<typeof setTimeout>;
    private _boundVisibilityHandler?: () => void;
    /** In-flight refresh guard — prevents concurrent refresh calls from racing. */
    private _refreshing?: Promise<boolean>;

    readonly actions: {login(): void; logout(): void};

    get value(): AuthContextValue {
        return {state: this._state, ...this.actions};
    }

    get state(): AuthState {
        return this._state;
    }

    constructor(host: ReactiveControllerHost & EventTarget) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            login: () => this._login(),
            logout: () => this._logout(),
        };
        this._loadTokens();
    }

    hostConnected() {
        this._boundVisibilityHandler = this._onVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._boundVisibilityHandler);
    }

    hostDisconnected() {
        if (this._boundVisibilityHandler) {
            document.removeEventListener('visibilitychange', this._boundVisibilityHandler);
            this._boundVisibilityHandler = undefined;
        }
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = undefined;
        }
    }

    /**
     * Convenience: trigger login directly on the controller.
     *
     * Design exception for AuthController: `login`/`logout` are exposed at the
     * controller top level (not nested under `actions`), because auth is a
     * root-level concern and external callers (demo page, protocol layer) need
     * a straightforward API. Internally delegates to `_login()`.
     */
    login() { this._login(); }

    /** Convenience: trigger logout directly on the controller. */
    logout() { this._logout(); }

    /**
     * Set tokens after successful login.
     * Called by <rtc-agent> when login dialog completes.
     * NOT exposed on AuthContext (root-level coordination).
     */
    setTokens(params: SetTokensParams) {
        const expiresAt = Date.now() + params.expiresIn * 1000;

        this._state = {
            isLoggedIn: true,
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            userId: params.userId,
            expiresAt,
        };

        this._saveTokens({
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            userId: params.userId,
            expiresAt,
        });

        this._scheduleRefresh(expiresAt);
        this.host.requestUpdate();
    }

    /** Get current access token (for API requests) */
    getAccessToken(): string | undefined {
        return this._state.accessToken;
    }

    private _login() {
        this.host.requestUpdate();
        // Public event for external consumers (root opens login dialog)
        this.host.dispatchEvent(
            new CustomEvent('rtc-auth-login-requested', {bubbles: true, composed: true})
        );
    }

    private _logout() {
        this._state = {isLoggedIn: false};
        localStorage.removeItem(STORAGE_KEYS.tokens);

        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = undefined;
        }

        this.host.dispatchEvent(
            new CustomEvent('rtc-auth-logout', {bubbles: true, composed: true})
        );
        this.host.requestUpdate();
    }

    /** Load tokens from localStorage */
    private _loadTokens() {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.tokens);
            if (!stored) return;

            const tokens: StoredTokens = JSON.parse(stored);

            // Check if expired
            if (tokens.expiresAt < Date.now()) {
                // Try refresh; on failure clear tokens so login page shows
                void this._executeRefresh(tokens.refreshToken).then(result => {
                    if (result.success) {
                        this._state = {
                            isLoggedIn: true,
                            accessToken: result.accessToken!,
                            refreshToken: tokens.refreshToken,
                            userId: tokens.userId,
                            expiresAt: result.expiresAt!,
                        };
                        this._saveTokens({
                            accessToken: result.accessToken!,
                            refreshToken: tokens.refreshToken,
                            userId: tokens.userId,
                            expiresAt: result.expiresAt!,
                        });
                        this._scheduleRefresh(result.expiresAt!);
                        this.host.requestUpdate();
                    } else {
                        localStorage.removeItem(STORAGE_KEYS.tokens);
                    }
                });
            } else {
                this._state = {
                    isLoggedIn: true,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    userId: tokens.userId,
                    expiresAt: tokens.expiresAt,
                };
                this._scheduleRefresh(tokens.expiresAt);
            }
        } catch {
            localStorage.removeItem(STORAGE_KEYS.tokens);
        }
    }

    /** Save tokens to localStorage */
    private _saveTokens(tokens: StoredTokens) {
        localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify(tokens));
    }

    /** Schedule next refresh */
    private _scheduleRefresh(expiresAt: number) {
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
        }

        // Refresh REFRESH_BUFFER_MS before expiry
        const timeUntilRefresh = Math.max(0, expiresAt - Date.now() - AUTH_CONFIG.refreshBufferMs);

        this._refreshTimer = setTimeout(() => {
            void this.handleTokenExpired();
        }, timeUntilRefresh);
    }

    /**
     * Execute refresh - shared method to eliminate duplication.
     * Returns success status and new token info.
     */
    private async _executeRefresh(refreshToken: string): Promise<{
        success: boolean;
        accessToken?: string;
        expiresAt?: number;
    }> {
        try {
            const response = await fetch(`${AUTH_CONFIG.serverUrl}/oauth2/refresh`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({refresh_token: refreshToken}),
            });

            if (!response.ok) {
                return {success: false};
            }

            let data: Record<string, unknown>;
            try {
                data = await response.json();
            } catch {
                return {success: false};
            }

            const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 0;
            const accessToken = typeof data.access_token === 'string' ? data.access_token : undefined;

            if (!accessToken || !expiresIn) {
                return {success: false};
            }

            const expiresAt = Date.now() + expiresIn * 1000;

            return {
                success: true,
                accessToken,
                expiresAt,
            };
        } catch (error) {
            console.error('[AuthController] Token refresh failed:', error);
            return {success: false};
        }
    }

    /**
     * Handle token expiration — called by RTCAgentClient (via persistence layer)
     * when Centrifuge detects the access token is expired.
     *
     * Flow: try refresh → success returns 'refresh', failure clears tokens and
     * returns 'relogin' (component will show rtc-login-page).
     *
     * Uses a _refreshing promise guard to prevent concurrent refresh races
     * that could corrupt localStorage (parse-modify-write race).
     */
    async handleTokenExpired(): Promise<TokenExpiredAction> {
        if (!this._state.refreshToken) {
            this._logout();
            return 'relogin';
        }

        // Guard: if a refresh is already in-flight, wait for it instead of racing.
        if (this._refreshing) {
            const success = await this._refreshing;
            return success ? 'refresh' : 'relogin';
        }

        this._refreshing = this._doRefresh();
        try {
            const success = await this._refreshing;
            return success ? 'refresh' : 'relogin';
        } finally {
            this._refreshing = undefined;
        }
    }

    /**
     * Internal: execute the refresh flow, update state + localStorage.
     * Returns true on success, false on failure.
     */
    private async _doRefresh(): Promise<boolean> {
        const result = await this._executeRefresh(this._state.refreshToken!);

        if (!result.success) {
            this._logout();
            this.host.dispatchEvent(
                new CustomEvent('rtc-auth-refresh-failed', {bubbles: true, composed: true})
            );
            return false;
        }

        // Update state with new token
        const newAccessToken = result.accessToken!;
        const newExpiresAt = result.expiresAt!;

        this._state = {
            ...this._state,
            accessToken: newAccessToken,
            expiresAt: newExpiresAt,
        };

        // Update localStorage — merge with existing data to avoid overwriting
        // fields written by other code paths (e.g. userId, refreshToken)
        let stored: Record<string, unknown> = {};
        try {
            stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.tokens) || '{}');
        } catch {
            // Corrupted data; start fresh
        }
        stored.accessToken = newAccessToken;
        stored.expiresAt = newExpiresAt;
        localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify(stored));

        // Schedule next refresh
        this._scheduleRefresh(newExpiresAt);
        this.host.requestUpdate();
        return true;
    }

    /** Check if refresh needed when page becomes visible */
    private _onVisibilityChange() {
        if (document.visibilityState === 'visible' && this._state.isLoggedIn) {
            if (this._state.expiresAt && Date.now() > this._state.expiresAt - AUTH_CONFIG.refreshBufferMs) {
                void this.handleTokenExpired();
            }
        }
    }
}
