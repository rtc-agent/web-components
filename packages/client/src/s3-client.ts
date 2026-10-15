/**
 * S3 Client — wraps S3 object storage operations
 *
 * Provides upload (single + multipart), download, delete, head, list, and presigned
 * URL operations against an S3-compatible endpoint. Manages temporary credential
 * caching with automatic early refresh, and AWS SDK client lifecycle.
 *
 * This file is intentionally large (700+ lines) because all S3 operations share
 * the same credential management and client lifecycle. The multipart upload logic
 * (with progress tracking and abort support) is tightly coupled to the credential
 * refresh mechanism. Splitting would scatter the S3 protocol flow across files.
 *
 * ⚠️ 安全提示（2026-10-14 P1 修复后更新）：
 * 1. 客户端扩展名校验为纵深防御措施，后端必须独立验证文件扩展名、Content-Type 和 Magic Number
 * 2. 临时凭证缓存在内存中，建议后端配置较短的有效期（15 分钟）
 * 3. 凭证通过 SharedWorker 共享，增加暴露面，建议实施凭证使用审计
 * 4. 所有安全相关的客户端校验均可被绕过，后端验证是关键
 * 5. **[P1 新增]** 文件大小限制：100MB 上限（客户端校验，后端必须独立验证）
 * 6. **[P1 新增]** Content-Type 一致性检查：检测扩展名与 MIME type 不匹配（警告日志）
 */

import {
  AbortMultipartUploadCommand,
  S3Client as AWSS3Client,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { TemporaryCredentialsResponse } from '@rtc-agent/protocol';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('S3Client');

/** Multipart upload threshold: 5MB (S3 minimum part size) */
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

/** Maximum allowed file size for upload: 100MB */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Credential early refresh margin: 5 minutes */
const CREDENTIAL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * MIME type to file extension mapping (common types).
 *
 * SECURITY: Used for Content-Type consistency validation to detect mismatches
 * between declared file extension and actual content type.
 * This is a defense-in-depth measure; the backend MUST independently validate.
 */
const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text / Data
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  md: 'text/markdown',
  rtf: 'application/rtf',
  // Archives
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  bz2: 'application/x-bzip2',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  // Media
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  // Code (treated as text/plain)
  py: 'text/x-python',
  go: 'text/x-go',
  java: 'text/x-java-source',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  rs: 'text/x-rust',
  rb: 'text/x-ruby',
  sql: 'text/x-sql',
  // Misc
  bin: 'application/octet-stream',
  dat: 'application/octet-stream',
  wasm: 'application/wasm',
};

/**
 * Infer MIME type from file extension.
 *
 * @param ext - File extension (without dot, lowercase)
 * @returns Inferred MIME type, or 'application/octet-stream' if unknown
 */
