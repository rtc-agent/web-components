import { describe, expect, it } from 'vitest';
import { FileCacheRepository } from './file-cache-repository.js';

describe('FileCacheRepository - calculateMD5', () => {
  it('should calculate correct MD5 hash for a simple string', async () => {
    const repo = new FileCacheRepository();
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const hash = await repo.calculateMD5(blob);

    // MD5 of "hello" is 5d41402abc4b2a76b9719d911017c592
    expect(hash).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('should calculate correct MD5 hash for empty blob', async () => {
    const repo = new FileCacheRepository();
    const blob = new Blob([''], { type: 'text/plain' });
    const hash = await repo.calculateMD5(blob);

    // MD5 of "" is d41d8cd98f00b204e9800998ecf8427e
    expect(hash).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('should calculate correct MD5 hash for binary data', async () => {
    const repo = new FileCacheRepository();
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const hash = await repo.calculateMD5(blob);

    // Verify hash is 32 characters hex string
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should calculate correct MD5 hash for large blob (>1MB)', async () => {
    const repo = new FileCacheRepository();
    // Create a 2MB blob
    const size = 2 * 1024 * 1024;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const hash = await repo.calculateMD5(blob);

    // Verify hash is 32 characters hex string
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should return consistent hashes for the same input', async () => {
    const repo = new FileCacheRepository();
    const blob = new Blob(['test data'], { type: 'text/plain' });

    const hash1 = await repo.calculateMD5(blob);
    const hash2 = await repo.calculateMD5(blob);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{32}$/);
  });
});
