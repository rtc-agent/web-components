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
  serverUrl: string;
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
 * OAuth2 HTTP Client
 *
 * Encapsulates all OAuth2-related HTTP API calls:
 * - Fetch available providers list
 * - Fetch authorization URL
 * - Exchange authorization code for tokens
 * - Refresh access tokens
 */
export class OAuth2Client {
  private readonly serverUrl: string;
  private readonly redirectUri: string;
  private readonly timeout: number;

  constructor(options: OAuth2ClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
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
   * Fetch the OAuth2 authorization URL.
   *
   * @param provider Provider name (e.g. 'github', 'google', 'mock')
   * @returns Response containing redirect_url and state
   */
  async getAuthorizationUrl(provider: string): Promise<OAuth2AuthorizeResponse> {
    const params = new URLSearchParams({
      provider,
      redirect_uri: this.redirectUri,
    });
    const resp = await this.fetchWithTimeout(`/oauth2/authorize?${params}`);
    return (await resp.json()) as OAuth2AuthorizeResponse;
  }

  /**
   * Exchange an authorization code for tokens.
   *
   * @param code Authorization code
   * @param state CSRF state token (for verification)
   * @param deviceId Device ID (optional)
   * @param deviceName Device name (optional)
   * @param userAgent User agent string (optional)
   * @returns Token response
   */
  async exchangeToken(
    code: string,
    state: string,
    deviceId?: string,
    deviceName?: string,
    userAgent?: string,
  ): Promise<OAuth2TokenExchangeResponse> {
    const body = {
      code,
      state,
      redirect_uri: this.redirectUri,
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
    const url = `${this.serverUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => 'Unknown error');
        throw new Error(`OAuth2 API error ${resp.status}: ${errorText}`);
      }

      return resp;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
