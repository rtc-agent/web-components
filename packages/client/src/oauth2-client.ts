// OAuth2 HTTP Client — 封装 OAuth2 相关的 HTTP API 调用

import type {
  OAuth2AuthorizeResponse,
  OAuth2TokenExchangeResponse,
  OAuth2TokenRefreshResponse,
} from '@rtc-agent/protocol';

/**
 * OAuth2 Client 配置选项
 */
export interface OAuth2ClientOptions {
  /** 后端服务器 URL */
  serverUrl: string;
  /** OAuth2 回调地址 */
  redirectUri: string;
  /** 请求超时时间（毫秒），默认 10000 */
  timeout?: number;
}

/**
 * OAuth2 Providers 响应
 */
export interface OAuth2ProvidersResponse {
  providers: string[];
}

/**
 * OAuth2 HTTP Client
 *
 * 封装所有 OAuth2 相关的 HTTP API 调用，包括：
 * - 获取可用 providers 列表
 * - 获取授权 URL
 * - 用授权码换取 token
 * - 刷新 token
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
   * 获取可用的 OAuth2 providers 列表
   */
  async getProviders(): Promise<string[]> {
    const resp = await this.fetchWithTimeout('/oauth2/providers');
    const data = (await resp.json()) as OAuth2ProvidersResponse;
    return data.providers;
  }

  /**
   * 获取 OAuth2 授权 URL
   *
   * @param provider Provider 名称（如 'github', 'google', 'mock'）
   * @returns 包含 redirect_url 和 state 的响应
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
   * 用授权码换取 token
   *
   * @param code 授权码
   * @param state CSRF state（用于验证）
   * @param deviceId 设备 ID（可选）
   * @param deviceName 设备名称（可选）
   * @param userAgent User Agent（可选）
   * @returns Token 响应
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
   * 刷新 access token
   *
   * @param refreshToken Refresh token
   * @returns 新的 access token 响应
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
   * 带超时的 fetch 封装
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
