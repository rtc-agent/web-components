// S3 对象存储相关类型定义

/**
 * 临时 S3 凭证响应
 * POST /api/credentials/temporary
 */
export interface TemporaryCredentialsResponse {
  /** 临时访问密钥 ID */
  access_key_id: string;
  /** 临时访问密钥 Secret */
  secret_access_key: string;
  /** 会话令牌（必须包含在 SDK 配置中） */
  session_token: string;
  /** 凭证过期时间（UTC，RFC 3339 格式） */
  expires_at: string;
}

/**
 * Presigned URL 请求
 * POST /api/presigned-url
 */
export interface PresignedUrlRequest {
  /** 操作类型 */
  operation: 'put' | 'get';
  /** 对象键（包含用户 ID 前缀） */
  key: string;
  /** 有效期（秒），默认 3600，最大 604800（7 天） */
  expires_in?: number;
}

/**
 * Presigned URL 响应
 */
export interface PresignedUrlResponse {
  /** 预签名 URL */
  url: string;
  /** URL 过期时间（UTC，RFC 3339 格式） */
  expires_at: string;
}
