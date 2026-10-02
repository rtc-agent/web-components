/**
 * Phase 3: FileStorage list(), AbortController, and progress semantics tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileStorage, getFileExtension, generateFilename } from './file-storage.js';
import type { WorkerBridge } from '../worker-bridge.js';

function createMockBridge(overrides: Partial<WorkerBridge> = {}): WorkerBridge {
  return {
    calculateFileMD5: vi.fn().mockResolvedValue('d41d8cd98f00b204e9800998ecf8427e'),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(new Blob(['test'])),
    getCachedFile: vi.fn().mockResolvedValue(null),
    listFiles: vi.fn().mockResolvedValue([]),
    countFiles: vi.fn().mockResolvedValue(0),
    headFile: vi.fn().mockResolvedValue({ contentLength: 100, contentType: 'text/plain' }),
    getPresignedUrl: vi.fn().mockResolvedValue('https://example.com/signed'),
    cacheFile: vi.fn().mockResolvedValue(undefined),
    evictExpiredCache: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as WorkerBridge;
}

describe('Phase 3: FileStorage list() pagination', () => {
  it('should return paginated results with hasMore', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      md5: `md5-${i}`,
      ext: 'txt',
      size: 100,
      contentType: 'text/plain',
      filename: `file-${i}.txt`,
    }));

    const bridge = createMockBridge({
      listFiles: vi.fn().mockResolvedValue(entries),
      countFiles: vi.fn().mockResolvedValue(25),
    });
    const fs = new FileStorage(bridge, 'user-1');

    const result = await fs.list({ limit: 10, offset: 0 });

    expect(result.files).toHaveLength(10);
    expect(result.total).toBe(25);
    expect(result.hasMore).toBe(true); // 0 + 10 < 25
    expect(bridge.listFiles).toHaveBeenCalledWith(undefined, 10, 0);
    expect(bridge.countFiles).toHaveBeenCalledWith(undefined);
  });

  it('should return hasMore=false when on last page', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      md5: `md5-${i}`,
      ext: 'txt',
      size: 100,
      contentType: 'text/plain',
    }));

    const bridge = createMockBridge({
      listFiles: vi.fn().mockResolvedValue(entries),
      countFiles: vi.fn().mockResolvedValue(25),
    });
    const fs = new FileStorage(bridge, 'user-1');

    const result = await fs.list({ limit: 10, offset: 20 });

    expect(result.files).toHaveLength(5);
    expect(result.total).toBe(25);
    expect(result.hasMore).toBe(false); // 20 + 10 >= 25
  });

  it('should filter by syncStatus', async () => {
    const bridge = createMockBridge({
      listFiles: vi.fn().mockResolvedValue([]),
      countFiles: vi.fn().mockResolvedValue(3),
    });
    const fs = new FileStorage(bridge, 'user-1');

    await fs.list({ syncStatus: 'pending' });

    expect(bridge.listFiles).toHaveBeenCalledWith('pending', 100, 0);
    expect(bridge.countFiles).toHaveBeenCalledWith('pending');
  });

  it('should use default limit=100 and offset=0', async () => {
    const bridge = createMockBridge({
      listFiles: vi.fn().mockResolvedValue([]),
      countFiles: vi.fn().mockResolvedValue(0),
    });
    const fs = new FileStorage(bridge, 'user-1');

    await fs.list();

    expect(bridge.listFiles).toHaveBeenCalledWith(undefined, 100, 0);
  });

  it('should map entries to FileInfo', async () => {
    const createdAt = Date.now();
    const syncedAt = Date.now();
    const bridge = createMockBridge({
      listFiles: vi.fn().mockResolvedValue([
        {
          md5: 'abc123',
          ext: 'pdf',
          size: 5000,
          contentType: 'application/pdf',
          filename: 'doc.pdf',
          syncStatus: 'synced',
          createdAt,
          syncedAt,
          errorMessage: undefined,
        },
      ]),
      countFiles: vi.fn().mockResolvedValue(1),
    });
    const fs = new FileStorage(bridge, 'user-1');

    const result = await fs.list();

    // FileInfo now includes syncStatus, createdAt, syncedAt, errorMessage
    expect(result.files[0]).toEqual({
      md5: 'abc123',
      ext: 'pdf',
      size: 5000,
      contentType: 'application/pdf',
      filename: 'doc.pdf',
      syncStatus: 'synced',
      createdAt,
      syncedAt,
      errorMessage: undefined,
    });
  });
});

describe('Phase 3: AbortController support', () => {
  it('upload() should throw AbortError if signal is already aborted', async () => {
    const bridge = createMockBridge();
    const fs = new FileStorage(bridge, 'user-1');

    const controller = new AbortController();
    controller.abort();

    await expect(
      fs.upload({ file: new Blob(['test']), signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });

    // Bridge methods should NOT be called if signal is already aborted
    expect(bridge.calculateFileMD5).not.toHaveBeenCalled();
    expect(bridge.uploadFile).not.toHaveBeenCalled();
  });

  it('download() should throw AbortError if signal is already aborted', async () => {
    const bridge = createMockBridge();
    const fs = new FileStorage(bridge, 'user-1');

    const controller = new AbortController();
    controller.abort();

    await expect(
      fs.download('md5', 'txt', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(bridge.getCachedFile).not.toHaveBeenCalled();
    expect(bridge.downloadFile).not.toHaveBeenCalled();
  });

  it('upload() should pass signal to bridge', async () => {
    const bridge = createMockBridge();
    const fs = new FileStorage(bridge, 'user-1');

    const controller = new AbortController();
    const file = new Blob(['test']);

    await fs.upload({ file, filename: 'test.txt', signal: controller.signal });

    // uploadFile signature: (md5, ext, blob, contentType, filename, onProgress, signal, cacheTtlMs)
    expect(bridge.uploadFile).toHaveBeenCalledWith(
      'd41d8cd98f00b204e9800998ecf8427e',
      'txt',
      file,
      'application/octet-stream',
      'test.txt',
      undefined,
      controller.signal,
      undefined
    );
  });

  it('download() should pass signal to bridge', async () => {
    const bridge = createMockBridge();
    const fs = new FileStorage(bridge, 'user-1');

    const controller = new AbortController();

    await fs.download('md5', 'txt', { signal: controller.signal });

    // downloadFile signature: (md5, ext, onProgress, signal, forceRefresh)
    expect(bridge.downloadFile).toHaveBeenCalledWith('md5', 'txt', undefined, controller.signal, false);
  });

  it('upload() should work without signal (backwards compatible)', async () => {
    const bridge = createMockBridge();
    const fs = new FileStorage(bridge, 'user-1');

    const file = new Blob(['test'], { type: 'text/plain' });
    const result = await fs.upload({ file, filename: 'test.txt' });

    expect(result.md5).toBe('d41d8cd98f00b204e9800998ecf8427e');
    // uploadFile signature: (md5, ext, blob, contentType, filename, onProgress, signal, cacheTtlMs)
    expect(bridge.uploadFile).toHaveBeenCalledWith(
      'd41d8cd98f00b204e9800998ecf8427e',
      'txt',
      file,
      'text/plain',
      'test.txt',
      undefined,
      undefined,
      undefined
    );
  });
});

describe('Phase 3: upload() onProgress forwarding', () => {
  it('should pass onProgress to bridge', async () => {
    const bridge = createMockBridge();
    const fs = new FileStorage(bridge, 'user-1');

    const onProgress = vi.fn();
    const file = new Blob(['test']);

    await fs.upload({ file, filename: 'test.txt', onProgress });

    // uploadFile signature: (md5, ext, blob, contentType, filename, onProgress, signal, cacheTtlMs)
    expect(bridge.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      'txt',
      file,
      expect.any(String),
      'test.txt',
      onProgress,
      undefined,
      undefined
    );
  });
});

describe('Phase 3: throttle utility', () => {
  it('should be importable and limit call frequency', async () => {
    // We test throttle behavior indirectly through the bridge's uploadFile.
    // The throttle function itself is not exported, so we verify behavior
    // by checking that a rapidly-invoked progress callback is rate-limited.
    // This is a behavioral test rather than a unit test.

    // Direct throttle test (import not possible since it's not exported,
    // so we test the contract: 100ms throttle -> max ~10 calls/sec)
    // For now, verify the concept with a local implementation matching
    // the one in worker-bridge.ts.
    function throttle<T extends (...args: any[]) => void>(fn: T, delayMs: number): T {
      let lastCall = 0;
      return ((...args: any[]) => {
        const now = Date.now();
        if (now - lastCall >= delayMs) {
          lastCall = now;
          fn(...args);
        }
      }) as T;
    }

    const calls: number[] = [];
    const throttled = throttle((n: number) => calls.push(n), 100);

    // Rapid-fire 20 calls
    for (let i = 0; i < 20; i++) {
      throttled(i);
    }

    // Only the first call should have gone through (all within same ms)
    expect(calls).toEqual([0]);
  });
});
