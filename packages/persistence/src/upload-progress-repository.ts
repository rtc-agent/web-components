// Upload Progress Repository — IndexedDB multipart upload progress management

import { getDatabase, type UploadProgressEntry, type UploadPartRecord } from './database.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('UploadProgressRepository');

/** S3 multipart upload validity: 7 days */
const MULTIPART_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Default part size: 5MB (S3 minimum part size) */
const DEFAULT_PART_SIZE = 5 * 1024 * 1024;

/**
 * Upload Progress Repository
 *
 * Manages multipart upload progress records in IndexedDB.
 * Tracks which parts have been uploaded so uploads can be resumed
 * after interruption (network failure, page close, etc.).
 */
export class UploadProgressRepository {

  /**
   * Create a new upload progress record.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param uploadId S3 multipart upload ID
   * @param s3Key S3 object key
   * @param fileSize Total file size in bytes
   * @param contentType MIME type
   * @param filename Original filename (optional)
   * @param partSize Part size in bytes (default: 5MB)
   */
  async create(
    md5: string,
    ext: string,
    uploadId: string,
    s3Key: string,
    fileSize: number,
    contentType: string,
    filename?: string,
    partSize: number = DEFAULT_PART_SIZE,
  ): Promise<UploadProgressEntry> {
    const db = getDatabase();
    const now = Date.now();
    const totalParts = Math.ceil(fileSize / partSize);

    const entry: UploadProgressEntry = {
      md5,
      ext,
      uploadId,
      s3Key,
      fileSize,
      partSize,
      totalParts,
      completedParts: [],
      bytesUploaded: 0,
      contentType,
      filename,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + MULTIPART_EXPIRY_MS,
    };

    await db.uploadParts.put(entry);
    log.debug(`created upload progress: ${md5}.${ext}, uploadId=${uploadId}, parts=${totalParts}`);
    return entry;
  }

  /**
   * Get upload progress for a file.
   * Returns null if no in-progress upload found.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  async get(md5: string, ext: string): Promise<UploadProgressEntry | null> {
    const db = getDatabase();
    const entry = await db.uploadParts.get([md5, ext]);
    return entry ?? null;
  }

  /**
   * Update completed parts after a part upload succeeds.
   *
   * CRITICAL FIX: Use Dexie's modify() for atomic read-modify-write to prevent
   * race conditions when multiple parts complete concurrently. Without this,
   * concurrent calls could overwrite each other's changes, losing part completion records.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param part Completed part record
   */
  async markPartCompleted(
    md5: string,
    ext: string,
    part: UploadPartRecord
  ): Promise<void> {
    const db = getDatabase();

    // FIX: Use modify() for atomic update within a transaction
    let updated = false;
    await db.uploadParts.where('[md5+ext]').equals([md5, ext]).modify(entry => {
      // Add part to completed list (avoid duplicates)
      const existing = entry.completedParts.findIndex(p => p.partNumber === part.partNumber);
      if (existing >= 0) {
        entry.completedParts[existing] = part;
      } else {
        entry.completedParts.push(part);
      }

      entry.bytesUploaded = entry.completedParts.reduce((sum, p) => sum + p.size, 0);
      entry.updatedAt = Date.now();
      updated = true;
    });

    if (!updated) {
      throw new Error(`Upload progress not found: ${md5}.${ext}`);
    }

    log.debug(`part completed: ${md5}.${ext}, part=${part.partNumber}`);
  }

  /**
   * Delete upload progress (after successful completion or abort).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  async delete(md5: string, ext: string): Promise<void> {
    const db = getDatabase();
    await db.uploadParts.delete([md5, ext]);
    log.debug(`deleted upload progress: ${md5}.${ext}`);
  }

  /**
   * List all in-progress uploads.
   */
  async listAll(): Promise<UploadProgressEntry[]> {
    const db = getDatabase();
    return db.uploadParts.toArray();
  }

  /**
   * List expired upload progress records (uploadId > 7 days old).
   */
  async listExpired(): Promise<UploadProgressEntry[]> {
    const db = getDatabase();
    const now = Date.now();
    return db.uploadParts
      .where('expiresAt')
      .below(now)
      .toArray();
  }

  /**
   * Clean up expired upload progress records.
   * Note: This only removes the local progress records.
   * S3-side cleanup of incomplete multipart uploads requires a separate
   * lifecycle policy or server-side cleanup job.
   *
   * @returns Number of records cleaned up
   */
  async cleanupExpired(): Promise<number> {
    const expired = await this.listExpired();
    if (expired.length === 0) return 0;

    const db = getDatabase();
    const keys = expired.map(e => [e.md5, e.ext] as [string, string]);
    await db.uploadParts.bulkDelete(keys);

    log.info(`cleaned up ${expired.length} expired upload progress records`);
    return expired.length;
  }
}

// ========== Singleton ==========

let uploadProgressRepoInstance: UploadProgressRepository | null = null;

/**
 * Initialize the UploadProgressRepository singleton.
 */
export function initUploadProgressRepository(): UploadProgressRepository {
  if (!uploadProgressRepoInstance) {
    uploadProgressRepoInstance = new UploadProgressRepository();
    log.info('UploadProgressRepository initialized');
  }
  return uploadProgressRepoInstance;
}

/**
 * Get the UploadProgressRepository singleton.
 */
export function getUploadProgressRepository(): UploadProgressRepository {
  if (!uploadProgressRepoInstance) {
    throw new Error(
      '[UploadProgressRepository] not initialized. Call initUploadProgressRepository() first.'
    );
  }
  return uploadProgressRepoInstance;
}
