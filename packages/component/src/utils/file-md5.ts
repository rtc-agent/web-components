/**
 * File MD5 Calculation Utilities
 *
 * Provides MD5 hash calculation for files using spark-md5 library.
 * Supports both small files (single calculation) and large files (chunked calculation).
 */

import SparkMD5 from 'spark-md5';

/**
 * Calculate MD5 hash of a file.
 *
 * Uses chunked reading for large files to avoid memory issues.
 * Default chunk size is 2MB.
 *
 * @param file - File or Blob to calculate MD5 for
 * @param chunkSize - Size of each chunk in bytes (default: 2MB)
 * @returns Promise resolving to 32-character hex MD5 hash
 *
 * @example
 * ```typescript
 * const file = input.files[0];
 * const md5 = await calculateFileMD5(file);
 * console.log(md5); // "d41d8cd98f00b204e9800998ecf8427e"
 * ```
 */
export async function calculateFileMD5(
  file: File | Blob,
  chunkSize: number = 2 * 1024 * 1024 // 2MB
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blobSlice = File.prototype.slice;
    const chunks = Math.ceil(file.size / chunkSize);
    let currentChunk = 0;
    const spark = new SparkMD5.ArrayBuffer();
    const reader = new FileReader();

    reader.onload = (e) => {
      spark.append(e.target?.result as ArrayBuffer);
      currentChunk++;

      if (currentChunk < chunks) {
        loadNext();
      } else {
        const hash = spark.end();
        resolve(hash);
      }
    };

    reader.onerror = () => {
      reject(new Error('File read error'));
    };

    const loadNext = () => {
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = blobSlice.call(file, start, end);
      reader.readAsArrayBuffer(chunk);
    };

    loadNext();
  });
}

/**
 * Calculate MD5 hash of an ArrayBuffer.
 *
 * @param buffer - ArrayBuffer to calculate MD5 for
 * @returns 32-character hex MD5 hash
 *
 * @example
 * ```typescript
 * const buffer = new ArrayBuffer(10);
 * const md5 = calculateBufferMD5(buffer);
 * ```
 */
export function calculateBufferMD5(buffer: ArrayBuffer): string {
  return SparkMD5.ArrayBuffer.hash(buffer);
}

/**
 * Calculate MD5 hash of a string.
 *
 * @param str - String to calculate MD5 for
 * @returns 32-character hex MD5 hash
 *
 * @example
 * ```typescript
 * const md5 = calculateStringMD5("hello world");
 * console.log(md5); // "5eb63bbbe01eeed093cb22bb8f5acdc3"
 * ```
 */
export function calculateStringMD5(str: string): string {
  return SparkMD5.hash(str);
}
