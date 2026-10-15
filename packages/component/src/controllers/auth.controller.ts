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

import type {
  TokenExchangeResponse,
  TokenExpiredAction,
} from '@rtc-agent/client';
import { OAuth2Client } from '@rtc-agent/client';
import { createLogger, parseJwtPayload } from '@rtc-agent/protocol';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { AUTH_CONFIG, STORAGE_KEYS } from '../config/auth.js';
import type { AuthContextValue } from '../contexts/auth.js';
import { DEFAULT_AUTH_STATE } from '../contexts/auth.js';
import type { AuthProvider } from '../types/factory.js';
import type { AuthState } from '../types/index.js';
import { getDeviceName, saveDeviceIdToStorage } from '../utils/device.js';
import { maskUserID } from '../utils/mask.js';

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

  private _state: AuthState = { ...DEFAULT_AUTH_STATE };
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
   * BroadcastChannel for cross-tab token refresh coordination.
   *
   * SECURITY: Multiple tabs detecting token expiry simultaneously would all call
   * refreshToken(), causing race conditions and redundant HTTP requests. The
   * BroadcastChannel ensures only one tab executes the refresh; others wait for
   * the result. This prevents token invalidation from concurrent refresh attempts
   * (some servers invalidate the refresh token after first use).
   */
  private _refreshChannel?: BroadcastChannel;

  /** Unique identifier for this tab instance (for BroadcastChannel messages). */
  private readonly _tabId = crypto.randomUUID();

  /** Timestamp when this tab started a refresh (for leader election). */
  private _refreshStartTime?: number;

  /**
   * Deferred refresh promise for cross-tab coordination.
   *
   * When this tab receives 'refresh-start' from another tab and decides to yield
   * (i.e., the other tab is the leader), this promise is set so that
   * _executeRefreshWithGuard() can await the other tab's result instead of
   * starting its own redundant refresh.
   */
  private _deferredRefresh?: Promise<boolean>;

  /** Resolve function for the deferred refresh promise (set by broadcast handler). */
  private _deferredResolve?: (success: boolean) => void;

  /**
   * Token Exchange concurrency guard — prevents _performTokenExchange() from
   * conflicting with _executeRefreshWithGuard()'s _refreshing promise.
   *
   * Without this separate flag, _performTokenExchange() sets _refreshing = _doTokenExchange()
   * which is then overwritten by _executeRefreshWithGuard() to _doRefreshWithBroadcast().
   * When _doTokenExchange() completes, its .finally() clears _refreshing, leaving the
   * outer guard unprotected and allowing duplicate concurrent operations.
   */
  private _tokenExchanging = false;

  /**
   * StrictMode temporary disconnect flag — prevents redundant BroadcastChannel
   * re-initialization during React StrictMode's unmount/remount cycle.
   *
   * React StrictMode simulates unmount+remount to detect side-effect bugs. When
   * hostDisconnected() closes the BroadcastChannel, this flag marks the disconnect
   * as "temporary" so hostConnected() can re-open it. Without this flag, every
   * disconnect would be treated as permanent, causing unnecessary channel churn.
   */
  private _isTemporaryDisconnect = false;

  /**
   * Pending Token Exchange flag — allows refresh-success handler to accept tokens
   * even when isLoggedIn is false during initial token exchange setup.
   *
   * During Token Exchange mode initialization, the sequence is:
   * 1. setAuthProvider() → isLoggedIn may be false initially
   * 2. _performTokenExchange() starts (async)
   * 3. Another tab broadcasts refresh-success
   * 4. Without this flag, the handler rejects the tokens (isLoggedIn === false)
   * 5. Token exchange completes but may have been redundant
   *
   * This flag ensures that if a token exchange is in progress, we accept the
   * refreshed tokens instead of discarding them.
   */
  private _pendingTokenExchange = false;

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

  readonly actions: { login(): void; logout(): void };

  /**
   * CRITICAL FIX: Value cache to prevent unnecessary Context consumer re-renders.
   * @lit/context uses `===` comparison, so creating new objects every time triggers
   * consumers even when the state hasn't changed. Cache the value object and only
   * recreate when state reference changes.
   *
   * NOTE: This duplicates the caching pattern from CachedContextController.
   * AuthController cannot inherit from CachedContextController because:
   * 1. AuthController requires `ReactiveControllerHost & EventTarget` (for dispatching events)
   * 2. AuthController has additional root-level methods (login, logout, setTokens, setAuthProvider)
   *    that are not part of the context pattern
   * 3. AuthController manages complex token refresh logic with BroadcastChannel coordination
   *
   * The caching pattern is simple enough that duplication is acceptable here.
   */
  private _cachedValue?: AuthContextValue;
  private _cachedState?: AuthState;

  get value(): AuthContextValue {
    // Only create new value object if state reference changed
    if (this._cachedValue && this._cachedState === this._state) {
      return this._cachedValue;
    }
    this._cachedState = this._state;
    // P1 Fix: Follow the standard {state, actions} pattern consistent with other Contexts.
    // This ensures a uniform API across all contexts (SessionContext, ModeContext, etc.).
    this._cachedValue = { state: this._state, actions: this.actions };
    return this._cachedValue;
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
    this._initBroadcastChannel();
  }

  /**
   * Initialize BroadcastChannel for cross-tab token refresh coordination.
   *
   * Cross-tab coordination prevents multiple tabs from simultaneously refreshing
   * tokens, which can cause race conditions and token invalidation (some servers
   * invalidate refresh tokens after first use).
   *
   * Protocol:
   * - Tab A detects expiry → broadcasts 'refresh-start' with tabId + timestamp
   * - Tab B receives 'refresh-start' → if B also wanted to refresh, it yields to A
   *   (the tab with earlier timestamp becomes the "leader")
   * - Tab A completes refresh → broadcasts 'refresh-success' or 'refresh-failure'
   * - Tab B receives result → updates its state accordingly
   *
   * Fallback: if BroadcastChannel is not supported (Safari < 15.4), tabs operate
   * independently. The per-tab Promise guard still prevents intra-tab races.
   */
  private _initBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      log.debug(
        'BroadcastChannel not supported, cross-tab coordination disabled',
      );
      return;
    }

    this._refreshChannel = new BroadcastChannel('rtc-auth-refresh');
    this._refreshChannel.onmessage = (event) => {
      const { type, tabId, timestamp, tokens } = event.data;

      // Ignore messages from this tab
      if (tabId === this._tabId) return;

      switch (type) {
        case 'refresh-start':
          // Another tab is refreshing. If this tab also wanted to refresh, yield.
          // The tab with earlier timestamp becomes the leader.
          if (this._refreshStartTime && this._refreshStartTime < timestamp) {
            // This tab is the leader, ignore the other tab's message
            return;
          }
          // This tab is not the leader — yield to the other tab.
          // Set up a deferred promise so _executeRefreshWithGuard() waits for
          // the other tab's result instead of starting its own redundant refresh.
          log.debug('Yielding to another tab for token refresh');
          this._deferredRefresh = new Promise<boolean>((resolve) => {
            this._deferredResolve = resolve;
          });
          // Auto-resolve after timeout to prevent indefinite waiting
          // (e.g., if the leader tab crashes before broadcasting result)
          setTimeout(() => {
            if (this._deferredRefresh) {
              log.debug(
                'Cross-tab refresh deferred timed out, proceeding independently',
              );
              this._deferredResolve?.(false);
              this._deferredResolve = undefined;
              this._deferredRefresh = undefined;
            }
          }, AUTH_CONFIG.crossTabRefreshTimeoutMs);
          break;

        case 'refresh-success':
          // Another tab completed refresh successfully. Update this tab's state.
          log.debug('Another tab refreshed successfully, updating state');
          // Accept tokens if logged in OR if a token exchange is pending
          // (Token Exchange mode may have isLoggedIn=false during initial setup)
          if (
            tokens &&
            (this._state.isLoggedIn || this._pendingTokenExchange)
          ) {
            this._state = {
              ...this._state,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken ?? this._state.refreshToken,
              expiresAt: tokens.expiresAt,
            };
            // userId might be undefined in edge cases (e.g., during initial token exchange)
            // Only save tokens if we have a valid userId
            if (this._state.userId) {
              this._saveTokens({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken ?? this._state.refreshToken,
                userId: this._state.userId,
                expiresAt: tokens.expiresAt,
              });
            }
            this._scheduleRefresh(tokens.expiresAt);
            this.host.requestUpdate();
          }
          // Resolve deferred refresh (if this tab was waiting)
          if (this._deferredResolve) {
            this._deferredResolve(true);
            this._deferredResolve = undefined;
            this._deferredRefresh = undefined;
          }
          this._refreshing = undefined;
          this._refreshStartTime = undefined;
          break;

        case 'refresh-failure':
          // Another tab's refresh failed. This tab should also logout.
          log.debug('Another tab refresh failed, clearing _refreshing state');
          // Resolve deferred refresh (if this tab was waiting)
          if (this._deferredResolve) {
            this._deferredResolve(false);
            this._deferredResolve = undefined;
            this._deferredRefresh = undefined;
          }
          this._refreshing = undefined;
          this._refreshStartTime = undefined;
          break;
      }
    };
  }

  /**
   * Broadcast a message to other tabs via BroadcastChannel.
   */
  private _broadcast(message: Record<string, unknown>) {
    if (!this._refreshChannel) return;
    try {
      this._refreshChannel.postMessage({ tabId: this._tabId, ...message });
    } catch (err) {
      log.debug('BroadcastChannel postMessage failed:', err);
    }
  }

  hostConnected() {
    this._boundVisibilityHandler = this._onVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this._boundVisibilityHandler);

    // FIX: Re-schedule refresh timer if logged in but timer was cleared by hostDisconnected()
    // This handles React StrictMode's unmount/remount cycle where:
    // 1. First hostConnected() → timer exists (set by _loadTokens in constructor)
    // 2. hostDisconnected() → clears timer
    // 3. Second hostConnected() → timer missing, need to re-schedule
    if (
      this._state.isLoggedIn &&
      !this._refreshTimer &&
      this._state.expiresAt
    ) {
      this._scheduleRefresh(this._state.expiresAt);
    }

    // If this is a reconnect after a temporary disconnect (StrictMode),
    // re-open the BroadcastChannel that was closed in hostDisconnected().
    // This ensures cross-tab token refresh coordination is restored.
    if (this._isTemporaryDisconnect) {
      log.debug('Reconnecting after temporary disconnect');
      this._isTemporaryDisconnect = false;
      // Re-open BroadcastChannel if not already open
      // (closed synchronously in hostDisconnected to prevent GC leaks)
      if (!this._refreshChannel) {
        this._initBroadcastChannel();
      }
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
   *
   * BroadcastChannel lifecycle:
   * - React StrictMode: The channel is closed synchronously here, but re-opened
   *   in hostConnected() if the host reconnects (handles StrictMode's rapid
   *   unmount/remount cycle).
   * - Permanent disconnect (element removed without destroy()): The channel is
   *   closed synchronously, preventing orphaned message handlers immediately.
   * - Factory destroy(): Calls destroy() which explicitly closes the channel
   *   (idempotent — safe to call multiple times).
   *
   * Why synchronous close instead of queueMicrotask:
   * - The previous microtask-based approach held a closure reference to `this`,
   *   preventing GC if the component was removed before the microtask ran.
   * - Synchronous close eliminates this leak risk entirely.
   * - hostConnected() re-opens the channel if needed (StrictMode remount).
   */
  hostDisconnected() {
    if (this._boundVisibilityHandler) {
      document.removeEventListener(
        'visibilitychange',
        this._boundVisibilityHandler,
      );
      this._boundVisibilityHandler = undefined;
    }
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = undefined;
    }
    // Resolve any pending deferred refresh before marking disconnect
    // (prevents dangling promise if another tab was supposed to resolve it)
    if (this._deferredRefresh) {
      this._deferredResolve?.(false);
      this._deferredResolve = undefined;
      this._deferredRefresh = undefined;
    }
    // Mark as temporary disconnect — hostConnected() will re-open the channel
    // if the host reconnects (React StrictMode's rapid unmount/remount cycle).
    this._isTemporaryDisconnect = true;

    // Close BroadcastChannel synchronously to prevent message handler leaks.
    // If the host reconnects (StrictMode), hostConnected() will re-open it.
    // This is safe because:
    // 1. closeBroadcastChannel() is idempotent (safe to call multiple times)
    // 2. hostConnected() re-initializes the channel if needed
    // 3. No closure reference to `this` is held (unlike the old queueMicrotask approach)
    this.closeBroadcastChannel();
  }

  /**
   * Close the BroadcastChannel and clean up cross-tab coordination state.
   *
   * Called by the factory's destroy() for permanent cleanup. Unlike hostDisconnected
   * (which keeps the channel open for React StrictMode remount), this method
   * unconditionally closes the channel to prevent orphaned message handlers
   * and timers after the element is permanently removed from the DOM.
   *
   * Safe to call multiple times — no-op if the channel is already closed.
   */
  closeBroadcastChannel(): void {
    if (this._refreshChannel) {
      this._refreshChannel.close();
      this._refreshChannel = undefined;
    }
    // Resolve any pending deferred refresh to unblock awaiters
    if (this._deferredRefresh) {
      this._deferredResolve?.(false);
      this._deferredResolve = undefined;
      this._deferredRefresh = undefined;
    }
    this._refreshStartTime = undefined;
  }

  /**
   * Permanently destroy the AuthController and release all resources.
   *
   * This method should be called when the component is permanently removed
   * from the DOM (not just temporarily disconnected for React StrictMode).
   *
   * Cleanup includes:
   * - Closing the BroadcastChannel (prevents message handler leaks)
   * - Clearing all timers (prevents orphaned setTimeout callbacks)
   * - Releasing all provider references (allows GC)
   *
   * Unlike _performLogout(), this does NOT dispatch a logout event or clear
   * localStorage, as the user may still be logged in in other tabs.
   */
  destroy(): void {
    // Close BroadcastChannel (prevents orphaned message handlers)
    this.closeBroadcastChannel();

    // Clear refresh timer (prevents orphaned setTimeout callbacks)
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = undefined;
    }

    // Clear in-flight refresh state
    this._refreshing = undefined;
    this._tokenExchanging = false;
    this._pendingTokenExchange = false;

    // Release provider references (allows GC)
    this._authProvider = undefined;
    this._oauth2Client = undefined;

    // Clear the login callback to prevent closure leaks
    this.onLogin = undefined;
  }

  /**
   * Convenience: trigger login directly on the controller.
   *
   * Note: For Context consumers, login/logout are accessed via `actions.login()`
   * and `actions.logout()` to maintain consistency with other Contexts
   * (SessionContext, ModeContext, etc.).
   *
   * These controller-level methods are for direct callers (demo page, protocol layer)
   * who have a reference to the controller itself, not the Context value.
   * Internally delegates to `_login()`.
   */
  login() {
    this._login();
  }

  /** Convenience: trigger logout directly on the controller. */
  logout() {
    this._logout();
  }

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
    saveDeviceIdToStorage(provider.deviceId);

    // Set initial state based on provider's isLoggedIn()
    const loggedIn = provider.isLoggedIn();

    if (loggedIn) {
      if (this._isTokenExchangeMode) {
        // Token Exchange mode: perform token exchange immediately
        // Fix: Set isLoggedIn: false initially to prevent race conditions where
        // other code checks isLoggedIn before userId is populated from JWT.
        // The state will be updated to isLoggedIn: true after token exchange completes.
        this._pendingTokenExchange = true;
        this._state = {
          isLoggedIn: false, // Will be set to true after token exchange
          accessToken: '', // Will be set by token exchange
          refreshToken: '', // Not used in token exchange mode
          // DO NOT call provider.getUserId() here: in Token Exchange mode, the host
          // app's userId belongs to an external identity system (e.g. admin-ui admin),
          // not to RTC. The real userId will be parsed from the RTC JWT's `sub` claim
          // in _doTokenExchange(). Using the external userId would cause Centrifuge
          // channel permission mismatch and IndexedDB name collisions.
          userId: '',
          expiresAt: Infinity, // Will be set after token exchange
        };
        this.host.requestUpdate();
        void this._performTokenExchange().then((success) => {
          if (this._authProvider !== provider) return;
          this._pendingTokenExchange = false;
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
        this._pendingTokenExchange = true;
        void this._performTokenExchange().then((success) => {
          if (this._authProvider !== provider) return;
          this._pendingTokenExchange = false;
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
        void provider
          .refreshToken()
          .then((result) => {
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
          })
          .catch(() => {
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
   * SECURITY CONSIDERATIONS - Retry Strategy:
   * -----------------------------------------
   * The retry mechanism (max 5 retries, ~31s total wait) intentionally reuses the same
   * external JWT across attempts. This is acceptable because:
   *
   * 1. HTTPS Protection: All communication occurs over TLS, preventing network interception
   *    of the JWT in transit.
   *
   * 2. Server-Side Deduplication: The backend uses the `subject_token` (external JWT) for
   *    idempotency deduplication. Multiple exchanges of the same JWT produce the same result
   *    without creating duplicate sessions or tokens.
   *
   * 3. Short Retry Window: The maximum retry duration (~31 seconds) limits the exposure
   *    window. Even if an attacker intercepts the JWT (which requires breaking TLS), they
   *    can only replay it within this narrow window.
   *
   * 4. JWT Expiration: External JWTs typically have short lifetimes (minutes). By the time
   *    retries complete, the JWT may have expired, limiting replay value.
   *
   * 5. Refresh Path: This retry logic applies to both initial token exchange and refresh.
   *    In the refresh path, a failed exchange triggers logout, preventing indefinite retries.
   *
   * Mitigation for High-Security Deployments:
   * - Implement JWT binding (e.g., cnf claim for DPoP)
   * - Use shorter-lived external JWTs (< 1 minute)
   * - Add server-side rate limiting per subject_token
   *
   * @returns true if exchange succeeded, false otherwise
   */
  private _performTokenExchange(): Promise<boolean> {
    // Use a separate _tokenExchanging flag to prevent concurrent token exchange calls.
    // NOTE: We cannot use _refreshing here because _executeRefreshWithGuard() also sets
    // _refreshing, and the two promises would conflict (inner .finally() clears outer guard).
    if (this._tokenExchanging) {
      return Promise.resolve(false);
    }

    this._tokenExchanging = true;
    // Mark that a token exchange is pending — allows refresh-success handler
    // to accept tokens even when isLoggedIn is false during initial setup
    this._pendingTokenExchange = true;
    return this._doTokenExchange()
      .then((success) => {
        this._pendingTokenExchange = false;
        return success;
      })
      .finally(() => {
        this._tokenExchanging = false;
      });
  }

  /**
   * Perform token exchange with exponential backoff retry.
   *
   * In Token Exchange mode, the host application's external JWT might be temporarily
   * invalid (e.g. still being refreshed). This retry mechanism gives the host app
   * time to obtain a valid token before giving up.
   *
   * Retry schedule: 1s, 2s, 4s, 8s, 16s (max 5 retries, ~31s total wait)
   *
   * SECURITY: Maximum retry limit prevents resource exhaustion attacks. After 5 retries,
   * the operation is aborted and user is logged out. This bounds the maximum wait time
   * and prevents indefinite blocking.
   */
  private static readonly TOKEN_EXCHANGE_MAX_RETRIES = 5;
  private static readonly TOKEN_EXCHANGE_INITIAL_DELAY_MS = 1000;

  private async _doTokenExchange(): Promise<boolean> {
    if (!this._authProvider?.getExchangeToken || !this._oauth2Client) {
      log.error('token_exchange.missing_client');
      return false;
    }

    const maxRetries = AuthController.TOKEN_EXCHANGE_MAX_RETRIES;
    const initialDelay = AuthController.TOKEN_EXCHANGE_INITIAL_DELAY_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = initialDelay * 2 ** (attempt - 1);
        log.info(
          `token_exchange.retry: attempt ${attempt}/${maxRetries}, waiting ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const success = await this._tryTokenExchangeOnce();
      if (success) {
        return true;
      }

      // Check if auth provider was changed during the attempt (e.g. logout/destroy)
      if (!this._authProvider) {
        return false;
      }
    }

    // All retries exhausted — return false to let the caller decide.
    // Do NOT call _performLogout() here: the caller at line ~228 handles logout.
    // Calling it here would cause a double logout (double rtc-auth-logout event dispatch).
    log.error(
      `token_exchange.all_retries_failed: gave up after ${maxRetries} retries`,
    );
    return false;
  }

  /**
   * Single token exchange attempt (no retry).
   *
   * @returns true if exchange succeeded, false otherwise
   */
  private async _tryTokenExchangeOnce(): Promise<boolean> {
    try {
      // Step 1: Get external JWT from host application
      let externalJWT: string;
      try {
        externalJWT = await this._authProvider!.getExchangeToken!();
      } catch (err) {
        log.debug('token_exchange.get_token_failed (will retry):', err);
        return false;
      }

      if (!externalJWT) {
        log.debug('token_exchange.empty_token (will retry)');
        return false;
      }

      // Step 2: Exchange external JWT for RTC JWT
      let response: TokenExchangeResponse;
      try {
        response = await this._oauth2Client!.tokenExchange({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: externalJWT,
          subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
          device_id: this._authProvider!.deviceId,
          device_name: getDeviceName(),
          user_agent: navigator.userAgent,
        });
      } catch (err) {
        log.debug('token_exchange.exchange_failed (will retry):', err);
        return false;
      }

      // Step 3: Parse userId from RTC JWT (not from external auth provider).
      // In Token Exchange mode, the external auth provider's userId (e.g. admin system)
      // is unrelated to the RTC user identity embedded in the RTC JWT's `sub` claim.
      // Using the external userId would cause Centrifuge channel permission mismatch
      // (subscription rejected with "permission denied") and IndexedDB name collisions.
      //
      // DO NOT fall back to authProvider.getUserId() here: that would silently use the
      // wrong identity system again. If the RTC JWT has no `sub`, surface the error
      // immediately so the misconfiguration is visible.
      const rtcUserId = this._parseUserIdFromJwtPayload(response.access_token);
      if (!rtcUserId) {
        log.error(
          'token_exchange.no_sub_in_jwt: RTC JWT does not contain a `sub` claim. ' +
            'Cannot determine RTC userId. Refusing to fall back to authProvider.getUserId() ' +
            'because that would use the external identity system.',
        );
        // FIX: Do NOT call _performLogout() here. The caller (_doTokenExchange) returns
        // false to its caller (setAuthProvider at line ~260), which handles logout.
        // Calling _performLogout() here would cause double logout (double event dispatch).
        return false;
      }
      log.info('token_exchange.parsed_userId_from_jwt:', maskUserID(rtcUserId));

      // Step 4: Update state with RTC JWT
      const expiresAt = Date.now() + response.expires_in * 1000;
      this._state = {
        isLoggedIn: true,
        accessToken: response.access_token,
        refreshToken: '', // Not used in token exchange mode
        userId: rtcUserId,
        expiresAt,
      };

      // Save to localStorage for persistence across page reloads
      this._saveTokens({
        accessToken: response.access_token,
        refreshToken: '',
        userId: rtcUserId,
        expiresAt,
      });

      // Step 5: Schedule refresh
      this._scheduleRefresh(expiresAt);
      this.host.requestUpdate();

      log.info(
        'token_exchange.succeeded, userId:',
        maskUserID(rtcUserId),
        'expires at',
        new Date(expiresAt).toISOString(),
      );
      return true;
    } catch (err) {
      // Unexpected error in single attempt - let retry loop handle it
      log.debug('token_exchange.unexpected_error (will retry):', err);
      return false;
    }
  }

  /**
   * Parse userId from a JWT payload (without signature verification).
   *
   * SECURITY BOUNDARY: This method extracts userId from JWT for local filtering
   * and UI display only. Signature verification is performed by the backend server
   * during Token Exchange. Frontend parsing does NOT establish trust.
   *
   * Used in Token Exchange mode to extract the RTC user identity from the RTC JWT,
   * rather than relying on the external auth provider's userId (which belongs to a
   * different identity system — e.g. admin-ui's admin ID vs RTC's user ID).
   *
   * RTC JWT uses a non-standard `user_id` claim (not the standard `sub`). See
   * server/internal/usecase/token_exchange.go and signer.SignAccessToken().
   *
   * Returns empty string if the JWT is malformed or neither claim is present.
   * Callers MUST check for empty return and handle appropriately (e.g., logout).
   */
  private _parseUserIdFromJwtPayload(token: string): string {
    if (!token) {
      log.warn('_parseUserIdFromJwtPayload: empty token provided');
      return '';
    }
    const payload = parseJwtPayload(token);
    if (!payload) {
      // Enhanced logging: include token prefix for debugging (without exposing full token)
      const tokenPrefix = `${token.substring(0, 20)}...`;
      log.warn(
        '_parseUserIdFromJwtPayload: failed to parse JWT, token prefix:',
        tokenPrefix,
        'Token may be malformed or not a valid JWT format',
      );
      return '';
    }
    // RTC JWT uses `user_id`; fall back to standard `sub` for forward compatibility.
    const userId = payload.user_id ?? payload.sub;
    if (typeof userId !== 'string') {
      log.warn(
        '_parseUserIdFromJwtPayload: user_id/sub claim is not a string, got:',
        typeof userId,
        'Available claims:',
        Object.keys(payload).join(', '),
      );
      return '';
    }
    if (!userId) {
      log.warn('_parseUserIdFromJwtPayload: user_id/sub claim is empty string');
      return '';
    }
    log.debug(
      '_parseUserIdFromJwtPayload: successfully parsed userId from JWT',
    );
    return userId;
  }

  private _login() {
    this.host.requestUpdate();
    // Public event for external consumers (root opens login dialog)
    this.host.dispatchEvent(
      new CustomEvent('rtc-auth-login-requested', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _logout() {
    // Auth provider (Mode 3): delegate logout to the provider
    if (this._authProvider?.logout) {
      void this._authProvider
        .logout()
        .then(() => {
          this._performLogout();
        })
        .catch((error) => {
          log.error('auth_lifecycle.logout_failed:', error);
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
   * - `_refreshChannel`: closed to prevent message handler leaks
   */
  private _performLogout() {
    this._state = { isLoggedIn: false };

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

    // Clear all refresh-related state to prevent orphaned operations
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = undefined;
    }
    this._refreshing = undefined;
    this._refreshStartTime = undefined;
    this._tokenExchanging = false;
    this._pendingTokenExchange = false;
    // Resolve any pending deferred refresh so awaiters are unblocked
    if (this._deferredRefresh) {
      this._deferredResolve?.(false);
      this._deferredResolve = undefined;
      this._deferredRefresh = undefined;
    }
    // Close BroadcastChannel to prevent message handler leaks
    // (hostDisconnected no longer closes it to support StrictMode remount)
    if (this._refreshChannel) {
      this._refreshChannel.close();
      this._refreshChannel = undefined;
    }

    this.host.dispatchEvent(
      new CustomEvent('rtc-auth-logout', { bubbles: true, composed: true }),
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
        void this._executeRefresh(tokens.refreshToken)
          .then((result) => {
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
          })
          .catch((err) => {
            // Guard against unhandled rejection (e.g. localStorage quota exceeded).
            log.error('auth_lifecycle.refresh_rejected:', err);
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
      log.warn('auth_lifecycle.load_failed, clearing:', err);
      localStorage.removeItem(STORAGE_KEYS.tokens);
    }
  }

  /**
   * Save tokens to localStorage with QuotaExceededError handling.
   *
   * SECURITY NOTE (XSS & Token Storage):
   * Tokens are stored in localStorage, which is accessible via JavaScript.
   * This is a deliberate design choice given the component's architecture:
   * - The component runs in an isolated Web Component shadow DOM
   * - DOMPurify sanitizes all user-generated content before rendering
   * - CSP policy (script-src without unsafe-inline) prevents inline script injection
   *
   * Defense-in-depth measures already in place:
   * 1. DOMPurify: All user content is sanitized before DOM insertion
   * 2. CSP: Strict Content-Security-Policy blocks inline scripts and eval()
   * 3. Shadow DOM: Component encapsulation limits attack surface
   *
   * Future enhancement: For higher-security deployments, consider migrating
   * to httpOnly cookies (requires backend coordination for token refresh flow).
   * See: https://owasp.org/www-community/HttpOnly
   */
  private _saveTokens(tokens: StoredTokens) {
    try {
      localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify(tokens));
    } catch (err) {
      // CRITICAL FIX: Handle QuotaExceededError (common on mobile browsers)
      // Attempt to clear residual data and retry once
      log.error('auth.save_failed:', err);
      try {
        localStorage.removeItem(STORAGE_KEYS.tokens);
        localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify(tokens));
        log.info('auth.save_succeeded_after_clear');
      } catch (retryErr) {
        log.error('auth.save_failed_after_retry:', retryErr);
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
    const timeUntilRefresh = Math.max(
      0,
      expiresAt - Date.now() - AUTH_CONFIG.refreshBufferMs,
    );

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${AUTH_CONFIG.serverURL}/oauth2/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        credentials: 'omit', // SECURITY: prevent cookie leakage to cross-origin requests
        signal: controller.signal,
      });

      if (!response.ok) {
        return { success: false };
      }

      let data: Record<string, unknown>;
      try {
        data = await response.json();
      } catch (err) {
        log.warn('Token refresh response body parse failed:', err);
        return { success: false };
      }

      const expiresIn =
        typeof data.expires_in === 'number' ? data.expires_in : 0;
      const accessToken =
        typeof data.access_token === 'string' ? data.access_token : undefined;

      if (!accessToken || !expiresIn) {
        return { success: false };
      }

      const expiresAt = Date.now() + expiresIn * 1000;

      return {
        success: true,
        accessToken,
        expiresAt,
      };
    } catch (error) {
      log.error('Token refresh failed:', error);
      return { success: false };
    } finally {
      clearTimeout(timeoutId);
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
   *
   * Cross-tab coordination via BroadcastChannel:
   * - Broadcasts 'refresh-start' when beginning refresh (allows other tabs to yield)
   * - Broadcasts 'refresh-success' with new tokens on success (other tabs update state)
   * - Broadcasts 'refresh-failure' on failure (other tabs clear their _refreshing state)
   *
   * This prevents multiple tabs from simultaneously refreshing tokens, which can
   * cause race conditions and token invalidation (some servers invalidate refresh
   * tokens after first use).
   */
  private async _executeRefreshWithGuard(): Promise<TokenExpiredAction> {
    const success = await this._withTimeout(
      this._doRefreshWithCoordination(),
      AUTH_CONFIG.tokenRefreshTimeoutMs,
      'Token refresh timeout',
    );
    return success ? 'refresh' : 'relogin';
  }

  /**
   * Coordinate refresh across tabs and handle deferred refresh.
   * Extracted to separate method for clarity.
   */
  private async _doRefreshWithCoordination(): Promise<boolean> {
    // If a refresh is already in-flight, wait for it
    if (this._refreshing) {
      return this._refreshing;
    }

    // Check if another tab is already refreshing (cross-tab coordination).
    // If _deferredRefresh is set, this tab has yielded to another tab via
    // BroadcastChannel. Await the other tab's result instead of starting
    // a redundant refresh.
    if (this._deferredRefresh) {
      log.debug('Waiting for another tab to complete refresh');
      const success = await this._withTimeout(
        this._deferredRefresh,
        AUTH_CONFIG.crossTabRefreshTimeoutMs,
        'Other tab refresh wait timed out, proceeding independently',
      );
      this._deferredRefresh = undefined;
      this._deferredResolve = undefined;
      // If the other tab succeeded, state was already updated by the broadcast handler.
      // If it failed or timed out, fall through to start our own refresh.
      if (success) {
        return true;
      }
      // Other tab failed or timed out — proceed with our own refresh below.
      log.debug('Other tab failed, proceeding with own refresh');
    }

    // Record when this tab started refreshing (for leader election)
    // Add random jitter (0-100ms) to reduce cross-tab tie probability
    this._refreshStartTime = Date.now() + Math.random() * 100;

    // Broadcast to other tabs that this tab is refreshing
    this._broadcast({
      type: 'refresh-start',
      timestamp: this._refreshStartTime,
    });

    this._refreshing = this._doRefreshWithBroadcast();
    try {
      return await this._refreshing;
    } finally {
      this._refreshing = undefined;
      this._refreshStartTime = undefined;
    }
  }

  /**
   * Wrap a promise with a timeout to prevent indefinite hanging.
   *
   * @param promise The promise to wrap
   * @param timeoutMs Timeout in milliseconds
   * @param errorMsg Error message to log on timeout (does not throw)
   * @returns The promise result, or false on timeout
   */
  private async _withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMsg: string,
  ): Promise<T | false> {
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(errorMsg)), timeoutMs),
        ),
      ]);
    } catch (err) {
      if (err instanceof Error && err.message === errorMsg) {
        log.warn(errorMsg);
        return false;
      }
      throw err;
    }
  }

  /**
   * Wrapper around _doRefresh that broadcasts the result to other tabs.
   * Ensures that success/failure messages are always sent, even if _doRefresh throws.
   */
  private async _doRefreshWithBroadcast(): Promise<boolean> {
    try {
      const success = await this._doRefresh();

      if (success) {
        // Broadcast success with new tokens so other tabs can update their state
        this._broadcast({
          type: 'refresh-success',
          tokens: {
            accessToken: this._state.accessToken,
            refreshToken: this._state.refreshToken,
            expiresAt: this._state.expiresAt,
          },
        });
      } else {
        // Broadcast failure so other tabs know to clear their _refreshing state
        this._broadcast({ type: 'refresh-failure' });
      }

      return success;
    } catch (err) {
      // Unexpected error — broadcast failure
      log.error('_doRefresh threw unexpectedly:', err);
      this._broadcast({ type: 'refresh-failure' });
      throw err;
    }
  }

  /**
   * Internal: execute the refresh flow, update state + localStorage.
   * Returns true on success, false on failure.
   */
  private async _doRefresh(): Promise<boolean> {
    // Token Exchange mode: refresh by performing a new token exchange
    if (this._isTokenExchangeMode) {
      const success = await this._performTokenExchange();
      if (!success) {
        // Token exchange failed during refresh — logout to clean up state.
        // This covers the refresh path; the setAuthProvider path has its own
        // _performLogout() in the .then() handler.
        this._performLogout();
      }
      return success;
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
        log.error('auth_lifecycle.refresh_failed:', error);
        return false;
      }
    }

    // Internal auth mode: use the built-in refresh endpoint
    const result = await this._executeRefresh(this._state.refreshToken!);

    if (!result.success) {
      this._logout();
      this.host.dispatchEvent(
        new CustomEvent('rtc-auth-refresh-failed', {
          bubbles: true,
          composed: true,
        }),
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
      const needsRefresh =
        this._state.expiresAt &&
        Date.now() > this._state.expiresAt - AUTH_CONFIG.refreshBufferMs;
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
      }),
    );
    this.onLogin?.();
  }
}
