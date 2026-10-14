// OAuth2 HTTP Client — wraps OAuth2-related HTTP API calls

import type {
  OAuth2AuthorizeResponse,
  OAuth2TokenExchangeResponse,
  OAuth2TokenRefreshResponse,
} from '@rtc-agent/protocol';
import { createLogger } from '@rtc-agent/protocol';
import type { TokenExchangeRequest, TokenExchangeResponse } from './types.js';
import { TokenExchangeError } from './types.js';

const log = createLogger('OAuth2Client');

/**
 * OAuth2 Client configuration options.
 */
export interface OAuth2ClientOptions {
  /** Backend server URL. */
  serverURL: string;
  /** OAuth2 redirect callback URL. */
  redirectUri: string;
  /** Request timeout in milliseconds, defaults to 10000. */
  timeout?: number;
}

/**
 * OAuth2 Providers response.
 */
export interface OAuth2ProvidersResponse {
  providers: string[];
}

/**
 * PKCE (Proof Key for Code Exchange) parameters.
 * RFC 7636: https://datatracker.ietf.org/doc/html/rfc7636
 */
export interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
}

/**
 * Generate a cryptographically random code verifier for PKCE.
 * @returns Base64URL-encoded random string (43-128 characters per RFC 7636)
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = base64UrlEncode(array);

  // Validate length per RFC 7636 Section 4.1: minimum 43 characters, maximum 128 characters
  // 32 bytes base64url-encoded = 43 characters (no padding)
  if (verifier.length < 43 || verifier.length > 128) {
    throw new Error(
      `PKCE code verifier length out of bounds: ${verifier.length} characters (expected 43-128)`
    );
  }

  return verifier;
}

/**
 * Generate code challenge from code verifier using S256 method.
 * @param codeVerifier The code verifier
 * @returns Base64URL-encoded SHA-256 hash
 */
async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Base64URL encode (no padding) - RFC 7636 Section 3
 */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate PKCE parameters for OAuth2 authorization.
 */
export async function generatePKCEParams(): Promise<PKCEParams> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

/**
 * OAuth2 HTTP Client
 *
 * Encapsulates all OAuth2-related HTTP API calls:
 * - Fetch available providers list
 * - Fetch authorization URL
 * - Exchange authorization code for tokens
 * - Refresh access tokens
 */
export class OAuth2Client {
  private readonly serverURL: string;
  private readonly redirectUri: string;
  private readonly timeout: number;

  /** Delay (ms) before retrying a failed token exchange request. */
  private static readonly TOKEN_EXCHANGE_RETRY_DELAY_MS = 1000;

  constructor(options: OAuth2ClientOptions) {
    // SECURITY: Validate required options to prevent misconfiguration
    if (!options.serverURL) {
      throw new Error('OAuth2Client: serverURL is required');
    }
    if (!options.redirectUri) {
      throw new Error('OAuth2Client: redirectUri is required');
    }
    // Validate URL format to prevent SSRF or malformed requests
    try {
      new URL(options.serverURL);
    } catch {
      throw new Error(`OAuth2Client: invalid serverURL format: ${options.serverURL}`);
    }

    this.serverURL = options.serverURL.replace(/\/$/, '');
    this.redirectUri = options.redirectUri;
    this.timeout = options.timeout ?? 10000;
  }

  /**
   * Fetch the list of available OAuth2 providers.
   */
  async getProviders(): Promise<string[]> {
    const resp = await this.fetchWithTimeout('/oauth2/providers');
    const data = (await resp.json()) as OAuth2ProvidersResponse;
    return data.providers;
  }

  /**
   * Fetch the OAuth2 authorization URL with PKCE support.
   *
   * SECURITY: The `state` parameter is generated and validated by the caller (e.g., AuthProvider).
   * This client only forwards the state to the server; it does not store or verify it.
   * The server validates state via Redis + Lua GetDel to prevent replay attacks.
   *
   * @param provider Provider name (e.g. 'github', 'google', 'mock')
   * @param pkce PKCE parameters (code_challenge and code_challenge_method)
   * @returns Response containing redirect_url and state
   */
  async getAuthorizationUrl(
    provider: string,
    pkce: PKCEParams,
  ): Promise<OAuth2AuthorizeResponse> {
    const params = new URLSearchParams({
      provider,
      redirect_uri: this.redirectUri,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
    });
    const resp = await this.fetchWithTimeout(`/oauth2/authorize?${params}`);
    return (await resp.json()) as OAuth2AuthorizeResponse;
  }

