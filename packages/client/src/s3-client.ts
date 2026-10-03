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
 */

import { S3Client as AWSS3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListPartsCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { TemporaryCredentialsResponse } from '@rtc-agent/protocol';
import { createLogger } from './logger.js';

const log = createLogger('S3Client');

/** Multipart upload threshold: 5MB (S3 minimum part size) */
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

/** Credential early refresh margin: 5 minutes */
const CREDENTIAL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * S3 Client configuration options
 */
export interface S3ClientOptions {
  /** Backend server URL */
  serverUrl: string;
  /** Function to get JWT token */
  getToken: () => string | Promise<string>;
  /** S3 bucket name, default 'rtc-agent' */
  bucket?: string;
  /** S3 region, default 'us-east-1' */
  region?: string;
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
 */
export class S3Client {
  private readonly options: Required<Omit<S3ClientOptions, 'getToken'>> & {
    getToken: () => string | Promise<string>;
  };

  /** Cached temporary credentials */
  private credentials: TemporaryCredentialsResponse | null = null;
  /** Credential expiration time */
  private expiresAt: Date | null = null;
  /** Concurrent refresh deduplication */
  private refreshPromise: Promise<void> | null = null;
  /** Cached AWS S3 Client instance */
  private awsClient: AWSS3Client | null = null;

  constructor(options: S3ClientOptions) {
    this.options = {
      serverUrl: options.serverUrl.replace(/\/$/, ''),
      getToken: options.getToken,
      bucket: options.bucket ?? 'rtc-agent',
      region: options.region ?? 'us-east-1',
    };
  }

  /**
   * 上传文件
   *
   * 自动选择上传方式：
   * - ≤ 1MB：PutObject 直接上传
   * - > 1MB：Multipart 分片上传
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
    options?: UploadOptions
  ): Promise<void> {
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
          ContentType: options?.contentType ?? (file instanceof File ? file.type : undefined),
        }),
        { abortSignal: options?.signal }
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
            ContentType: options?.contentType ?? (file instanceof File ? file.type : undefined),
          },
          queueSize: 4,
          partSize: 5 * 1024 * 1024, // 5MB per part (S3 minimum)
          abortController,
        });

        if (options?.onProgress) {
          upload.on('httpUploadProgress', (progress) => {
            options.onProgress!(progress.loaded ?? 0, progress.total ?? file.size);
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
    options?: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void }
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
      { abortSignal: options?.signal }
    );

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    const contentLength = response.ContentLength ?? 0;

    // If onProgress callback provided and we have content length,
    // read the body stream with progress tracking
    if (options?.onProgress && contentLength > 0) {
      // Use streaming approach for progress tracking
      const body = response.Body as any;
      if (typeof body[Symbol.asyncIterator] === 'function') {
        const chunks: Uint8Array[] = [];
        let loaded = 0;

        for await (const chunk of body) {
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
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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

    await client.send(new DeleteObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
    }));
  }

  /**
   * 获取文件元数据
   *
   * @param userId 用户 ID
   * @param md5Hash 文件 MD5 哈希
   * @param ext 文件扩展名
   */
  async head(userId: string, md5Hash: string, ext: string): Promise<HeadObjectResult> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    log.debug(`head: key=${key}`);

    const response = await client.send(new HeadObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
    }));

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
  async list(userId: string, prefix?: string, marker?: string): Promise<ListObjectsResult> {
    const client = await this.getClient();
    const userPrefix = `user-${userId}/`;
    const fullPrefix = prefix ? `${userPrefix}${prefix}` : userPrefix;

    log.debug(`list: prefix=${fullPrefix}, marker=${marker}`);

    const response = await client.send(new ListObjectsCommand({
      Bucket: this.options.bucket,
      Prefix: fullPrefix,
      Marker: marker,
    }));

    return {
      items: (response.Contents ?? []).map(item => ({
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
    expiresIn?: number
  ): Promise<string> {
    const url = `${this.options.serverUrl}/api/presigned-url`;
    const token = await this.options.getToken();

    log.debug(`getPresignedUrl: operation=${operation}, key=${key}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation,
        key,
        expires_in: expiresIn,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Presigned URL API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as { url: string };
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
    signal?: AbortSignal
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
      { abortSignal: signal }
    );

    if (!response.UploadId) {
      throw new Error('CreateMultipartUpload returned no UploadId');
    }

    log.debug(`createMultipartUpload: key=${key}, uploadId=${response.UploadId}`);
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
   * @param onProgress Progress callback (optional, called after upload completes)
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
    signal?: AbortSignal
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
      { abortSignal: signal }  // P2-008 fix: pass signal to AWS SDK
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
    signal?: AbortSignal
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
          Parts: sortedParts.map(p => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          })),
        },
      }),
      { abortSignal: signal }
    );

    log.debug(`completeMultipartUpload: key=${key}, uploadId=${uploadId}, parts=${parts.length}`);
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
    signal?: AbortSignal
  ): Promise<void> {
    const key = this.buildKey(userId, md5Hash, ext);
    const client = await this.getClient();

    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: key,
        UploadId: uploadId,
      }),
      { abortSignal: signal }
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
    signal?: AbortSignal
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
        { abortSignal: signal }
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
   */
  private buildKey(userId: string, md5Hash: string, ext: string): string {
    return `user-${userId}/${md5Hash}.${ext}`;
  }

  /**
   * Get AWS S3 Client (auto-refresh credentials)
   */
  private async getClient(): Promise<AWSS3Client> {
    // Check if credentials are valid (refresh 5 minutes before expiry)
    if (this.credentials && this.expiresAt &&
        Date.now() < this.expiresAt.getTime() - CREDENTIAL_REFRESH_MARGIN_MS &&
        this.awsClient) {
      return this.awsClient;
    }

    // Concurrent refresh deduplication
    if (this.refreshPromise) {
      await this.refreshPromise;
      // P2-R6-05: Distinguish "refresh failed" from "client disposed"
      if (!this.awsClient) {
        if (this.credentials === null) {
          throw new Error('S3Client: credential refresh failed, no credentials available');
        }
        throw new Error('S3Client: client was disposed during credential refresh');
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
      throw new Error('S3Client: credential refresh succeeded but awsClient is null');
    }

    return this.awsClient;
  }

  /**
   * 刷新临时凭证
   */
  private async refreshCredentials(): Promise<void> {
    const url = `${this.options.serverUrl}/api/credentials/temporary`;
    const token = await this.options.getToken();

    log.debug('refreshing temporary credentials');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to get temporary credentials: ${response.status} ${errorText}`);
    }

    this.credentials = await response.json() as TemporaryCredentialsResponse;
    this.expiresAt = new Date(this.credentials.expires_at);

    // Create new AWS S3 Client
    this.awsClient = new AWSS3Client({
      endpoint: `${this.options.serverUrl}/s3/`,
      region: this.options.region,
      credentials: {
        accessKeyId: this.credentials.access_key_id,
        secretAccessKey: this.credentials.secret_access_key,
        sessionToken: this.credentials.session_token,
      },
      forcePathStyle: true,
    });

    log.debug('credentials refreshed, expires at', this.expiresAt.toISOString());
  }
}
