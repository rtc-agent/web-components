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
import type {TokenExpiredAction, TokenExchangeResponse} from '@rtc-agent/client';
import type {AuthState} from '../types/index.js';
import type {AuthContextValue} from '../contexts/auth.js';
import type {AuthProvider} from '../types/factory.js';
import {DEFAULT_AUTH_STATE} from '../contexts/auth.js';
import {AUTH_CONFIG, STORAGE_KEYS} from '../config/auth.js';
import { createLogger, OAuth2Client } from '@rtc-agent/client';

const log = createLogger('AuthController');

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
    /** Flag to indicate external token mode (skip localStorage persistence). */
    private _externalTokens = false;

    /** Auth provider */
    private _authProvider?: AuthProvider;

    /** Flag to indicate Token Exchange mode (vs OAuth2 Redirect mode). */
    private _isTokenExchangeMode = false;

    /** OAuth2Client instance for Token Exchange mode. */
    private _oauth2Client?: OAuth2Client;

    /**
     * Callback fired when auth state transitions to logged-in.
     *
     * Covers all login paths:
     * - Initial token load (valid tokens in localStorage)
     * - Token refresh success (expired tokens refreshed on page load)
     * - Login dialog completion (user explicitly logs in)
     *
     * Used by rtc-agent.ts to trigger WebSocket connection after auth is ready,
     * fixing the race condition where connectedCallback() runs before async
     * token refresh completes.
     */
    onLogin?: () => void;

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

        // FIX: Re-schedule refresh timer if logged in but timer was cleared by hostDisconnected()
        // This handles React StrictMode's unmount/remount cycle where:
        // 1. First hostConnected() → timer exists (set by _loadTokens in constructor)
        // 2. hostDisconnected() → clears timer
        // 3. Second hostConnected() → timer missing, need to re-schedule
        if (this._state.isLoggedIn && !this._refreshTimer && this._state.expiresAt) {
            this._scheduleRefresh(this._state.expiresAt);
        }
    }

    /**
     * ReactiveController lifecycle: host disconnected from DOM.
     *
     * Memory management: clears document-level listeners and timers that would
     * otherwise prevent GC or fire on a detached element. Provider references
     * (_authProvider) are intentionally NOT cleared here —
     * they persist across temporary disconnects and are cleared by _performLogout()
     * or when the controller is GC'd with the element.
     */
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
        // Notify rtc-agent to trigger WebSocket connection
        this._fireLogin();
    }

    /**
     * Set auth provider for authentication.
     *
     * The component delegates all authentication management to the provider.
     * Use this for complex authentication flows, multi-tenant applications,
     * or custom token rotation strategies.
     *
     * Two modes are supported:
     * 1. OAuth2 Redirect (default): Host manages tokens via getToken()/refreshToken()
     * 2. Token Exchange: Host provides external JWT via getExchangeToken(),
     *    component exchanges it for RTC JWT via OAuth2Client.tokenExchange()
     *
     * @param provider - The auth provider interface
     */
    setAuthProvider(provider: AuthProvider) {
        this._authProvider = provider;
        this._externalTokens = true; // Skip localStorage persistence

        // Detect Token Exchange mode
        this._isTokenExchangeMode = provider.type === 'token-exchange';

        if (this._isTokenExchangeMode) {
            // Initialize OAuth2Client for Token Exchange mode
            this._oauth2Client = new OAuth2Client({
                serverURL: AUTH_CONFIG.serverURL,
                redirectUri: AUTH_CONFIG.redirectUri,
            });
        }

        // Store the server-issued Device ID to localStorage so that
        // getOrCreateDeviceId() (called later by PersistenceController) picks it up
        // instead of generating a new one. This ensures RTC filtering matches.
        try {
            localStorage.setItem(STORAGE_KEYS.deviceId, provider.deviceId);
        } catch (err) {
            log.debug('Failed to store deviceId in localStorage:', err);
        }

        // Set initial state based on provider's isLoggedIn()
        const loggedIn = provider.isLoggedIn();

        if (loggedIn) {
            if (this._isTokenExchangeMode) {
                // Token Exchange mode: perform token exchange immediately
                this._state = {
                    isLoggedIn: true,
                    accessToken: '', // Will be set by token exchange
                    refreshToken: '', // Not used in token exchange mode
                    userId: provider.getUserId?.() || 'provider-managed',
                    expiresAt: Infinity, // Will be set after token exchange
                };
                this.host.requestUpdate();
                void this._performTokenExchange().then(success => {
                    if (this._authProvider !== provider) return;
                    if (success) {
                        this._fireLogin();
                    } else {
                        // Token exchange failed, logout
                        this._performLogout();
                    }
                });
            } else {
                // OAuth2 Redirect mode: host manages tokens
                this._state = {
                    isLoggedIn: true,
                    accessToken: '', // Will be fetched on demand
                    refreshToken: '', // Not used in provider mode
                    userId: provider.getUserId?.() || 'provider-managed',
                    expiresAt: Infinity, // Provider controls expiration
                };
                this.host.requestUpdate();
                this._fireLogin();
            }
        } else {
            // isLoggedIn() returned false
            this._state = { isLoggedIn: false };
            this.host.requestUpdate();

            if (this._isTokenExchangeMode) {
                // Token Exchange mode: attempt token exchange even if isLoggedIn() returned false
                void this._performTokenExchange().then(success => {
                    if (this._authProvider !== provider) return;
                    if (success) {
                        this._fireLogin();
                    }
                    // If failed, stay logged out
                });
            } else {
                // OAuth2 Redirect mode: attempt refresh via provider
                if (!provider.refreshToken) {
                    // No refresh method available, stay logged out
                    return;
                }
                void provider.refreshToken().then(result => {
                    // Guard: if _authProvider was cleared (logout/destroy) during the
                    // async refresh, don't update state.
                    if (this._authProvider !== provider) {
                        return;
                    }
                    const newExpiresAt = result.expiresIn
                        ? Date.now() + result.expiresIn * 1000
                        : Infinity;
                    this._state = {
                        isLoggedIn: true,
                        accessToken: result.accessToken,
                        refreshToken: result.refreshToken ?? '',
                        userId: provider.getUserId?.() || 'provider-managed',
                        expiresAt: newExpiresAt,
                    };
                    if (newExpiresAt !== Infinity) {
                        this._scheduleRefresh(newExpiresAt);
                    }
                    this.host.requestUpdate();
                    this._fireLogin();
                }).catch(() => {
                    // Guard: same as above.
                    if (this._authProvider !== provider) return;
                    // Stay logged out — login page is already shown.
                });
            }
        }
    }

    /** Get current access token (for API requests) */
    getAccessToken(): string | undefined {
        return this._state.accessToken;
    }

    /**
     * Get the current access token, resolving it asynchronously if needed.
     *
     * Priority:
     * 1. Token Exchange mode - calls provider.getExchangeToken() + tokenExchange()
     * 2. Auth provider - calls provider.getToken()
     * 3. Stored token (internal auth) - returns _state.accessToken
     *
     * @returns The access token string, or undefined if unavailable.
     */
    async getAccessTokenAsync(): Promise<string | undefined> {
        if (this._isTokenExchangeMode && this._authProvider?.getExchangeToken) {
            // Token Exchange mode: use the RTC JWT from token exchange
            return this._state.accessToken;
        }
        if (this._authProvider?.getToken) {
            return await this._authProvider.getToken();
        }
        return this._state.accessToken;
    }

    /**
     * Perform Token Exchange: call getExchangeToken() + tokenExchange().
     *
     * Flow:
     * 1. Call authProvider.getExchangeToken() to get external JWT
     * 2. Call OAuth2Client.tokenExchange() to get RTC JWT
     * 3. Save RTC JWT to state (persisted via setTokens-like logic)
     * 4. Schedule refresh timer
     *
     * Error handling:
     * - getExchangeToken() fails → logout
     * - tokenExchange() fails → retry 1 time (handled by OAuth2Client), still fails → logout
     *
     * @returns true if exchange succeeded, false otherwise
     */
    private async _performTokenExchange(): Promise<boolean> {
        if (!this._authProvider?.getExchangeToken || !this._oauth2Client) {
            log.error('[TOKEN_EXCHANGE] Missing getExchangeToken or OAuth2Client');
            return false;
        }

        try {
            // Step 1: Get external JWT from host application
            let externalJWT: string;
            try {
                externalJWT = await this._authProvider.getExchangeToken();
            } catch (err) {
                log.error('[TOKEN_EXCHANGE] getExchangeToken() failed:', err);
                // getExchangeToken failed → logout
                this._performLogout();
                return false;
            }

            if (!externalJWT) {
                log.error('[TOKEN_EXCHANGE] getExchangeToken() returned empty token');
                this._performLogout();
                return false;
            }

            // Step 2: Exchange external JWT for RTC JWT
            let response: TokenExchangeResponse;
            try {
                response = await this._oauth2Client.tokenExchange({
                    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
                    subject_token: externalJWT,
                    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
                    device_id: this._authProvider.deviceId,
                });
            } catch (err) {
                log.error('[TOKEN_EXCHANGE] tokenExchange() failed:', err);
                // tokenExchange failed → logout (retry already handled by OAuth2Client)
                this._performLogout();
                return false;
            }

            // Step 3: Update state with RTC JWT
            const expiresAt = Date.now() + response.expires_in * 1000;
            this._state = {
                isLoggedIn: true,
                accessToken: response.access_token,
                refreshToken: '', // Not used in token exchange mode
                userId: this._authProvider.getUserId?.() || 'provider-managed',
                expiresAt,
            };

            // Save to localStorage for persistence across page reloads
            this._saveTokens({
                accessToken: response.access_token,
                refreshToken: '',
                userId: this._authProvider.getUserId?.() || 'provider-managed',
                expiresAt,
            });

            // Step 4: Schedule refresh
            this._scheduleRefresh(expiresAt);
            this.host.requestUpdate();

            log.info('[TOKEN_EXCHANGE] Token exchange succeeded, expires at', new Date(expiresAt).toISOString());
            return true;
        } catch (err) {
            log.error('[TOKEN_EXCHANGE] Unexpected error during token exchange:', err);
            this._performLogout();
            return false;
        }
    }

    private _login() {
        this.host.requestUpdate();
        // Public event for external consumers (root opens login dialog)
        this.host.dispatchEvent(
            new CustomEvent('rtc-auth-login-requested', {bubbles: true, composed: true})
        );
    }

    private _logout() {
        // Auth provider (Mode 3): delegate logout to the provider
        if (this._authProvider?.logout) {
            void this._authProvider.logout().then(() => {
                this._performLogout();
            }).catch((error) => {
                log.error('[AUTH_LIFECYCLE] _logout() Auth provider logout failed:', error);
                this._performLogout();
            });
            return;
        }

        this._performLogout();
    }

    /**
     * Internal logout implementation.
     *
     * Memory management: clears all provider references and timers to prevent leaks.
     * - `_authProvider`: released so the host app's provider can be GC'd
     * - `_refreshTimer`: cleared to prevent orphaned setTimeout callbacks
     * - `_externalTokens`: reset so next login cycle starts clean
     * - `_isTokenExchangeMode`: reset to default
     * - `_oauth2Client`: released for GC
     */
    private _performLogout() {
        this._state = {isLoggedIn: false};

        // Only clear localStorage if we are not in external token mode.
        // External tokens were never persisted, so there is nothing to clean up.
        // Exception: Token Exchange mode persists RTC JWT to localStorage
        if (!this._externalTokens || this._isTokenExchangeMode) {
            localStorage.removeItem(STORAGE_KEYS.tokens);
        }
        this._externalTokens = false;
        this._authProvider = undefined;
        this._isTokenExchangeMode = false;
        this._oauth2Client = undefined;

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
                        // Notify rtc-agent to trigger WebSocket connection
                        // (fixes race condition: connectedCallback() ran before refresh completed)
                        this._fireLogin();
                    } else {
                        localStorage.removeItem(STORAGE_KEYS.tokens);
                    }
                }).catch(err => {
                    // Guard against unhandled rejection (e.g. localStorage quota exceeded).
                    log.error('[AUTH_LIFECYCLE] _loadTokens() Refresh promise rejected:', err);
                    localStorage.removeItem(STORAGE_KEYS.tokens);
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
                // Tokens were valid, but connection still needs to be triggered
                // on initial load (connectedCallback may have already run)
                this._fireLogin();
            }
        } catch (err) {
            log.warn('[AUTH_LIFECYCLE] _loadTokens() Failed to load/parse tokens, clearing:', err);
            localStorage.removeItem(STORAGE_KEYS.tokens);
        }
    }

    /** Save tokens to localStorage with QuotaExceededError handling */
    private _saveTokens(tokens: StoredTokens) {
        try {
            localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify(tokens));
        } catch (err) {
            // CRITICAL FIX: Handle QuotaExceededError (common on mobile browsers)
            // Attempt to clear residual data and retry once
            log.error('[AUTH] Failed to save tokens to localStorage:', err);
            try {
                localStorage.removeItem(STORAGE_KEYS.tokens);
                localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify(tokens));
                log.info('[AUTH] Token save succeeded after clearing residual data');
            } catch (retryErr) {
                log.error('[AUTH] Token persistence failed after retry:', retryErr);
                // Don't block login flow — token is already in memory
                // User will need to re-login on next page load, but current session works
            }
        }
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
            const response = await fetch(`${AUTH_CONFIG.serverURL}/oauth2/refresh`, {
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
            } catch (err) {
                log.warn('Token refresh response body parse failed:', err);
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
            log.error('Token refresh failed:', error);
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
        // Auth provider mode: delegate refresh to the provider
        if (this._authProvider) {
            return this._executeRefreshWithGuard();
        }

        // Internal auth mode: use refreshToken from state
        if (!this._state.refreshToken) {
            this._logout();
            return 'relogin';
        }

        return this._executeRefreshWithGuard();
    }

    /**
     * Execute refresh with concurrency guard to prevent race conditions.
     * If a refresh is already in-flight, wait for it; otherwise start a new one.
     */
    private async _executeRefreshWithGuard(): Promise<TokenExpiredAction> {
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
        // Token Exchange mode: refresh by performing a new token exchange
        if (this._isTokenExchangeMode) {
            return this._performTokenExchange();
        }

        // Auth provider (OAuth2 Redirect mode): delegate refresh to the provider.
        if (this._authProvider?.refreshToken) {
            try {
                const result = await this._authProvider.refreshToken();

                const newExpiresAt = result.expiresIn
                    ? Date.now() + result.expiresIn * 1000
                    : Infinity;

                this._state = {
                    ...this._state,
                    accessToken: result.accessToken,
                    refreshToken: result.refreshToken ?? '',
                    expiresAt: newExpiresAt,
                };

                // External tokens are not persisted to localStorage.
                if (newExpiresAt !== Infinity) {
                    this._scheduleRefresh(newExpiresAt);
                }

                this.host.requestUpdate();
                return true;
            } catch (error) {
                log.error('[AUTH_LIFECYCLE] _doRefresh() Auth provider refresh failed:', error);
                return false;
            }
        }

        // Internal auth mode: use the built-in refresh endpoint
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
        // fields written by other code paths (e.g. userId, refreshToken).
        // Skip persistence for external tokens (host application manages them).
        if (!this._externalTokens) {
            let stored: Record<string, unknown> = {};
            try {
                stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.tokens) || '{}');
            } catch {
                // Corrupted localStorage data (e.g., browser extension interference, storage
                // fault): discard and start fresh. The next line writes valid token data,
                // effectively repairing the corrupted entry. No data loss — the in-memory
                // state (this._state) is the source of truth for the current session.
            }
            stored.accessToken = newAccessToken;
            stored.expiresAt = newExpiresAt;
            localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify(stored));
        }

        // Schedule next refresh
        this._scheduleRefresh(newExpiresAt);
        this.host.requestUpdate();
        return true;
    }

    /** Check if refresh needed when page becomes visible */
    private _onVisibilityChange() {
        if (document.visibilityState === 'visible' && this._state.isLoggedIn) {
            const needsRefresh = this._state.expiresAt && Date.now() > this._state.expiresAt - AUTH_CONFIG.refreshBufferMs;
            if (needsRefresh) {
                void this.handleTokenExpired();
            }
        }
    }

    /**
     * Fire login success side-effects: dispatch DOM event + invoke callback.
     *
     * Centralized to ensure both the `rtc-auth-login` DOM event and the
     * `onLogin` callback fire together, covering all login paths:
     * - setTokens (login dialog completion)
     * - setAuthProvider (when provider.isLoggedIn() returns true)
     * - _loadTokens (valid tokens found or refresh succeeded)
     *
     * Memory note: `onLogin` callback is set by rtc-agent.ts in connectedCallback()
     * and cleared in disconnectedCallback(). No leak risk — the callback reference
     * is bounded to the host element's lifecycle.
     */
    private _fireLogin() {
        this.host.dispatchEvent(
            new CustomEvent('rtc-auth-login', {
                detail: { userId: this._state.userId },
                bubbles: true,
                composed: true,
            })
        );
        this.onLogin?.();
    }
}
