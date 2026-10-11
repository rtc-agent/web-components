/**
 * S3 Multipart Upload Logic
 *
 * Extracted from index.ts to separate concerns:
 * - Multipart upload with resume support
 * - Progress tracking for large file uploads
 * - Integration with UploadProgressRepository for persistence
 *
 * This module handles uploads >5MB (S3 minimum part size) using
 * the multipart upload API, with automatic resume on interruption.
 */

import { S3Client } from '@rtc-agent/client';
import type { UploadPartRecord } from './database.js';
import type { UploadProgressRepository } from './upload-progress-repository.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('S3Upload');

/** Multipart upload threshold: 5MB (S3 minimum part size) */
export const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

/** Default part size for multipart upload: 5MB */
export const DEFAULT_PART_SIZE = 5 * 1024 * 1024;

/**
 * Multipart upload with resume support.
 *
 * Flow:
 * 1. Check for existing upload progress (resume candidate)
 * 2. If found, verify uploadId is still valid (listParts)
 * 3. If valid, skip already-uploaded parts
 * 4. Upload remaining parts, updating progress after each
 * 5. Complete multipart upload
 * 6. Clean up progress record
 *
 * If resume fails (expired uploadId), falls back to fresh upload.
 *
 * @param s3Client S3Client instance
 * @param userId User ID for S3 operations
 * @param md5 File content MD5 hash
 * @param ext File extension
 * @param blob File content as Blob
 * @param contentType MIME type (optional)
 * @param signal AbortSignal for cancellation (optional)
 * @param onProgress Progress callback (optional)
 * @param progressRepo UploadProgressRepository instance
 */
export async function uploadMultipart(
  s3Client: S3Client,
  userId: string,
  md5: string,
  ext: string,
  blob: Blob,
  contentType: string | undefined,
  signal: AbortSignal | undefined,
  onProgress: ((loaded: number, total: number) => void) | undefined,
  progressRepo: UploadProgressRepository,
): Promise<void> {
  const existing = await progressRepo.get(md5, ext);

  let uploadId: string = '';
  let completedParts: UploadPartRecord[] = [];
  let bytesUploaded = 0;
  const partSize = DEFAULT_PART_SIZE;
  let totalParts = 0;
  let resumeMode = false;

  // Try to resume from existing progress
  if (existing && existing.fileSize === blob.size) {
    try {
      // Verify uploadId is still valid by listing parts
      // P2-R7-02: Pass signal to listParts for cancellation support
      const serverParts = await s3Client.listParts(
        userId,
        md5,
        ext,
        existing.uploadId,
        signal,
      );

      uploadId = existing.uploadId;
      totalParts = existing.totalParts;

      // Build completed parts map from server-confirmed data
      const serverPartMap = new Map(serverParts.map((p) => [p.partNumber, p]));
      for (const localPart of existing.completedParts) {
        const serverPart = serverPartMap.get(localPart.partNumber);
        if (serverPart) {
          completedParts.push({
            partNumber: localPart.partNumber,
            etag: serverPart.etag,
            size: localPart.size,
          });
        }
      }

      bytesUploaded = completedParts.reduce((sum, p) => sum + p.size, 0);
      resumeMode = true;

      log.info(
        `Resuming upload: ${md5}.${ext}, uploadId=${uploadId}, ` +
          `completed=${completedParts.length}/${totalParts}`,
      );
    } catch (err) {
      // uploadId expired or invalid - start fresh
      log.warn(`Cannot resume upload ${md5}.${ext}: ${err}. Starting fresh.`);
      await progressRepo.delete(md5, ext);
      // Fall through to create new multipart upload
    }
  }

  // Create new multipart upload if not resuming
  if (!resumeMode) {
    totalParts = Math.ceil(blob.size / partSize);

    // P2-R7-02: Pass signal to createMultipartUpload for cancellation support
    uploadId = await s3Client.createMultipartUpload(
      userId,
      md5,
      ext,
      contentType,
      signal,
    );

    await progressRepo.create(
      md5,
      ext,
      uploadId,
      `user-${userId}/${md5}.${ext}`,
      blob.size,
      contentType || 'application/octet-stream',
      undefined,
      partSize,
    );
  }

  // Upload remaining parts
  try {
    for (let partNum = 1; partNum <= totalParts; partNum++) {
      // Skip already-completed parts
      if (completedParts.some((p) => p.partNumber === partNum)) {
        continue;
      }

      if (signal?.aborted) {
        throw new DOMException('Upload aborted', 'AbortError');
      }

      // Extract part data from blob
      const start = (partNum - 1) * partSize;
      const end = Math.min(start + partSize, blob.size);

      // Use block scope to ensure partData can be garbage collected after each iteration
      {
        const partBlob = blob.slice(start, end);
        const partData = new Uint8Array(await partBlob.arrayBuffer());

        // Track bytes before this part for progress calculation
        // P2-R5-09: partBytesUploaded is captured by the closure below,
        // so each part's progress is accumulated onto the global total.
        const partBytesUploaded = bytesUploaded;

        // Upload part with progress callback
        // P2-R7-02: Pass signal to uploadPart for cancellation support
        const result = await s3Client.uploadPart(
          userId,
          md5,
          ext,
          uploadId,
          partNum,
          partData,
          (partLoaded, _partTotal) => {
            // Accumulate part progress to global progress
            onProgress?.(partBytesUploaded + partLoaded, blob.size);
          },
          signal,
        );

        // Record progress
        const partRecord: UploadPartRecord = {
          partNumber: partNum,
          etag: result.etag,
          size: end - start,
        };

        await progressRepo.markPartCompleted(md5, ext, partRecord);
        completedParts.push(partRecord);

        // Report progress
        bytesUploaded += partRecord.size;
        onProgress?.(bytesUploaded, blob.size);
      } // partData scope ends here, can be garbage collected
    }

    // Complete multipart upload
    // P2-R7-02: Pass signal to completeMultipartUpload for cancellation support
    await s3Client.completeMultipartUpload(
      userId,
      md5,
      ext,
      uploadId,
      completedParts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      signal,
    );

    // Clean up progress record
    await progressRepo.delete(md5, ext);

    log.info(`Multipart upload completed: ${md5}.${ext}, parts=${totalParts}`);
  } catch (err) {
    // Upload interrupted - progress is saved for resume
    log.warn(
      `Multipart upload interrupted: ${md5}.${ext}, ` +
        `progress saved (${completedParts.length}/${totalParts} parts)`,
    );
    throw err;
  }
}
