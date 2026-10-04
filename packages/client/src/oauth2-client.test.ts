import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuth2Client } from './oauth2-client.js';
import { TokenExchangeError } from './types.js';
import type { TokenExchangeRequest } from './types.js';

/**
 * Test suite for OAuth2Client.tokenExchange() method.
 *
 * Tests Token Exchange flow (RFC 8693):
 * - Normal flow with form-encoded request
 * - Error handling with HTTP status codes
 * - Retry strategy for transient errors (502, 503, 504, 429)
 * - No retry for client errors (4xx)
 */
describe('OAuth2Client.tokenExchange', () => {
  let client: OAuth2Client;
  const serverURL = 'https://api.example.com';
  const redirectUri = 'https://example.com/callback';

  beforeEach(() => {
    client = new OAuth2Client({ serverURL, redirectUri });
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createExchangeParams = (): TokenExchangeRequest => ({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: 'external-jwt-token',
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    device_id: 'device-uuid-123',
    device_name: 'Test Device',
    user_agent: 'TestAgent/1.0',
  });

  const createSuccessResponse = () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({
      access_token: 'rtc-jwt-token',
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      expires_in: 3600,
    }),
  });

  it('should exchange external JWT for RTC JWT successfully', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch).mockResolvedValueOnce(createSuccessResponse() as Response);

    const result = await client.tokenExchange(params);

    expect(result.access_token).toBe('rtc-jwt-token');
    expect(result.issued_token_type).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(3600);

    // Verify the request was made with form-encoded body
    expect(fetch).toHaveBeenCalledWith(
      `${serverURL}/oauth2/token`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    // Verify body contains required parameters
    const call = vi.mocked(fetch).mock.calls[0];
    const body = call[1]?.body as string;
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange');
    expect(body).toContain('subject_token=external-jwt-token');
    expect(body).toContain('subject_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Ajwt');
    expect(body).toContain('device_id=device-uuid-123');
    expect(body).toContain('device_name=Test+Device');
    expect(body).toContain('user_agent=TestAgent%2F1.0');
  });

  it('should throw TokenExchangeError on 4xx error without retry', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    } as Response);

    await expect(client.tokenExchange(params)).rejects.toThrow(TokenExchangeError);

    // Verify only one attempt (no retry for 4xx)
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should throw TokenExchangeError on 401 without retry', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(client.tokenExchange(params)).rejects.toThrow(TokenExchangeError);

    // Verify only one attempt (no retry for 4xx)
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should retry once on 502 and succeed', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      } as Response)
      .mockResolvedValueOnce(createSuccessResponse() as Response);

    const result = await client.tokenExchange(params);

    expect(result.access_token).toBe('rtc-jwt-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should retry once on 503 and succeed', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response)
      .mockResolvedValueOnce(createSuccessResponse() as Response);

    const result = await client.tokenExchange(params);

    expect(result.access_token).toBe('rtc-jwt-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should retry once on 504 and succeed', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        statusText: 'Gateway Timeout',
      } as Response)
      .mockResolvedValueOnce(createSuccessResponse() as Response);

    const result = await client.tokenExchange(params);

    expect(result.access_token).toBe('rtc-jwt-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should retry once on 429 and succeed', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response)
      .mockResolvedValueOnce(createSuccessResponse() as Response);

    const result = await client.tokenExchange(params);

    expect(result.access_token).toBe('rtc-jwt-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw after retry fails on 502', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    } as Response);

    await expect(client.tokenExchange(params)).rejects.toThrow(TokenExchangeError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should handle network errors without retry', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    await expect(client.tokenExchange(params)).rejects.toThrow(TokenExchangeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should handle optional parameters correctly', async () => {
    const params: TokenExchangeRequest = {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'external-jwt-token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      device_id: 'device-uuid-123',
      // device_name and user_agent are optional
    };
    vi.mocked(fetch).mockResolvedValueOnce(createSuccessResponse() as Response);

    await client.tokenExchange(params);

    // Verify body does not contain optional params when not provided
    const call = vi.mocked(fetch).mock.calls[0];
    const body = call[1]?.body as string;
    expect(body).not.toContain('device_name');
    expect(body).not.toContain('user_agent');
  });

  it('should use correct endpoint URL', async () => {
    const params = createExchangeParams();
    vi.mocked(fetch).mockResolvedValueOnce(createSuccessResponse() as Response);

    await client.tokenExchange(params);

    expect(fetch).toHaveBeenCalledWith(
      `${serverURL}/oauth2/token`,
      expect.any(Object),
    );
  });
});
