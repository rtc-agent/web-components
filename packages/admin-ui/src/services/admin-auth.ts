/**
 * Admin Authentication Service
 *
 * All APIs in this file are REAL backend endpoints (proxied to Go backend in dev).
 * Mock implementations are NOT provided for these endpoints.
 *
 * For mock/test endpoints (e.g., /api/500, /api/404), see mock/user.ts.
 */

import { request } from '@umijs/max';
import type { RoleInfo, PermissionInfo, UserInfo } from './types';

export type { RoleInfo, PermissionInfo, UserInfo };

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

/** 获取登录配置 */
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
  /** Refresh token expiration time in seconds (optional, backend dependent) */
  refresh_token_expires_in?: number;
  token_type: string;
  user: UserInfo;
}

/** 刷新 Token 响应 */
export interface RefreshTokenResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in?: number; // Refresh token 过期时间（秒），可选字段
  token_type: string;
}

/**
 * 管理员登录
 * POST /api/auth/login
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
 */
export async function loginWithOTP(body: OTPLoginParams, options?: AuthRequestOptions) {
  return request<LoginResult>('/api/auth/login/otp', {
    method: 'POST',
    data: body,
    ...(options || {}),
  });
}
