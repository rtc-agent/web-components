import { request } from '@umijs/max';

/** 登录请求参数 */
export interface LoginParams {
  email: string;
  password: string;
}

/** 登录响应 */
export interface LoginResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: {
    id: string;
    email: string;
    name: string;
    avatar_url?: string;
  };
}

/** 刷新 Token 响应 */
export interface RefreshTokenResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/** 用户信息 */
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
}

/**
 * 用户登录
 * POST /api/auth/login
 */
export async function login(body: LoginParams, options?: { [key: string]: any }) {
  return request<LoginResult>('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/**
 * 刷新 Token
 * POST /api/auth/refresh
 */
export async function refreshToken(body: { refresh_token: string }, options?: { [key: string]: any }) {
  return request<RefreshTokenResult>('/api/auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/**
 * 获取当前用户信息
 * GET /api/auth/me
 */
export async function getCurrentUser(options?: { [key: string]: any }) {
  return request<UserInfo>('/api/auth/me', {
    method: 'GET',
    ...(options || {}),
  });
}

/**
 * 登出
 * POST /api/auth/logout
 */
export async function logout(body: { refresh_token: string }, options?: { [key: string]: any }) {
  return request<{ status: string }>('/api/auth/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
