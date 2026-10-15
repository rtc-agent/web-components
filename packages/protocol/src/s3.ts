/**
 * S3 Object Storage Types
 *
 * Type definitions for S3-compatible object storage operations.
 * Provides interfaces for temporary credentials and presigned URL generation.
 *
 * These types are used for:
 * - Obtaining temporary S3 credentials via STS (Security Token Service)
 * - Generating presigned URLs for direct client-to-S3 uploads/downloads
 *
 * @see {@link TemporaryCredentialsResponse} - Response from temporary credentials endpoint
 * @see {@link PresignedUrlRequest} - Request body for presigned URL generation
 * @see {@link PresignedUrlResponse} - Response containing the presigned URL
 */

/**
 * Response from the temporary S3 credentials endpoint.
 *
 * POST /api/credentials/temporary
 *
 * Contains temporary AWS credentials that can be used to access S3 directly.
 * These credentials are short-lived and should be refreshed before expiration.
 *
 * @remarks
 * The session_token must be included in the S3 SDK configuration when using
 * these credentials. The credentials expire at the time specified by expires_at.
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/credentials/temporary', { method: 'POST' });
 * const creds: TemporaryCredentialsResponse = await response.json();
 *
 * const s3Client = new S3Client({
 *   region: 'us-east-1',
 *   credentials: {
 *     accessKeyId: creds.access_key_id,
 *     secretAccessKey: creds.secret_access_key,
 *     sessionToken: creds.session_token,
 *   },
 * });
 * ```
 */
export interface TemporaryCredentialsResponse {
  /** Temporary access key ID for S3 authentication */
  access_key_id: string;
  /** Temporary secret access key for S3 authentication */
  secret_access_key: string;
  /**
   * Session token that must be included in SDK configuration.
   * Required when using temporary credentials from STS.
   */
  session_token: string;
  /**
   * Credential expiration time in UTC (RFC 3339 format).
   * Credentials should be refreshed before this time.
   * @example "2024-12-31T23:59:59Z"
   */
  expires_at: string;
}

/**
 * Request body for generating a presigned URL.
 *
 * POST /api/presigned-url
 *
 * Presigned URLs allow clients to upload to or download from S3 directly
 * without needing AWS credentials. The URL is time-limited and operation-specific.
 *
 * @remarks
 * - The `key` should include the user ID prefix for proper authorization
 * - Maximum expiration is 7 days (604800 seconds)
 * - The `put` operation is for uploads, `get` is for downloads
 *
 * @example
 * ```typescript
 * // Generate upload URL
 * const uploadReq: PresignedUrlRequest = {
 *   operation: 'put',
 *   key: 'user-123/uploads/document.pdf',
 *   expires_in: 3600, // 1 hour
 * };
 *
 * // Generate download URL
 * const downloadReq: PresignedUrlRequest = {
 *   operation: 'get',
 *   key: 'user-123/uploads/document.pdf',
 * };
 * ```
 */
export interface PresignedUrlRequest {
  /**
   * The operation type for the presigned URL.
   * - `put`: Generate URL for uploading an object
   * - `get`: Generate URL for downloading an object
   */
  operation: 'put' | 'get';
  /**
   * The S3 object key (path).
   * Should include user ID prefix for authorization.
   * @example "user-123/uploads/document.pdf"
   */
  key: string;
  /**
   * URL validity period in seconds.
   * @default 3600 (1 hour)
   * @maximum 604800 (7 days)
   */
  expires_in?: number;
}

/**
 * Response containing the generated presigned URL.
 *
 * The URL can be used directly by clients to upload or download objects
 * from S3 without additional authentication.
 *
 * @remarks
 * The URL expires at the time specified by expires_at. After expiration,
 * a new presigned URL must be generated.
 *
 * @example
 * ```typescript
 * const response: PresignedUrlResponse = await generatePresignedUrl(request);
 *
 * // Upload file directly to S3
 * await fetch(response.url, {
 *   method: 'PUT',
 *   body: fileData,
 *   headers: { 'Content-Type': 'application/pdf' },
 * });
 * ```
 */
export interface PresignedUrlResponse {
  /**
   * The presigned URL for S3 operations.
   * Contains authentication parameters in the query string.
   */
  url: string;
  /**
   * URL expiration time in UTC (RFC 3339 format).
   * After this time, the URL will no longer be valid.
   * @example "2024-12-31T23:59:59Z"
   */
  expires_at: string;
}
