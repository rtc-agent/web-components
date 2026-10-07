import { request } from '@umijs/max';

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

/** 管理员角色信息 */
export interface RoleInfo {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  is_system?: boolean;
  is_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** 权限信息 */
export interface PermissionInfo {
  resource: string;
  action: string;
}

/** 管理员信息 */
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  roles?: RoleInfo[];
  permissions?: PermissionInfo[];
}

/**
 * 管理员登录
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
 * 获取当前管理员信息
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
export async function sendEmailOTP(body: SendOTPParams, options?: { [key: string]: any }) {
  return request<SendOTPResult>('/api/auth/otp/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/**
 * 邮箱验证码登录
 * POST /api/auth/login/otp
 */
export async function loginWithOTP(body: OTPLoginParams, options?: { [key: string]: any }) {
  return request<LoginResult>('/api/auth/login/otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