  /**
   * Exchange an authorization code for tokens with PKCE verification.
   *
   * @param code Authorization code
   * @param state CSRF state token (for verification)
   * @param codeVerifier PKCE code verifier (must match the code_challenge from authorization)
   * @param deviceId Device ID (optional)
   * @param deviceName Device name (optional)
   * @param userAgent User agent string (optional)
   * @returns Token response
   */
  async exchangeToken(
    code: string,
    state: string,
    codeVerifier: string,
    deviceId?: string,
    deviceName?: string,
    userAgent?: string,
  ): Promise<OAuth2TokenExchangeResponse> {
    const body = {
      code,
      state,
      redirect_uri: this.redirectUri,
      code_verifier: codeVerifier,
      device_id: deviceId ?? '',
      device_name: deviceName,
      user_agent: userAgent,
    };

    const resp = await this.fetchWithTimeout('/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await resp.json()) as OAuth2TokenExchangeResponse;
  }

  /**
   * Refresh the access token.
   *
   * @param refreshToken Refresh token
   * @returns New access token response
   */
  async refreshToken(
    refreshToken: string,
  ): Promise<OAuth2TokenRefreshResponse> {
    const resp = await this.fetchWithTimeout('/oauth2/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return (await resp.json()) as OAuth2TokenRefreshResponse;
  }

  /**
   * Exchange an external JWT for an RTC JWT using OAuth2 Token Exchange (RFC 8693).
   *
   * Used in Token Exchange mode: the host application provides an external JWT
   * (e.g. from its own identity provider), which is exchanged for an RTC JWT
   * that can be used for WebSocket connection.
   *
   * Retry strategy: Up to 1 retry (2 total attempts) with 1s delay on 502, 503, 504, 429 (network errors).
   * 4xx errors are NOT retried (client error, not transient).
   *
   * SECURITY: Retry limit is intentionally low (max 1 retry) to prevent resource exhaustion
   * attacks. If the external JWT is invalid or expired, retries would waste resources;
   * the caller should handle the error and prompt the user to re-authenticate.
   *
   * @param params Token exchange request parameters
   * @returns Token exchange response with RTC JWT
   * @throws TokenExchangeError if the exchange fails
   * @example
   * ```ts
   * const response = await oauth2Client.tokenExchange({
   *   grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
   *   subject_token: externalJWT,
   *   subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
   *   device_id: 'device-uuid',
   * });
   * ```
   */
  async tokenExchange(
    params: TokenExchangeRequest,
  ): Promise<TokenExchangeResponse> {
    // Build form-encoded body (application/x-www-form-urlencoded per OAuth2 spec)
    const body = new URLSearchParams();
    body.append('grant_type', params.grant_type);
    body.append('subject_token', params.subject_token);
    body.append('subject_token_type', params.subject_token_type);
    // SECURITY: Only append device_id if explicitly provided to avoid sending empty values
    if (params.device_id) {
      body.append('device_id', params.device_id);
    }
    if (params.device_name) {
      body.append('device_name', params.device_name);
    }
    if (params.user_agent) {
      body.append('user_agent', params.user_agent);
    }

    const url = `${this.serverURL}/oauth2/token`;
    const maxRetries = 1;

    return this.executeWithRetry(url, body, maxRetries);
  }

  /**
   * Execute a token exchange request with retry logic.
   *
   * Extracted to a separate method to avoid code duplication between
   * HTTP error retries and network error retries.
   *
   * NOTE: The `body` parameter (URLSearchParams) is reused across retry attempts.
   * This is safe because:
   * 1. URLSearchParams.toString() is a read-only operation — it does not mutate the object.
   * 2. Token exchange is an idempotent operation (RFC 8693) — the same request body
   *    produces the same result, so retries do not cause duplicate side effects.
   * 3. The server uses the `subject_token` for idempotency deduplication.
   *
   * @param url Target URL
   * @param body Form-encoded request body (URLSearchParams, safe to reuse)
   * @param maxRetries Maximum number of retry attempts
   * @returns Token exchange response
   * @throws TokenExchangeError if all attempts fail
   */
  private async executeWithRetry(
    url: string,
    body: URLSearchParams,
    maxRetries: number,
  ): Promise<TokenExchangeResponse> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          credentials: 'omit', // SECURITY: prevent cookie leakage to cross-origin requests
          signal: controller.signal,
        });

