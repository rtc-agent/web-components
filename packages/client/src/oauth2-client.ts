// OAuth2 HTTP Client — wraps OAuth2-related HTTP API calls

import type {
  OAuth2AuthorizeResponse,
  OAuth2TokenExchangeResponse,
  OAuth2TokenRefreshResponse,
} from '@rtc-agent/protocol';

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
