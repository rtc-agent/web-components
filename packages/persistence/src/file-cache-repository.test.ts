// File Cache Repository tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initFileCacheRepository, getFileCacheRepository, FileCacheRepository } from './file-cache-repository.js';
import { getDatabase, closeDatabase } from './database.js';
import 'fake-indexeddb/auto';

describe('FileCacheRepository', () => {
  const DB_NAME = 'rtc-agent-test-file-cache';
  let repo: FileCacheRepository;

  beforeEach(() => {
    getDatabase(DB_NAME);
    initFileCacheRepository();
    repo = getFileCacheRepository();
    // Reset lifecycle guard in case previous test closed it
    repo.resetLifecycleGuard();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('put and get', () => {
    it('should cache and retrieve a file', async () => {
      const md5 = 'a'.repeat(32);
      const ext = 'txt';
      const content = 'Hello, World!';
      const blob = new Blob([content], { type: 'text/plain' });

      await repo.put(md5, ext, blob, 'text/plain');

      const cached = await repo.get(md5, ext);
      expect(cached).not.toBeNull();
      expect(cached!.contentType).toBe('text/plain');

      const text = await cached!.blob.text();
      expect(text).toBe(content);
    });

    it('should return null for non-existent file', async () => {
      const cached = await repo.get('nonexistent'.padEnd(32, '0'), 'txt');
      expect(cached).toBeNull();
    });

    it('should update lastAccessedAt on get', async () => {
      const md5 = 'b'.repeat(32);
      const ext = 'txt';
      const blob = new Blob(['test'], { type: 'text/plain' });

      await repo.put(md5, ext, blob, 'text/plain');

      // Get the entry to check createdAt
      const db = getDatabase();
      const before = await db.fileCache.get([md5, ext]);
      expect(before).toBeDefined();

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Get the file (should update lastAccessedAt)
      await repo.get(md5, ext);

      const after = await db.fileCache.get([md5, ext]);
      expect(after!.lastAccessedAt).toBeGreaterThan(before!.lastAccessedAt);
    });
  });

  describe('expiration', () => {
    it('should return null for expired file', async () => {
      const md5 = 'c'.repeat(32);
      const ext = 'txt';
      const blob = new Blob(['expired'], { type: 'text/plain' });

      // Cache with 1ms TTL
      await repo.put(md5, ext, blob, 'text/plain', 1);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));

      const cached = await repo.get(md5, ext);
      expect(cached).toBeNull();
    });

    it('should evict expired entries', async () => {
      const md5_1 = 'd'.repeat(32);
      const md5_2 = 'e'.repeat(32);
      const ext = 'txt';
      const blob = new Blob(['test'], { type: 'text/plain' });

      // Cache one with 1ms TTL, one with 1 hour TTL
      await repo.put(md5_1, ext, blob, 'text/plain', 1);
      await repo.put(md5_2, ext, blob, 'text/plain', 60 * 60 * 1000);

      // Wait for first to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      // Evict expired
      const evicted = await repo.evictExpired();
      expect(evicted).toBe(1);

      // First should be gone, second should remain
      expect(await repo.get(md5_1, ext)).toBeNull();
      expect(await repo.get(md5_2, ext)).not.toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all cached files', async () => {
      const blob = new Blob(['test'], { type: 'text/plain' });

      await repo.put('f'.repeat(32), 'txt', blob, 'text/plain');
      await repo.put('g'.repeat(32), 'txt', blob, 'text/plain');

      await repo.clear();

      expect(await repo.get('f'.repeat(32), 'txt')).toBeNull();
      expect(await repo.get('g'.repeat(32), 'txt')).toBeNull();
    });
  });

  describe('downloadWithDedup', () => {
    it('should deduplicate concurrent downloads', async () => {
      const md5 = 'h'.repeat(32);
      const ext = 'txt';
      let downloadCount = 0;

      const downloadFn = async () => {
        downloadCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return new Blob(['downloaded'], { type: 'text/plain' });
      };

      // Start 3 concurrent downloads
      const promises = [
        repo.downloadWithDedup(md5, ext, downloadFn),
        repo.downloadWithDedup(md5, ext, downloadFn),
        repo.downloadWithDedup(md5, ext, downloadFn),
      ];

      const results = await Promise.all(promises);

      // Should only download once
      expect(downloadCount).toBe(1);
      expect(results.length).toBe(3);
      expect(await results[0].text()).toBe('downloaded');
    });

    it('should allow new download after previous completes', async () => {
      const md5 = 'i'.repeat(32);
      const ext = 'txt';
      let downloadCount = 0;

      const downloadFn = async () => {
        downloadCount++;
        return new Blob(['downloaded'], { type: 'text/plain' });
      };

      // First download
      await repo.downloadWithDedup(md5, ext, downloadFn);
      expect(downloadCount).toBe(1);

      // Second download (after first completes)
      await repo.downloadWithDedup(md5, ext, downloadFn);
      expect(downloadCount).toBe(2);
    });
  });
});