        if (!resp.ok) {
          const statusCode = resp.status;

          // Check if this is a retryable error (502, 503, 504, 429)
          const isRetryable =
            statusCode === 502 ||
            statusCode === 503 ||
            statusCode === 504 ||
            statusCode === 429;

          if (isRetryable && attempt < maxRetries) {
            await this.retryWithBackoff(attempt, maxRetries, statusCode);
            continue;
          }

          // Non-retryable error or final attempt - throw
          throw new TokenExchangeError(
            statusCode,
            `Token exchange failed: ${statusCode} ${resp.statusText || 'Request failed'}`,
          );
        }

        return (await resp.json()) as TokenExchangeResponse;
      } catch (err) {
        // Re-throw TokenExchangeError as-is (HTTP errors already handled above)
        if (err instanceof TokenExchangeError) {
          throw err;
        }

        // Network errors (fetch failures, AbortError) are retryable — they indicate
        // transient connectivity issues, not client errors.
        if (attempt < maxRetries) {
          await this.retryWithBackoff(attempt, maxRetries, 0, err);
          continue;
        }

        throw new TokenExchangeError(
          0,
          `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Should never reach here, but satisfy TypeScript
    throw new TokenExchangeError(
      0,
      'Token exchange failed: max retries exceeded',
    );
  }

  /**
   * Wait before retrying with exponential backoff and jitter.
   *
   * @param attempt Current attempt number (0-based)
   * @param maxRetries Maximum retry attempts (for logging)
   * @param statusCode HTTP status code (0 for network errors)
   * @param err Original error (for network errors)
   */
  private async retryWithBackoff(
    attempt: number,
    maxRetries: number,
    statusCode: number,
    err?: unknown,
  ): Promise<void> {
    // Exponential backoff with jitter to prevent thundering herd
    // Base delay: 1000ms, multiplier: 2^attempt (1000ms, 2000ms, 4000ms, ...)
    // Add random jitter (0-500ms) to distribute retry attempts
    const baseDelay = OAuth2Client.TOKEN_EXCHANGE_RETRY_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 500;
    const retryDelay = baseDelay + jitter;

    if (statusCode > 0) {
      log.debug(
        `tokenExchange: retryable error ${statusCode}, ` +
        `attempt ${attempt + 1}/${maxRetries + 1}, ` +
        `retrying in ${Math.round(retryDelay)}ms`
      );
    } else {
      log.debug(
        `tokenExchange: network error, ` +
        `attempt ${attempt + 1}/${maxRetries + 1}, ` +
        `retrying in ${Math.round(retryDelay)}ms`,
        err instanceof Error ? err.message : String(err)
      );
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  /**
   * Fetch wrapper with timeout support via AbortController.
   */
  private async fetchWithTimeout(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const url = `${this.serverURL}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, {
        ...init,
        credentials: 'omit', // SECURITY: prevent cookie leakage to cross-origin requests
        signal: controller.signal,
      });

      if (!resp.ok) {
        // SECURITY: Only include HTTP status code in error message to avoid leaking
        // sensitive server response details (internal paths, database errors, etc.).
        // This prevents information disclosure attacks.
        //
        // Log detailed error information for diagnostics. This is safe because:
        // 1. We're already in an error path (performance is not critical)
        // 2. The error body is only logged, not exposed to the caller
        // 3. Debug logging is typically disabled in production
        const errorBody = await resp.text().catch(() => 'Unknown');
        log.debug('OAuth2 API error details:', errorBody);
        throw new Error(`OAuth2 API error ${resp.status}`);
      }

      return resp;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
