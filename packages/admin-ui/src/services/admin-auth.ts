/**
 * Admin Authentication Service
 *
 * All APIs in this file are REAL backend endpoints (proxied to Go backend in dev).
 * Mock implementations are NOT provided for these endpoints.
 *
 * For mock/test endpoints (e.g., /api/500, /api/404), see mock/user.ts.
 */

import { request } from '@umijs/max';
import type { RoleInfo } from './role';
import type { PermissionInfo } from './permission';

/** Authenticated admin user information */
export interface UserInfo {
  /** Unique user identifier */
  id: string;
  /** Admin email address (used for login) */
  email: string;
  /** Display name */
  name: string;
  /** URL to avatar image */
  avatar_url?: string;
  /**
   * Roles assigned to this admin.
   * Returned by: GET /api/auth/me, GET /api/auth/login (in user field)
   * Not returned by: lightweight endpoints that only need basic user info
   */
  roles?: RoleInfo[];
  /**
   * Aggregated permissions from all assigned roles.
   *
   * NOTE: This field is NOT returned by the backend API directly.
   * It is computed client-side by fetchAndBuildCurrentUser() in utils/user-utils.ts
   * after fetching roles. Do not expect this field in raw API responses.
   *
   * Returned by: GET /api/auth/me (after client-side role resolution)
   * Note: This is a computed field based on roles, not stored directly.
   * If roles change, permissions will be recalculated on next auth request.
   */
  permissions?: PermissionInfo[];
}

export type { RoleInfo, PermissionInfo };

/** Request options for auth service functions */
interface AuthRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/** 登录配置 */
export interface LoginConfig {
  password_enabled: boolean;
  otp_enabled: boolean;
}

/**
 * 获取登录配置
 * GET /api/auth/config
 *
 * @returns Promise<LoginConfig> 登录配置（密码启用状态、OTP 启用状态）
 */
export async function getLoginConfig() {
  return request<LoginConfig>('/api/auth/config', {
    method: 'GET',
  });
}

/** 登录请求参数 */
export interface LoginParams {
  email: string;
  password: string;
}

/** 登录响应 */
export interface LoginResult {
  access_token: string;
  refresh_token: string;
  /** Access token expiration time in seconds */
  expires_in: number;
  /**
   * Refresh token expiration time in seconds.
   * @deprecated Not returned by backend API per OpenAPI spec.
   * Client code uses DEFAULT_REFRESH_TOKEN_EXPIRY fallback in auth-storage.ts.
   * Will be removed in future cleanup.
   */
  refresh_token_expires_in?: number;
  token_type: string;
  user: UserInfo;
}

/** 刷新 Token 响应 */
export interface RefreshTokenResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /**
   * Refresh token expiration time in seconds.
   * @deprecated Not returned by backend API per OpenAPI spec.
   * Client code uses DEFAULT_REFRESH_TOKEN_EXPIRY fallback in auth-storage.ts.
   * Will be removed in future cleanup.
   */
  refresh_token_expires_in?: number;
  token_type: string;
}

/**
 * 管理员登录
 * POST /api/auth/login
 *
 * @param body - 登录凭证（邮箱、密码）
 * @param options - 请求选项（可选）
 * @returns Promise<LoginResult> 登录结果（包含 token 和用户信息）
 */
export async function login(body: LoginParams, options?: AuthRequestOptions) {
  return request<LoginResult>('/api/auth/login', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}

/**
 * 刷新 Token
 * POST /api/auth/refresh
 *
 * @param body - 刷新请求（包含 refresh_token）
 * @param options - 请求选项（可选）
 * @returns Promise<RefreshTokenResult> 新的 token 信息
 */
export async function refreshToken(body: { refresh_token: string }, options?: AuthRequestOptions) {
  return request<RefreshTokenResult>('/api/auth/refresh', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}

/**
 * 获取当前管理员信息
 * GET /api/auth/me
 *
 * @param options - 请求选项（可选）
 * @returns Promise<UserInfo> 当前管理员的详细信息（包含角色和权限）
 */
export async function getCurrentUser(options?: AuthRequestOptions) {
  return request<UserInfo>('/api/auth/me', {
    method: 'GET',
    ...(options || {}),
  });
}

/**
 * 登出
 * POST /api/auth/logout
 *
 * @param body - 登出请求（包含 refresh_token 用于服务端失效）
 * @param options - 请求选项（可选）
 * @returns Promise<{ status: string }> 登出状态
 */
export async function logout(body: { refresh_token: string }, options?: AuthRequestOptions) {
  return request<{ status: string }>('/api/auth/logout', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}

/** 发送邮箱验证码请求参数 */
export interface SendOTPParams {
  email: string;
}

/** 发送邮箱验证码响应 */
export interface SendOTPResult {
  message: string;
}

/** 邮箱验证码登录请求参数 */
export interface OTPLoginParams {
  email: string;
  otp: string;
}

/**
 * 发送邮箱验证码
 * POST /api/auth/otp/send
 *
 * @param body - 发送请求（包含目标邮箱）
 * @param options - 请求选项（可选）
 * @returns Promise<SendOTPResult> 发送结果
 */
export async function sendEmailOTP(body: SendOTPParams, options?: AuthRequestOptions) {
  return request<SendOTPResult>('/api/auth/otp/send', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}

/**
 * 邮箱验证码登录
 * POST /api/auth/login/otp
 *
 * @param body - 登录请求（包含邮箱和验证码）
 * @param options - 请求选项（可选）
 * @returns Promise<LoginResult> 登录结果（包含 token 和用户信息）
 */
export async function loginWithOTP(body: OTPLoginParams, options?: AuthRequestOptions) {
  return request<LoginResult>('/api/auth/login/otp', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}