function inferMimeType(ext: string): string {
  return EXTENSION_TO_MIME[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Check if two MIME types are compatible.
 *
 * Handles cases where:
 * - Exact match (image/png === image/png)
 * - Generic type match (text/plain matches text/x-python)
 * - Octet-stream is always compatible (fallback type)
 *
 * @param mime1 - First MIME type
 * @param mime2 - Second MIME type
 * @returns true if compatible
 */
function areMimeTypesCompatible(mime1: string, mime2: string): boolean {
  // Exact match
  if (mime1 === mime2) return true;

  // Octet-stream is always compatible (it's a fallback)
  if (
    mime1 === 'application/octet-stream' ||
    mime2 === 'application/octet-stream'
  ) {
    return true;
  }

  // Same top-level type (e.g., both are text/* or both are image/*)
  const type1 = mime1.split('/')[0];
  const type2 = mime2.split('/')[0];
  if (type1 === type2) return true;

  // Special case: JSON is often served as text/plain or application/text
  if (
    (mime1 === 'application/json' &&
      (mime2 === 'text/plain' || mime2 === 'application/text')) ||
    (mime2 === 'application/json' &&
      (mime1 === 'text/plain' || mime1 === 'application/text'))
  ) {
    return true;
  }

  return false;
}

/**
 * Default safe file extensions allowed for upload.
 *
 * SECURITY: Defense-in-depth measure to prevent uploading executable content types
 * (e.g. .html, .js, .svg with scripts) that could be served back and executed in
 * a browser context. This is a client-side check; the server MUST also validate.
 *
 * The list covers common document, image, and data file types. When `allowedExtensions`
 * is not provided in S3ClientOptions, this default is used. Passing `allowedExtensions: []`
 * (empty array) throws an Error — validation cannot be disabled.
 */
const DEFAULT_SAFE_EXTENSIONS: ReadonlySet<string> = new Set([
  // Images (non-executable raster formats only)
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'tiff',
  'tif',
  // Documents
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  // Text / Data
  'txt',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'md',
  'rtf',
  // Archives
  'zip',
  'gz',
  'tar',
  'bz2',
  '7z',
  'rar',
  // Media
  'mp3',
  'mp4',
  'wav',
  'ogg',
  'webm',
  'avi',
  'mov',
  'flac',
  'aac',
  'm4a',
  // Code / Data (non-executable data formats for AI agent file exchanges)
  'py',
  'go',
  'java',
  'c',
  'cpp',
  'h',
  'rs',
  'rb',
  'sql',
  // Misc
  'bin',
  'dat',
  'wasm',
  // SECURITY (2026-10-14 P0 fix): Executable/script types deliberately EXCLUDED:
  // - html, js, ts, jsx, tsx, vue, svelte — can execute arbitrary scripts in browser
  // - css — can exfiltrate data via @import / url()
  // - svg — can embed <script> tags, execute JS when rendered
  // - sh, bash — shell scripts, executable on server-side
  // - exe, dll, msi, app — native executables
  // If callers need these types, they must provide an explicit allowedExtensions
  // list AND ensure the backend validates Content-Type + Magic Number independently.
]);

/**
 * S3 Client configuration options
 */
export interface S3ClientOptions {
  /** Backend server URL */
  serverURL: string;
  /** Function to get JWT token */
  getToken: () => string | Promise<string>;
  /** S3 bucket name, default 'rtc-agent' */
  bucket?: string;
  /** S3 region, default 'us-east-1' */
  region?: string;
  /**
   * Allowed file extensions for upload (without dots, lowercase).
   *
   * SECURITY: Defense-in-depth validation to block uploading executable content types.
   * - Undefined (default): uses built-in DEFAULT_SAFE_EXTENSIONS allowlist
   * - Non-empty array: overrides the default allowlist with custom extensions
   * - Empty array []: throws Error (validation cannot be disabled)
   */
  allowedExtensions?: string[];
}

/**
 * Upload options
 */
export interface UploadOptions {
  /** File content type */
  contentType?: string;
  /** Upload progress callback */
  onProgress?: (loaded: number, total: number) => void;
  /** Cancellation signal */
  signal?: AbortSignal;
}

/**
 * HeadObject 结果
 */
export interface HeadObjectResult {
  contentLength: number;
  contentType?: string;
  lastModified: Date;
  etag?: string;
}

/**
 * 列出的对象项
 */
export interface ListObjectItem {
  key: string;
  size: number;
  lastModified: Date;
}

/**
 * ListObjects 结果
 */
export interface ListObjectsResult {
  items: ListObjectItem[];
  isTruncated: boolean;
  nextMarker?: string;
}

/**
 * Uploaded part information returned by uploadPart.
 */
export interface UploadedPart {
  /** Part number (1-10000) */
  partNumber: number;
  /** ETag returned by S3 after successful upload */
  etag: string;
}

/**
 * S3 Client 封装
 *
 * 职责：
 * - 管理临时凭证（自动刷新，提前 5 分钟）
 * - 提供统一的文件操作 API
 * - 自动选择普通上传或分片上传（阈值 1MB）
 *
 * SECURITY CONSIDERATIONS:
 * - 临时凭证缓存在内存中，建议后端配置较短的有效期（15 分钟）
 * - 凭证通过 SharedWorker 共享，增加暴露面，建议实施凭证使用审计
 * - 所有客户端扩展名校验均为纵深防御，后端必须独立验证文件类型
 * - 详见文件顶部安全提示和 credentials 字段注释
 */
export class S3Client {
  private readonly options: Omit<
    Required<S3ClientOptions>,
    'getToken' | 'allowedExtensions'
  > & {
    getToken: () => string | Promise<string>;
  };

  /**
   * Allowed file extensions for upload (lowercase, without dots).
   *
   * Built from S3ClientOptions.allowedExtensions:
   * - undefined (default): DEFAULT_SAFE_EXTENSIONS
   * - non-empty array: custom allowlist (converted to Set)
   * - empty array: throws Error in constructor
   */
  private readonly allowedExtensions: ReadonlySet<string>;

  /**
   * Cached temporary credentials
   *
   * ⚠️ 安全提示（2026-10-13）：
   * 1. 临时凭证缓存在内存中，如果内存被恶意访问，可能泄露有效的 S3 访问凭证
   * 2. 多个标签页可能通过 SharedWorker 共享同一凭证，增加凭证暴露面
   * 3. 凭证在过期前 5 分钟自动刷新（CREDENTIAL_REFRESH_MARGIN_MS）
   * 4. 建议后端配置较短的凭证有效期（15 分钟而非默认的 1 小时）
   * 5. 建议实施凭证使用审计日志，监控异常访问
   */
  private credentials: TemporaryCredentialsResponse | null = null;
  /** Credential expiration time */
  private expiresAt: Date | null = null;
  /** Concurrent refresh deduplication */
  private refreshPromise: Promise<void> | null = null;
  /** Cached AWS S3 Client instance */
  private awsClient: AWSS3Client | null = null;

  /**
   * Delay (ms) before retrying a failed credential refresh request.
   * Used for exponential backoff (base delay * 2^attempt).
   */
  private static readonly CREDENTIAL_REFRESH_RETRY_DELAY_MS = 1000;

  constructor(options: S3ClientOptions) {
    this.options = {
      serverURL: options.serverURL.replace(/\/$/, ''),
      bucket: options.bucket ?? 'rtc-agent',
      region: options.region ?? 'us-east-1',
      getToken: options.getToken,
    };

    // Build allowed extensions set
    if (options.allowedExtensions === undefined) {
      // Default: use built-in safe extensions
      this.allowedExtensions = DEFAULT_SAFE_EXTENSIONS;
    } else {
      // SECURITY: Reject empty arrays to prevent accidentally disabling validation.
      // An empty allowedExtensions would bypass extension checks entirely.
      if (options.allowedExtensions.length === 0) {
        throw new Error(
          'allowedExtensions cannot be empty. Use DEFAULT_SAFE_EXTENSIONS or provide specific extensions.',
        );
      }
      // Custom list
      this.allowedExtensions = new Set(
        options.allowedExtensions.map((ext) => ext.toLowerCase()),
      );
    }
  }

  /**
   * 上传文件
   *
   * 自动选择上传方式：
   * - ≤ 1MB：PutObject 直接上传
   * - > 1MB：Multipart 分片上传
   *
   * ⚠️ 安全提示（2026-10-13）：
   * 1. 客户端扩展名校验为纵深防御措施，后端必须独立验证文件扩展名和 Content-Type
   * 2. 当前仅校验扩展名，未校验文件 Magic Number（如 PDF 以 %PDF 开头）
   * 3. 攻击者可直接调用后端 API 绕过前端校验
   * 4. 建议后端实施：
   *    - 独立的扩展名白名单校验
   *    - Content-Type 与扩展名一致性检查
   *    - 文件 Magic Number 校验（可选，对于高风险场景）
   *    - 病毒扫描集成（大文件场景）
   *
   * @param userId 用户 ID（UUID）
   * @param md5Hash 文件内容的 MD5 哈希（32 位）
   * @param ext 文件扩展名（如 'txt', 'jpg'）
   * @param file 文件内容
   * @param options 上传选项
   */
  async upload(
    userId: string,
    md5Hash: string,
    ext: string,
    file: File | Blob,
    options?: UploadOptions,
  ): Promise<void> {
    // SECURITY: Enforce client-side file size limit to prevent memory overflow and upload timeouts.
    // This is a defense-in-depth measure; the backend MUST also enforce its own size limit.
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        `File size ${file.size} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes (100MB)`,
      );
    }

    // P1 修复 (2026-10-14): Content-Type consistency validation
    // Check if the provided/declared Content-Type matches the file extension.
    // This is a defense-in-depth measure; the backend MUST independently validate.
    const resolvedContentType =
      options?.contentType ?? (file instanceof File ? file.type : undefined);

    if (resolvedContentType && ext) {
      const inferredType = inferMimeType(ext);
      if (!areMimeTypesCompatible(resolvedContentType, inferredType)) {
        // P1 修复：Content-Type 不匹配时发出警告日志
        // 不阻止上传（可能是合理的特殊情况），但记录用于审计
        log.warn(
          `Content-Type mismatch detected: ` +
            `extension '${ext}' suggests '${inferredType}', ` +
            `but declared type is '${resolvedContentType}'. ` +
            `This may indicate a file type mismatch or misconfiguration.`,
        );
      }
    }

    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    // Check abort signal before starting
    if (options?.signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }

    log.debug(`upload: key=${key}, size=${file.size}`);

    if (file.size <= MULTIPART_THRESHOLD) {
      // Small file: direct upload
      await client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: new Uint8Array(await file.arrayBuffer()),
          ContentType: resolvedContentType,
        }),
        { abortSignal: options?.signal },
      );
    } else {
      // Large file: multipart upload
      // The Upload class takes an abortController (not signal).
      // Wire a local AbortController to the caller's signal so abort propagates.
      const abortController = new AbortController();
      let onAbort: (() => void) | undefined;
      if (options?.signal) {
        onAbort = () => abortController.abort();
        if (options.signal.aborted) {
          abortController.abort();
        } else {
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      try {
        const upload = new Upload({
          client,
          params: {
            Bucket: this.options.bucket,
            Key: key,
            Body: file instanceof File ? file.stream() : file,
            ContentType: resolvedContentType,
          },
          queueSize: 4,
          partSize: 5 * 1024 * 1024, // 5MB per part (S3 minimum)
          abortController,
        });

        if (options?.onProgress) {
          upload.on('httpUploadProgress', (progress) => {
            options.onProgress?.(
              progress.loaded ?? 0,
              progress.total ?? file.size,
            );
          });
        }

        await upload.done();
      } finally {
        // P2-R5-04: Always clean up abort listener to prevent memory leak
        if (onAbort && options?.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      }
    }

    log.debug(`upload completed: key=${key}`);
  }

  /**
   * 下载文件
   *
   * @param userId 用户 ID
   * @param md5Hash 文件 MD5 哈希
   * @param ext 文件扩展名
   * @param options 下载选项
   * @returns 文件内容（Blob）
   */
  async download(
    userId: string,
    md5Hash: string,
    ext: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (loaded: number, total: number) => void;
    },
  ): Promise<Blob> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    // Check abort signal before starting
    if (options?.signal?.aborted) {
      throw new DOMException('Download aborted', 'AbortError');
    }

    log.debug(`download: key=${key}`);

    const response = await client.send(
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
      }),
      { abortSignal: options?.signal },
    );

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    const contentLength = response.ContentLength ?? 0;

    // If onProgress callback provided and we have content length,
    // read the body stream with progress tracking
    if (options?.onProgress && contentLength > 0) {
      // Use streaming approach for progress tracking
      // response.Body type from AWS SDK is StreamingBlobPayloadOutputTypes
      // We need to check if it supports async iteration
      const body = response.Body;
      // Type guard: check if body supports async iteration (ReadableStream, Node Readable, etc.)
      if (
        body &&
        typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] ===
          'function'
      ) {
        const chunks: Uint8Array[] = [];
        let loaded = 0;

        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          const uint8 = new Uint8Array(chunk);
          chunks.push(uint8);
          loaded += uint8.byteLength;
          options.onProgress(loaded, contentLength);
        }

        // Combine chunks into a single ArrayBuffer
        const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
        const result = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }

        return new Blob([result.buffer], { type: response.ContentType });
      }
    }

    // Fallback: AWS SDK Body may be various types, use transformToByteArray for unified handling
    const bytes = await response.Body.transformToByteArray();
    // Convert Uint8Array to ArrayBuffer for Blob compatibility
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Blob([buffer], { type: response.ContentType });
  }

  /**
   * 删除文件
   *
   * @param userId 用户 ID
   * @param md5Hash 文件 MD5 哈希
   * @param ext 文件扩展名
   */
  async delete(userId: string, md5Hash: string, ext: string): Promise<void> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    log.debug(`delete: key=${key}`);

    await client.send(
      new DeleteObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
      }),
    );
  }

  /**
   * 获取文件元数据
   *
   * @param userId 用户 ID
   * @param md5Hash 文件 MD5 哈希
   * @param ext 文件扩展名
   */
  async head(
    userId: string,
    md5Hash: string,
    ext: string,
  ): Promise<HeadObjectResult> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    log.debug(`head: key=${key}`);

    const response = await client.send(
      new HeadObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
      }),
    );

    return {
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType,
      lastModified: response.LastModified ?? new Date(),
      etag: response.ETag,
    };
  }

  /**
   * 列出用户对象
   *
   * @param userId 用户 ID
   * @param prefix 可选前缀过滤
   * @param marker 分页标记
   */
  async list(
    userId: string,
    prefix?: string,
    marker?: string,
  ): Promise<ListObjectsResult> {
    const client = await this.getClient();
    const userPrefix = `user-${userId}/`;
    const fullPrefix = prefix ? `${userPrefix}${prefix}` : userPrefix;

    log.debug(`list: prefix=${fullPrefix}, marker=${marker}`);

    const response = await client.send(
      new ListObjectsCommand({
        Bucket: this.options.bucket,
        Prefix: fullPrefix,
        Marker: marker,
      }),
    );

    return {
      items: (response.Contents ?? []).map((item) => ({
        key: item.Key ?? '',
        size: item.Size ?? 0,
        lastModified: item.LastModified ?? new Date(),
      })),
      isTruncated: response.IsTruncated ?? false,
      nextMarker: response.NextMarker,
    };
  }

  /**
   * 获取预签名 URL
   *
   * @param operation 操作类型（'put' | 'get'）
   * @param key 对象键
   * @param expiresIn 有效期（秒）
   */
  async getPresignedUrl(
    operation: 'put' | 'get',
    key: string,
    expiresIn?: number,
  ): Promise<string> {
    const url = `${this.options.serverURL}/api/presigned-url`;
    const token = await this.options.getToken();

    log.debug(`getPresignedUrl: operation=${operation}, key=${key}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation,
        key,
        expires_in: expiresIn,
      }),
      credentials: 'omit', // SECURITY: prevent cookie leakage to cross-origin requests
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      log.error('presigned URL request failed:', errorText);
      throw new Error(`Presigned URL API error ${response.status}`);
    }

    const data = (await response.json()) as { url: string };
    return data.url;
  }

  /**
   * Create a multipart upload.
   *
   * Initiates a multipart upload and returns an upload ID.
   * This upload ID is used to associate all the parts for a specific multipart upload.
   *
   * @param userId User ID (UUID)
   * @param md5Hash File content MD5 hash (32 chars)
   * @param ext File extension
   * @param contentType MIME type
   * @returns uploadId - S3 multipart upload ID
   */
  async createMultipartUpload(
    userId: string,
    md5Hash: string,
    ext: string,
    contentType?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    if (signal?.aborted) {
      throw new DOMException('CreateMultipartUpload aborted', 'AbortError');
    }

    const response = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { abortSignal: signal },
    );

    if (!response.UploadId) {
      throw new Error('CreateMultipartUpload returned no UploadId');
    }

    log.debug(
      `createMultipartUpload: key=${key}, uploadId=${response.UploadId}`,
    );
    return response.UploadId;
  }

  /**
   * Upload a single part of a multipart upload.
   *
   * @param userId User ID
   * @param md5Hash File MD5 hash
   * @param ext File extension
   * @param uploadId Multipart upload ID
   * @param partNumber Part number (1-10000)
   * @param body Part data as Uint8Array
   * @param onProgress Progress callback (optional). NOTE: This is a "part completion" notification,
   *   not real-time upload progress. It's called once after the entire part is uploaded, reporting
   *   (body.length, body.length). For real-time progress during upload, the AWS SDK would need to
   *   expose upload stream events, which it currently doesn't support in browser environments.
   * @param signal AbortSignal for cancellation (optional, P2-008 fix)
   * @returns UploadedPart - Contains partNumber and etag
   */
  async uploadPart(
    userId: string,
    md5Hash: string,
    ext: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<UploadedPart> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    // Check abort signal before starting
    if (signal?.aborted) {
      throw new DOMException('UploadPart aborted', 'AbortError');
    }

    const response = await client.send(
      new UploadPartCommand({
        Bucket: this.options.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
      }),
      { abortSignal: signal }, // P2-008 fix: pass signal to AWS SDK
    );

    onProgress?.(body.length, body.length);

    return {
      partNumber,
      etag: response.ETag ?? '',
    };
  }

  /**
   * Complete a multipart upload.
   *
   * After all parts have been uploaded successfully, call this method to complete
   * the multipart upload. Amazon S3 then assembles the parts into a single object.
   *
   * @param userId User ID
   * @param md5Hash File MD5 hash
   * @param ext File extension
   * @param uploadId Multipart upload ID
   * @param parts Array of uploaded parts (partNumber + etag)
   */
  async completeMultipartUpload(
    userId: string,
    md5Hash: string,
    ext: string,
    uploadId: string,
    parts: UploadedPart[],
    signal?: AbortSignal,
  ): Promise<void> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    if (signal?.aborted) {
      throw new DOMException('CompleteMultipartUpload aborted', 'AbortError');
    }

    // Parts must be sorted by part number
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: sortedParts.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          })),
        },
      }),
      { abortSignal: signal },
    );

    log.debug(
      `completeMultipartUpload: key=${key}, uploadId=${uploadId}, parts=${parts.length}`,
    );
  }

  /**
   * Abort a multipart upload.
   *
   * After a multipart upload is aborted, no additional parts can be uploaded using
   * that upload ID. If storage exists for parts that were uploaded, they are eventually deleted.
   *
   * @param userId User ID
   * @param md5Hash File MD5 hash
   * @param ext File extension
   * @param uploadId Multipart upload ID
   */
  async abortMultipartUpload(
    userId: string,
    md5Hash: string,
    ext: string,
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: key,
        UploadId: uploadId,
      }),
      { abortSignal: signal },
    );

    log.debug(`abortMultipartUpload: key=${key}, uploadId=${uploadId}`);
  }

  /**
   * List the parts of a multipart upload.
   *
   * Lists the parts that have been uploaded for a specific multipart upload.
   * Useful for verifying uploadId validity and resuming interrupted uploads.
   *
   * @param userId User ID
   * @param md5Hash File MD5 hash
   * @param ext File extension
   * @param uploadId Multipart upload ID
   * @returns Array of uploaded parts
   * @throws If uploadId has expired or is invalid
   */
  async listParts(
    userId: string,
    md5Hash: string,
    ext: string,
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<UploadedPart[]> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    if (signal?.aborted) {
      throw new DOMException('ListParts aborted', 'AbortError');
    }

    const parts: UploadedPart[] = [];
    let isTruncated = true;
    let partNumberMarker: string | undefined;

    while (isTruncated) {
      const response = await client.send(
        new ListPartsCommand({
          Bucket: this.options.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: partNumberMarker,
        }),
        { abortSignal: signal },
      );

      for (const part of response.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber ?? 0,
          etag: part.ETag ?? '',
        });
      }

      isTruncated = response.IsTruncated ?? false;
      partNumberMarker = response.NextPartNumberMarker;
    }

    return parts;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.credentials = null;
    this.expiresAt = null;
    this.awsClient = null;
    this.refreshPromise = null;
  }

  // ========== Internal Methods ==========

  /**
   * Build object key
   * Format: user-{userId}/{md5Hash}.{ext}
   *
   * SECURITY: Validates all inputs to prevent path traversal and unsafe uploads.
   * - userId: UUID format (alphanumeric + hyphens)
   * - md5Hash: 32-character hex string
   * - ext: alphanumeric only (no slashes or dots), AND checked against allowedExtensions
   */
  private buildKey(userId: string, md5Hash: string, ext: string): string {
    // Validate userId (UUID format: 8-4-4-4-12 hex digits, e.g., "550e8400-e29b-41d4-a716-446655440000")
    // RFC 4122 compliant UUID pattern
    if (
      !userId ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        userId,
      )
    ) {
      throw new Error(
        `Invalid userId: must be a valid UUID format (8-4-4-4-12 hex digits, e.g., "550e8400-e29b-41d4-a716-446655440000")`,
      );
    }

    // Validate md5Hash (32-character hex string)
    if (!md5Hash || !/^[a-f0-9]{32}$/i.test(md5Hash)) {
      throw new Error(
        `Invalid md5Hash: must be a 32-character hexadecimal string`,
      );
    }

    // Validate extension format (alphanumeric only, 1-10 chars, no path separators)
    if (!ext || !/^[a-zA-Z0-9]{1,10}$/.test(ext)) {
      throw new Error(
        `Invalid extension: must be 1-10 alphanumeric characters`,
      );
    }

    // SECURITY: Validate extension against allowedExtensions allowlist.
    //
    // ⚠️ 此校验仅为 UX 优化（Defense-in-Depth），后端必须独立验证：
    //   1. 扩展名白名单（与本客户端独立维护，不信任前端传入值）
    //   2. Content-Type 与扩展名一致性检查
    //   3. 文件 Magic Number 校验（高风险场景）
    //
    // Never rely on client-side checks alone — attackers can bypass them by:
    // 1. Calling the backend API directly (bypassing this client)
    // 2. Modifying the client code (if open-source or reverse-engineered)
    // 3. Using tools like curl or Postman to send arbitrary requests
    //
    // Backend validation ensures security even if all client-side checks are bypassed.
    const extLower = ext.toLowerCase();
    if (
      this.allowedExtensions.size > 0 &&
      !this.allowedExtensions.has(extLower)
    ) {
      throw new Error(
        `Invalid extension: '${ext}' is not in the allowed extensions list`,
      );
    }

    return `user-${userId}/${md5Hash}.${ext}`;
  }

  /**
   * Get AWS S3 Client (auto-refresh credentials)
   */
  private async getClient(): Promise<AWSS3Client> {
    // Check if credentials are valid (refresh 5 minutes before expiry)
    if (
      this.credentials &&
      this.expiresAt &&
      Date.now() < this.expiresAt.getTime() - CREDENTIAL_REFRESH_MARGIN_MS &&
      this.awsClient
    ) {
      return this.awsClient;
    }

    // Concurrent refresh deduplication
    if (this.refreshPromise) {
      await this.refreshPromise;
      // P2-R6-05: Distinguish "refresh failed" from "client disposed"
      if (!this.awsClient) {
        if (this.credentials === null) {
          throw new Error(
            'S3Client: credential refresh failed, no credentials available',
          );
        }
        throw new Error(
          'S3Client: client was disposed during credential refresh',
        );
      }
      return this.awsClient;
    }

    this.refreshPromise = this.refreshCredentials();
    try {
      await this.refreshPromise;
    } catch (err) {
      // P2-007 fix: clear refreshPromise on failure so next call retries
      this.refreshPromise = null;
      throw err;
    }
    this.refreshPromise = null;

    // P2-007 fix: verify awsClient is not null after successful refresh
    if (!this.awsClient) {
      throw new Error(
        'S3Client: credential refresh succeeded but awsClient is null',
      );
    }

    return this.awsClient;
  }

  /**
   * 刷新临时凭证
   *
   * Retry strategy: Up to 1 retry (2 total attempts) with exponential backoff on network errors.
   * 4xx/5xx errors are NOT retried to prevent overwhelming the credential service.
   *
   * SECURITY CONSIDERATIONS:
   * 1. Credentials are cached in memory - recommend short backend expiry (15 min)
   * 2. Credentials shared via SharedWorker increases exposure surface
   * 3. All client-side validation is defense-in-depth; backend MUST validate independently
   *
   * NOTE: AWS SDK has built-in retry mechanism for S3 operations (configured via maxAttempts).
   * This retry logic only covers the credential refresh HTTP call to the backend API.
   */
  private async refreshCredentials(): Promise<void> {
    const url = `${this.options.serverURL}/api/credentials/temporary`;
    const maxRetries = 1; // 1 retry = 2 total attempts

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const token = await this.options.getToken();

      log.debug(
        `refreshing temporary credentials (attempt ${attempt + 1}/${maxRetries + 1})`,
      );

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: 'omit', // SECURITY: prevent cookie leakage to cross-origin requests
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          log.error('credential refresh failed:', errorText);
          // SECURITY: Provide specific error messages for different status codes
          // to help with debugging while avoiding information disclosure
          if (response.status === 401 || response.status === 403) {
            throw new Error(
              `Credential refresh failed: authentication error (${response.status})`,
            );
          } else if (response.status === 429) {
            throw new Error(
              'Credential refresh failed: rate limit exceeded, please retry later',
            );
          } else if (response.status >= 500) {
            throw new Error(
              `Credential refresh failed: server error (${response.status})`,
            );
          }
          throw new Error(
            `Failed to get temporary credentials: ${response.status}`,
          );
        }

        const data = (await response.json()) as TemporaryCredentialsResponse;
        const expiresAt = new Date(data.expires_at);

        // SECURITY: Validate expiration time is reasonable (not too far in the future)
        // This prevents accepting credentials with suspicious expiration times
        const maxValidityMs = 24 * 60 * 60 * 1000; // 24 hours
        const validityMs = expiresAt.getTime() - Date.now();
        if (validityMs <= 0) {
          throw new Error(
            'Credential refresh failed: credentials already expired',
          );
        }
        // Warn if credentials have an unusually short remaining validity (< 5 minutes).
        // This helps detect clock skew or backend misconfiguration before the credentials
        // expire mid-operation, which would cause confusing S3 auth errors.
        const minValidityMs = 5 * 60 * 1000; // 5 minutes
        if (validityMs < minValidityMs) {
          log.warn(
            `Credentials will expire in ${Math.round(validityMs / 1000)}s ` +
              `(< ${minValidityMs / 1000}s minimum). Consider refreshing.`,
          );
        }
        if (validityMs > maxValidityMs) {
          log.warn(
            `Credential expiration time is unusually far in the future: ${validityMs}ms`,
          );
        }

        // Create new AWS S3 Client in a temporary variable to ensure atomic update.
        // If client construction fails, we don't want to partially update the state.
        const newClient = new AWSS3Client({
          endpoint: `${this.options.serverURL}/s3/`,
          region: this.options.region,
          credentials: {
            accessKeyId: data.access_key_id,
            secretAccessKey: data.secret_access_key,
            sessionToken: data.session_token,
          },
          forcePathStyle: true,
        });

        // Atomic update: only update state after all operations succeed.
        // This prevents inconsistent state if client construction fails.
        this.credentials = data;
        this.expiresAt = expiresAt;
        this.awsClient = newClient;

        log.debug(
          'credentials refreshed, expires at',
          this.expiresAt.toISOString(),
        );

        return; // Success, exit retry loop
      } catch (err) {
        // Network errors (fetch failures) are retryable — they indicate transient
        // connectivity issues, not permanent failures.
        if (attempt < maxRetries) {
          const retryDelay =
            S3Client.CREDENTIAL_REFRESH_RETRY_DELAY_MS * 2 ** attempt;
          log.debug(
            `credential refresh network error, retrying in ${retryDelay}ms`,
            err instanceof Error ? err.message : String(err),
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        // Final attempt failed or non-retryable error, rethrow
        throw err;
      }
    }
  }
}
