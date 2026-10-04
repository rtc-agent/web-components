// OAuth2 HTTP Client — wraps OAuth2-related HTTP API calls

import type {
  OAuth2AuthorizeResponse,
  OAuth2TokenExchangeResponse,
  OAuth2TokenRefreshResponse,
} from '@rtc-agent/protocol';
import type { TokenExchangeRequest, TokenExchangeResponse } from './types.js';
import { TokenExchangeError } from './types.js';

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
 * @returns Base64URL-encoded random string (43-128 characters)
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
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

  constructor(options: OAuth2ClientOptions) {
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
  async refreshToken(refreshToken: string): Promise<OAuth2TokenRefreshResponse> {
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
   * Retry strategy: 1 retry with 1s delay on 502, 503, 504, 429 (network errors).
   * 4xx errors are NOT retried (client error, not transient).
   *
   * @param params Token exchange request parameters
   * @returns Token exchange response with RTC JWT
   * @throws TokenExchangeError if the exchange fails
   * @example
   * ```ts
   * const response = await oauth2Client.tokenExchange({
   *   grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
   *   subject_token: externalJWT,
   *   subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
   *   device_id: 'device-uuid',
   * });
   * ```
   */
  async tokenExchange(params: TokenExchangeRequest): Promise<TokenExchangeResponse> {
    // Build form-encoded body (application/x-www-form-urlencoded per OAuth2 spec)
    const body = new URLSearchParams();
    body.append('grant_type', params.grant_type);
    body.append('subject_token', params.subject_token);
    body.append('subject_token_type', params.subject_token_type);
    body.append('device_id', params.device_id);
    if (params.device_name) {
      body.append('device_name', params.device_name);
    }
    if (params.user_agent) {
      body.append('user_agent', params.user_agent);
    }

    const url = `${this.serverURL}/oauth2/token`;
    const maxRetries = 1;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const statusCode = resp.status;

          // Check if this is a retryable error (502, 503, 504, 429)
          const isRetryable = statusCode === 502 || statusCode === 503 ||
                              statusCode === 504 || statusCode === 429;

          if (isRetryable && attempt < maxRetries) {
            // Retry after 1 second delay
            await new Promise(resolve => setTimeout(resolve, 1000));
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
        // Re-throw TokenExchangeError as-is
        if (err instanceof TokenExchangeError) {
          throw err;
        }

        // Network errors or abort errors are not retryable
        throw new TokenExchangeError(
          0,
          `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Should never reach here, but satisfy TypeScript
    throw new TokenExchangeError(0, 'Token exchange failed: max retries exceeded');
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
        signal: controller.signal,
      });

      if (!resp.ok) {
        // Only include HTTP status code in error message to avoid leaking sensitive server response details
        throw new Error(`OAuth2 API error ${resp.status}: ${resp.statusText || 'Request failed'}`);
      }

      return resp;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
