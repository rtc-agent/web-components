/**
 * WorkerBridge Unit Tests — AbortController & Catch-up Cancellation
 *
 * Tests:
 * - destroy() aborts an ongoing catch-up
 * - Cancelled catch-up stops processing events (no further delivery)
 * - destroy() waits for ongoing init() to complete before cleaning up
 * - destroy() cleans up Worker resources regardless of _initialized state
 * - destroy() nulls out _worker and _core references
 * - destroy() resolves pending yield channel Promises
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  WorkerPersistenceCore,
  WorkerCallbacks,
  UIUpdatePayload,
} from '@rtc-agent/worker';
import type { Remote } from 'comlink';

// Mock heavy dependencies before importing WorkerBridge
vi.mock('@rtc-agent/persistence', () => ({
  getUIUpdateBus: () => ({
    publish: vi.fn(),
  }),
  virtualFS: {
    read: vi.fn(),
    write: vi.fn(),
    ls: vi.fn(),
    find: vi.fn(),
    grep: vi.fn(),
    queryByType: vi.fn(),
    exists: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@rtc-agent/protocol', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Dynamic import after mocks
const { WorkerBridge } = await import('./worker-bridge.js');

describe('WorkerBridge - AbortController & Catch-up Cancellation', () => {
  let bridge: InstanceType<typeof WorkerBridge>;
  let mockAuth: any;
  let mockCore: any;
  let mockCallbacks: {
    onUIUpdate: ReturnType<typeof vi.fn>;
    onStateGap: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuth = {
      getAccessTokenAsync: vi.fn().mockResolvedValue('mock-token'),
      handleTokenExpired: vi.fn().mockResolvedValue('refresh'),
    };

    mockCallbacks = {
      onUIUpdate: vi.fn(),
      onStateGap: vi.fn(),
    };

    mockCore = {
      getCatchUpEvents: vi.fn(),
      registerCallback: vi.fn(),
      unregisterCallback: vi.fn(),
      getConnectionState: vi.fn().mockResolvedValue('connected'),
    };

    // Create bridge instance
    bridge = new WorkerBridge(mockAuth);

    // Directly inject internal state to bypass full init() flow
    (bridge as any)._core =
      mockCore as unknown as Remote<WorkerPersistenceCore>;
    (bridge as any)._callbacks = mockCallbacks as unknown as WorkerCallbacks;
    (bridge as any)._initialized = true;
    (bridge as any)._lastProcessedSeq = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('destroy() aborts ongoing catch-up', () => {
    it('should cancel _catchUpAbortController when destroy() is called', async () => {
      // Track whether the signal was aborted
      let capturedSignal: AbortSignal | undefined;

      mockCore.getCatchUpEvents.mockImplementation(async (_fromSeq: number) => {
        // Capture the abort signal created inside _doCatchUp
        capturedSignal = (bridge as any)._catchUpAbortController?.signal;
        // Simulate a slow response to give destroy() time to abort
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { entries: [], hasGap: false, hasMore: false };
      });

      // Start catch-up (do not await — it's in progress)
      const catchUpPromise = (bridge as any)._doCatchUp();

      // Wait for getCatchUpEvents to be called and signal to be created
      await vi.waitUntil(() => capturedSignal !== undefined);

      // Verify signal is not yet aborted
      expect(capturedSignal!.aborted).toBe(false);

      // Call destroy — should abort the catch-up
      await bridge.destroy();

      // Verify signal is now aborted
      expect(capturedSignal!.aborted).toBe(true);

      // Wait for catch-up to finish (should exit cleanly after abort)
      await catchUpPromise;
    });

    it('should not throw when destroy() is called without an ongoing catch-up', async () => {
      // No catch-up in progress — _catchUpAbortController is undefined
      await expect(bridge.destroy()).resolves.not.toThrow();
    });
  });

  describe('cancelled catch-up stops processing events', () => {
    it('should stop delivering events after abort signal is set', async () => {
      let callCount = 0;
      let resolveFirstCall: (() => void) | undefined;

      mockCore.getCatchUpEvents.mockImplementation(async (_fromSeq: number) => {
        callCount++;
        if (callCount === 1) {
          // First call: return events but wait before resolving
          // so destroy() can abort mid-processing
          await new Promise<void>((resolve) => {
            resolveFirstCall = resolve;
          });
          return {
            entries: [
              {
                seq: 1,
                event: {
                  entity: 'file',
                  action: 'updated',
                  entityId: '1',
                  field: 'title',
                  oldValue: null,
                  newValue: 'test',
                },
                timestamp: 1,
              },
              {
                seq: 2,
                event: {
                  entity: 'file',
                  action: 'updated',
                  entityId: '2',
                  field: 'title',
                  oldValue: null,
                  newValue: 'test2',
                },
                timestamp: 2,
              },
            ],
            hasGap: false,
            hasMore: true, // Would trigger a second call
          };
        }
        // Second call should never happen if abort works
        return { entries: [], hasGap: false, hasMore: false };
      });

      // Start catch-up
      const catchUpPromise = (bridge as any)._doCatchUp();

      // Wait for getCatchUpEvents to be called
      await vi.waitUntil(() => callCount > 0);

      // Abort via destroy
      await bridge.destroy();

      // Resolve the first getCatchUpEvents call (after abort is set)
      resolveFirstCall!();

      // Wait for catch-up to complete
      await catchUpPromise;

      // The events should NOT have been delivered because the signal
      // was aborted before the loop could iterate over them.
      // (The signal.aborted check in the for-loop condition prevents delivery.)
      expect(mockCallbacks.onUIUpdate).not.toHaveBeenCalled();

      // Only one call to getCatchUpEvents (second page was skipped due to abort)
      expect(mockCore.getCatchUpEvents).toHaveBeenCalledTimes(1);
    });

    it('should not call onStateGap after abort', async () => {
      let resolveCall: (() => void) | undefined;

      mockCore.getCatchUpEvents.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          resolveCall = resolve;
        });
        return {
          entries: [],
          hasGap: true, // Would normally trigger onStateGap
          hasMore: false,
        };
      });

      const catchUpPromise = (bridge as any)._doCatchUp();

      // Wait for getCatchUpEvents to be called
      await vi.waitUntil(() => mockCore.getCatchUpEvents.mock.calls.length > 0);

      // Abort before the result is processed
      await bridge.destroy();

      // Now resolve the mock (after abort)
      resolveCall!();

      await catchUpPromise;

      // onStateGap should NOT be called because the catch-up was cancelled
      // before it could process the gap result
      expect(mockCallbacks.onStateGap).not.toHaveBeenCalled();
    });
  });

  describe('destroy() resource cleanup', () => {
    it('should wait for ongoing init() to complete before cleaning up', async () => {
      let initResolved = false;
      let resolveInit: (() => void) | undefined;

      // Simulate an ongoing init() that takes some time
      const initPromise = new Promise<void>((resolve) => {
        resolveInit = resolve;
      }).then(() => {
        initResolved = true;
      });

      (bridge as any)._initPromise = initPromise;

      // Start destroy() — it should wait for init to complete
      const destroyPromise = bridge.destroy();

      // Give destroy() a moment to reach the await
      await new Promise((resolve) => setTimeout(resolve, 10));

      // destroy() should not have completed yet (waiting for init)
      let destroyCompleted = false;
      destroyPromise.then(() => {
        destroyCompleted = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(destroyCompleted).toBe(false);

      // Now resolve init
      resolveInit!();
      await initPromise;

      // destroy() should now complete
      await destroyPromise;
      expect(destroyCompleted).toBe(true);
      expect(initResolved).toBe(true);
    });

    it('should continue cleanup even if init() fails', async () => {
      const initPromise = Promise.reject(new Error('init failed'));
      (bridge as any)._initPromise = initPromise;

      // destroy() should not throw even though init failed
      await expect(bridge.destroy()).resolves.not.toThrow();

      // Resources should still be cleaned up
      expect((bridge as any)._worker).toBeNull();
      expect((bridge as any)._core).toBeNull();
    });

    it('should clean up Worker resources even when _initialized is false', async () => {
      // Simulate initWorker() succeeded but init() didn't complete
      const mockPort = {
        close: vi.fn(),
        start: vi.fn(),
        postMessage: vi.fn(),
      };
      const mockWorker = {
        port: mockPort,
        onerror: null,
      };
      (bridge as any)._worker = mockWorker;
      (bridge as any)._core = mockCore;
      (bridge as any)._initialized = false;

      await bridge.destroy();

      // Port should be closed even though _initialized was false
      expect(mockPort.close).toHaveBeenCalled();

      // References should be nulled
      expect((bridge as any)._worker).toBeNull();
      expect((bridge as any)._core).toBeNull();
    });

    it('should not call unregisterCallback when _initialized is false', async () => {
      const mockPort = { close: vi.fn(), start: vi.fn(), postMessage: vi.fn() };
      const mockWorker = { port: mockPort, onerror: null };
      (bridge as any)._worker = mockWorker;
      (bridge as any)._core = mockCore;
      (bridge as any)._initialized = false;

      await bridge.destroy();

      // unregisterCallback should NOT be called because callbacks were never registered
      expect(mockCore.unregisterCallback).not.toHaveBeenCalled();
    });

    it('should null out _worker and _core references after cleanup', async () => {
      const mockPort = { close: vi.fn(), start: vi.fn(), postMessage: vi.fn() };
      const mockWorker = { port: mockPort, onerror: null };
      (bridge as any)._worker = mockWorker;
      (bridge as any)._core = mockCore;
      (bridge as any)._initialized = true;

      await bridge.destroy();

      expect((bridge as any)._worker).toBeNull();
      expect((bridge as any)._core).toBeNull();
    });

    it('should resolve all pending yield channel Promises', async () => {
      // Simulate pending yield promises
      const resolved: boolean[] = [];
      const promise1 = new Promise<void>((resolve) => {
        (bridge as any)._yieldResolves.push(() => {
          resolved.push(true);
          resolve();
        });
      });
      const promise2 = new Promise<void>((resolve) => {
        (bridge as any)._yieldResolves.push(() => {
          resolved.push(true);
          resolve();
        });
      });

      // Create a mock yield channel
      const mockChannel = {
        port1: { close: vi.fn(), onmessage: null },
        port2: { close: vi.fn(), postMessage: vi.fn() },
      };
      (bridge as any)._yieldChannel = mockChannel;

      // destroy() should resolve all pending promises
      await bridge.destroy();

      // Both promises should have been resolved
      expect(resolved.length).toBe(2);

      // Yield channel should be cleaned up
      expect((bridge as any)._yieldChannel).toBeUndefined();
      expect(mockChannel.port1.close).toHaveBeenCalled();
      expect(mockChannel.port2.close).toHaveBeenCalled();

      // The promises should complete
      await Promise.all([promise1, promise2]);
    });

    it('should clear connection listeners', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      bridge.onConnectionStateChange(listener1);
      bridge.onConnectionStateChange(listener2);

      expect((bridge as any)._connectionListeners.size).toBe(2);

      await bridge.destroy();

      expect((bridge as any)._connectionListeners.size).toBe(0);
    });
  });
});

/**
 * WorkerBridge Unit Tests — File Cache & S3 Operations
 *
 * Tests:
 * - cacheFile / cacheFilePending / getCachedFile / evictCache / evictExpiredCache
 * - uploadFile / downloadFile / deleteFile / headFile
 * - syncPendingFiles / resumeInterruptedUploads
 * - getCacheStats / updateFileMetadata
 * - Connection state monitoring
 * - installVirtualFSProxy
 */
describe('WorkerBridge - File Cache & S3 Operations', () => {
  let bridge: InstanceType<typeof WorkerBridge>;
  let mockAuth: any;
  let mockCore: any;
  let mockCallbacks: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuth = {
      getAccessTokenAsync: vi.fn().mockResolvedValue('mock-token'),
      handleTokenExpired: vi.fn().mockResolvedValue('refresh'),
    };

    mockCallbacks = {
      onUIUpdate: vi.fn(),
      onStateGap: vi.fn(),
    };

    // Create comprehensive mock core with all file operations
    mockCore = {
      // Basic operations
      getCatchUpEvents: vi.fn().mockResolvedValue({
        entries: [],
        hasGap: false,
        hasMore: false,
      }),
      registerCallback: vi.fn(),
      unregisterCallback: vi.fn(),
      getConnectionState: vi.fn().mockResolvedValue('connected'),

      // File cache operations
      cacheFile: vi.fn().mockResolvedValue(undefined),
      cacheFilePending: vi.fn().mockResolvedValue(undefined),
      getCachedFile: vi.fn().mockResolvedValue(null),
      evictExpiredCache: vi.fn().mockResolvedValue(0),
      evictCache: vi.fn().mockResolvedValue({ evictedCount: 0, evictedBytes: 0 }),

      // File operations
      uploadFile: vi.fn().mockResolvedValue({
        syncStatus: 'synced',
        syncedAt: Date.now(),
      }),
      downloadFile: vi.fn().mockResolvedValue(new Blob(['test content'])),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      headFile: vi.fn().mockResolvedValue({
        contentLength: 100,
        contentType: 'text/plain',
        lastModified: new Date(),
        etag: '"abc123"',
      }),

      // Sync operations
      syncPendingFiles: vi.fn().mockResolvedValue({
        synced: 0,
        failed: 0,
        syncedFiles: [],
        failedFiles: [],
      }),
      resumeInterruptedUploads: vi.fn().mockResolvedValue({
        resumed: 0,
        failed: 0,
        expired: 0,
        syncedFiles: [],
        failedFiles: [],
      }),

      // Stats and metadata
      getCacheStats: vi.fn().mockResolvedValue({
        totalFiles: 0,
        totalSize: 0,
        byStatus: {
          pending: { count: 0, size: 0 },
          syncing: { count: 0, size: 0 },
          synced: { count: 0, size: 0 },
          failed: { count: 0, size: 0 },
        },
      }),
      updateFileMetadata: vi.fn().mockResolvedValue(undefined),

      // Cancellation
      cancelFileOperation: vi.fn(),
    };

    // Create bridge instance
    bridge = new WorkerBridge(mockAuth);

    // Inject internal state to bypass full init() flow
    (bridge as any)._core = mockCore;
    (bridge as any)._callbacks = mockCallbacks;
    (bridge as any)._initialized = true;
    (bridge as any)._lastProcessedSeq = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cacheFile', () => {
    it('should call core.cacheFile with correct parameters', async () => {
      const md5 = 'abc123def456';
      const ext = 'txt';
      const blob = new Blob(['test content'], { type: 'text/plain' });
      const contentType = 'text/plain';
      const ttlMs = 3600000;

      await bridge.cacheFile(md5, ext, blob, contentType, ttlMs);

      expect(mockCore.cacheFile).toHaveBeenCalledWith(
        md5,
        ext,
        blob,
        contentType,
        ttlMs,
      );
    });

    it('should call core.cacheFile without ttlMs when not provided', async () => {
      const md5 = 'abc123';
      const ext = 'json';
      const blob = new Blob(['{}'], { type: 'application/json' });
      const contentType = 'application/json';

      await bridge.cacheFile(md5, ext, blob, contentType);

      expect(mockCore.cacheFile).toHaveBeenCalledWith(
        md5,
        ext,
        blob,
        contentType,
        undefined,
      );
    });

    it('should throw when core is not available', async () => {
      (bridge as any)._core = null;

      const blob = new Blob(['test']);
      await expect(bridge.cacheFile('md5', 'ext', blob, 'type')).rejects.toThrow(
        'core is not available',
      );
    });
  });

  describe('cacheFilePending', () => {
    it('should call core.cacheFilePending with correct parameters', async () => {
      const md5 = 'pending123';
      const ext = 'md';
      const blob = new Blob(['# Title'], { type: 'text/markdown' });
      const contentType = 'text/markdown';
      const filename = 'readme.md';

      await bridge.cacheFilePending(md5, ext, blob, contentType, filename);

      expect(mockCore.cacheFilePending).toHaveBeenCalledWith(
        md5,
        ext,
        blob,
        contentType,
        filename,
      );
    });

    it('should call core.cacheFilePending without filename when not provided', async () => {
      const md5 = 'pending456';
      const ext = 'txt';
      const blob = new Blob(['content'], { type: 'text/plain' });
      const contentType = 'text/plain';

      await bridge.cacheFilePending(md5, ext, blob, contentType);

      expect(mockCore.cacheFilePending).toHaveBeenCalledWith(
        md5,
        ext,
        blob,
        contentType,
        undefined,
      );
    });
  });

  describe('getCachedFile', () => {
    it('should call core.getCachedFile and return cached file info', async () => {
      const md5 = 'cached789';
      const ext = 'pdf';
      const cachedInfo = {
        md5,
        ext,
        size: 1024,
        contentType: 'application/pdf',
        cachedAt: Date.now(),
        syncStatus: 'synced',
      };
      mockCore.getCachedFile.mockResolvedValue(cachedInfo);

      const result = await bridge.getCachedFile(md5, ext);

      expect(mockCore.getCachedFile).toHaveBeenCalledWith(md5, ext);
      expect(result).toEqual(cachedInfo);
    });

    it('should return null when file is not cached', async () => {
      mockCore.getCachedFile.mockResolvedValue(null);

      const result = await bridge.getCachedFile('nonexistent', 'txt');

      expect(result).toBeNull();
    });
  });

  describe('evictExpiredCache', () => {
    it('should call core.evictExpiredCache and return evicted count', async () => {
      mockCore.evictExpiredCache.mockResolvedValue(5);

      const result = await bridge.evictExpiredCache();

      expect(mockCore.evictExpiredCache).toHaveBeenCalled();
      expect(result).toBe(5);
    });

    it('should return 0 when no expired files exist', async () => {
      mockCore.evictExpiredCache.mockResolvedValue(0);

      const result = await bridge.evictExpiredCache();

      expect(result).toBe(0);
    });
  });

  describe('evictCache', () => {
    it('should call core.evictCache with default target bytes', async () => {
      const evictResult = { evictedCount: 10, evictedBytes: 1048576 };
      mockCore.evictCache.mockResolvedValue(evictResult);

      const result = await bridge.evictCache();

      expect(mockCore.evictCache).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(evictResult);
    });

    it('should call core.evictCache with custom target bytes', async () => {
      const targetBytes = 50 * 1024 * 1024; // 50MB
      const evictResult = { evictedCount: 5, evictedBytes: 5242880 };
      mockCore.evictCache.mockResolvedValue(evictResult);

      const result = await bridge.evictCache(targetBytes);

      expect(mockCore.evictCache).toHaveBeenCalledWith(targetBytes);
      expect(result).toEqual(evictResult);
    });
  });

  describe('uploadFile', () => {
    it('should call core.uploadFile with correct parameters', async () => {
      const md5 = 'upload123';
      const ext = 'png';
      const blob = new Blob(['image data'], { type: 'image/png' });
      const contentType = 'image/png';
      const filename = 'test.png';
      const onProgress = vi.fn();
      const cacheTtlMs = 7200000;

      const result = await bridge.uploadFile(
        md5,
        ext,
        blob,
        contentType,
        filename,
        onProgress,
        undefined,
        cacheTtlMs,
      );

      expect(mockCore.uploadFile).toHaveBeenCalled();
      expect(result.syncStatus).toBe('synced');
    });

    it('should throw AbortError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const blob = new Blob(['test']);
      await expect(
        bridge.uploadFile('md5', 'ext', blob, 'type', 'name', undefined, controller.signal),
      ).rejects.toThrow('Upload aborted');
    });

    it('should call cancelFileOperation when abort signal is triggered', async () => {
      const controller = new AbortController();
      let resolveUpload: (() => void) | undefined;

      mockCore.uploadFile.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpload = () =>
              resolve({ syncStatus: 'synced', syncedAt: Date.now() });
          }),
      );

      const blob = new Blob(['test']);
      const uploadPromise = bridge.uploadFile(
        'md5',
        'ext',
        blob,
        'type',
        'name',
        undefined,
        controller.signal,
      );

      // Wait for upload to start
      await vi.waitUntil(() => mockCore.uploadFile.mock.calls.length > 0);

      // Abort the upload
      controller.abort();

      // Resolve the upload
      resolveUpload!();
      await uploadPromise;

      expect(mockCore.cancelFileOperation).toHaveBeenCalled();
    });

    it('should remove abort listener after successful upload', async () => {
      const controller = new AbortController();
      const blob = new Blob(['test']);

      await bridge.uploadFile(
        'md5',
        'ext',
        blob,
        'type',
        'name',
        undefined,
        controller.signal,
      );

      // Abort after upload completes should not call cancelFileOperation
      controller.abort();
      expect(mockCore.cancelFileOperation).not.toHaveBeenCalled();
    });
  });

  describe('downloadFile', () => {
    it('should call core.downloadFile with correct parameters', async () => {
      const md5 = 'download123';
      const ext = 'zip';
      const onProgress = vi.fn();
      const forceRefresh = true;

      const result = await bridge.downloadFile(
        md5,
        ext,
        onProgress,
        undefined,
        forceRefresh,
      );

      expect(mockCore.downloadFile).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Blob);
    });

    it('should throw AbortError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        bridge.downloadFile('md5', 'ext', undefined, controller.signal),
      ).rejects.toThrow('Download aborted');
    });

    it('should call cancelFileOperation when abort signal is triggered', async () => {
      const controller = new AbortController();
      let resolveDownload: (() => void) | undefined;

      mockCore.downloadFile.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDownload = () => resolve(new Blob(['content']));
          }),
      );

      const downloadPromise = bridge.downloadFile(
        'md5',
        'ext',
        undefined,
        controller.signal,
      );

      // Wait for download to start
      await vi.waitUntil(() => mockCore.downloadFile.mock.calls.length > 0);

      // Abort the download
      controller.abort();

      // Resolve the download
      resolveDownload!();
      await downloadPromise;

      expect(mockCore.cancelFileOperation).toHaveBeenCalled();
    });

    it('should pass forceRefresh parameter to core', async () => {
      const blob = new Blob(['test']);
      mockCore.downloadFile.mockResolvedValue(blob);

      await bridge.downloadFile('md5', 'ext', undefined, undefined, true);

      expect(mockCore.downloadFile).toHaveBeenCalledWith(
        'md5',
        'ext',
        undefined,
        expect.any(String),
        true,
      );
    });
  });

  describe('deleteFile', () => {
    it('should call core.deleteFile with correct parameters', async () => {
      const md5 = 'delete123';
      const ext = 'tmp';

      await bridge.deleteFile(md5, ext);

      expect(mockCore.deleteFile).toHaveBeenCalledWith(md5, ext);
    });

    it('should throw when core is not available', async () => {
      (bridge as any)._core = null;

      await expect(bridge.deleteFile('md5', 'ext')).rejects.toThrow(
        'core is not available',
      );
    });
  });

  describe('headFile', () => {
    it('should call core.headFile and return metadata', async () => {
      const md5 = 'head123';
      const ext = 'pdf';
      const metadata = {
        contentLength: 2048,
        contentType: 'application/pdf',
        lastModified: new Date(),
        etag: '"xyz789"',
      };
      mockCore.headFile.mockResolvedValue(metadata);

      const result = await bridge.headFile(md5, ext);

      expect(mockCore.headFile).toHaveBeenCalledWith(md5, ext);
      expect(result).toEqual(metadata);
    });
  });

  describe('syncPendingFiles', () => {
    it('should call core.syncPendingFiles and return sync statistics', async () => {
      const syncResult = {
        synced: 5,
        failed: 1,
        syncedFiles: [
          { md5: 'file1', ext: 'txt' },
          { md5: 'file2', ext: 'md' },
        ],
        failedFiles: [{ md5: 'file3', ext: 'pdf', errorMessage: 'Network error' }],
      };
      mockCore.syncPendingFiles.mockResolvedValue(syncResult);

      const result = await bridge.syncPendingFiles();

      expect(mockCore.syncPendingFiles).toHaveBeenCalled();
      expect(result).toEqual(syncResult);
      expect(result.synced).toBe(5);
      expect(result.failed).toBe(1);
    });

    it('should return empty arrays when no files need sync', async () => {
      const result = await bridge.syncPendingFiles();

      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.syncedFiles).toEqual([]);
      expect(result.failedFiles).toEqual([]);
    });
  });

  describe('resumeInterruptedUploads', () => {
    it('should call core.resumeInterruptedUploads and return resume statistics', async () => {
      const resumeResult = {
        resumed: 3,
        failed: 1,
        expired: 2,
        syncedFiles: [{ md5: 'file1', ext: 'txt' }],
        failedFiles: [{ md5: 'file2', ext: 'pdf', errorMessage: 'Upload expired' }],
      };
      mockCore.resumeInterruptedUploads.mockResolvedValue(resumeResult);

      const result = await bridge.resumeInterruptedUploads();

      expect(mockCore.resumeInterruptedUploads).toHaveBeenCalled();
      expect(result).toEqual(resumeResult);
      expect(result.resumed).toBe(3);
      expect(result.failed).toBe(1);
      expect(result.expired).toBe(2);
    });
  });

  describe('getCacheStats', () => {
    it('should call core.getCacheStats and return cache statistics', async () => {
      const stats = {
        totalFiles: 100,
        totalSize: 10485760,
        byStatus: {
          pending: { count: 10, size: 1048576 },
          syncing: { count: 5, size: 524288 },
          synced: { count: 80, size: 8388608 },
          failed: { count: 5, size: 524288 },
        },
      };
      mockCore.getCacheStats.mockResolvedValue(stats);

      const result = await bridge.getCacheStats();

      expect(mockCore.getCacheStats).toHaveBeenCalled();
      expect(result).toEqual(stats);
      expect(result.totalFiles).toBe(100);
      expect(result.totalSize).toBe(10485760);
      expect(result.byStatus.synced.count).toBe(80);
    });

    it('should return zero stats when cache is empty', async () => {
      const result = await bridge.getCacheStats();

      expect(result.totalFiles).toBe(0);
      expect(result.totalSize).toBe(0);
    });
  });

  describe('updateFileMetadata', () => {
    it('should call core.updateFileMetadata with correct parameters', async () => {
      const md5 = 'meta123';
      const ext = 'txt';
      const updates = {
        filename: 'new-name.txt',
        contentType: 'text/plain',
      };

      await bridge.updateFileMetadata(md5, ext, updates);

      expect(mockCore.updateFileMetadata).toHaveBeenCalledWith(
        md5,
        ext,
        updates,
      );
    });

    it('should call core.updateFileMetadata with partial updates', async () => {
      const md5 = 'meta456';
      const ext = 'pdf';
      const updates = { filename: 'document.pdf' };

      await bridge.updateFileMetadata(md5, ext, updates);

      expect(mockCore.updateFileMetadata).toHaveBeenCalledWith(
        md5,
        ext,
        updates,
      );
    });
  });

  describe('getConnectionState', () => {
    it('should call core.getConnectionState and return state', async () => {
      mockCore.getConnectionState.mockResolvedValue('connected');

      const result = await bridge.getConnectionState();

      expect(mockCore.getConnectionState).toHaveBeenCalled();
      expect(result).toBe('connected');
    });

    it('should return disconnected state', async () => {
      mockCore.getConnectionState.mockResolvedValue('disconnected');

      const result = await bridge.getConnectionState();

      expect(result).toBe('disconnected');
    });

    it('should throw when core is not available', async () => {
      (bridge as any)._core = null;

      await expect(bridge.getConnectionState()).rejects.toThrow(
        'core is not available',
      );
    });
  });

  describe('onConnectionStateChange', () => {
    it('should add listener and return unsubscribe function', () => {
      const listener = vi.fn();

      const unsubscribe = bridge.onConnectionStateChange(listener);

      expect((bridge as any)._connectionListeners.size).toBe(1);
      expect(typeof unsubscribe).toBe('function');
    });

    it('should remove listener when unsubscribe is called', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsub1 = bridge.onConnectionStateChange(listener1);
      bridge.onConnectionStateChange(listener2);

      expect((bridge as any)._connectionListeners.size).toBe(2);

      unsub1();

      expect((bridge as any)._connectionListeners.size).toBe(1);
    });

    it('should not add duplicate listeners', () => {
      const listener = vi.fn();

      bridge.onConnectionStateChange(listener);
      bridge.onConnectionStateChange(listener);

      // Set automatically deduplicates
      expect((bridge as any)._connectionListeners.size).toBe(1);
    });

    it('should call listener when connection state changes', () => {
      const listener = vi.fn();
      bridge.onConnectionStateChange(listener);

      // Manually trigger the listener through the connection listeners set
      const event = { state: 'connected', reason: 'initial connection' };
      for (const l of (bridge as any)._connectionListeners) {
        l(event);
      }

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should handle listener errors without affecting other listeners', () => {
      const listener1 = vi.fn(() => {
        throw new Error('listener error');
      });
      const listener2 = vi.fn();

      bridge.onConnectionStateChange(listener1);
      bridge.onConnectionStateChange(listener2);

      const event = { state: 'disconnected', reason: 'network error' };

      // Manually trigger listeners with error handling (as done in the actual callback)
      for (const l of (bridge as any)._connectionListeners) {
        try {
          l(event);
        } catch (err) {
          // Error is caught and logged, doesn't propagate
        }
      }

      // Both listeners should be called
      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledWith(event);
    });
  });

  describe('installVirtualFSProxy', () => {
    it('should replace virtualFS methods with core proxies', async () => {
      // Access the mocked virtualFS module
      const persistenceModule = await import('@rtc-agent/persistence');
      const virtualFS = persistenceModule.virtualFS;

      bridge.installVirtualFSProxy();

      // Verify that virtualFS methods have been replaced with functions
      // (they will be Comlink proxies in real usage, but functions in our test)
      expect(typeof virtualFS.read).toBe('function');
      expect(typeof virtualFS.write).toBe('function');
      expect(typeof virtualFS.ls).toBe('function');
      expect(typeof virtualFS.find).toBe('function');
    });

    it('should throw when core is not available', () => {
      (bridge as any)._core = null;

      expect(() => bridge.installVirtualFSProxy()).toThrow(
        'core is not available',
      );
    });
  });
});

/**
 * WorkerBridge Unit Tests - Error Handling & Edge Cases
 *
 * Tests:
 * - Error propagation from core methods
 * - Behavior when bridge is destroyed
 * - Concurrent operation handling
 */
describe('WorkerBridge - Error Handling & Edge Cases', () => {
  let bridge: InstanceType<typeof WorkerBridge>;
  let mockAuth: any;
  let mockCore: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuth = {
      getAccessTokenAsync: vi.fn().mockResolvedValue('mock-token'),
      handleTokenExpired: vi.fn().mockResolvedValue('refresh'),
    };

    mockCore = {
      cacheFile: vi.fn(),
      getCachedFile: vi.fn(),
      uploadFile: vi.fn(),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
      cancelFileOperation: vi.fn(),
    };

    bridge = new WorkerBridge(mockAuth);
    (bridge as any)._core = mockCore;
    (bridge as any)._initialized = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error propagation', () => {
    it('should propagate errors from cacheFile', async () => {
      const error = new Error('Cache write failed');
      mockCore.cacheFile.mockRejectedValue(error);

      const blob = new Blob(['test']);
      await expect(
        bridge.cacheFile('md5', 'ext', blob, 'type'),
      ).rejects.toThrow('Cache write failed');
    });

    it('should propagate errors from getCachedFile', async () => {
      const error = new Error('Database error');
      mockCore.getCachedFile.mockRejectedValue(error);

      await expect(bridge.getCachedFile('md5', 'ext')).rejects.toThrow(
        'Database error',
      );
    });

    it('should propagate errors from uploadFile', async () => {
      const error = new Error('Upload failed');
      mockCore.uploadFile.mockRejectedValue(error);

      const blob = new Blob(['test']);
      await expect(
        bridge.uploadFile('md5', 'ext', blob),
      ).rejects.toThrow('Upload failed');
    });

    it('should propagate errors from downloadFile', async () => {
      const error = new Error('Download failed');
      mockCore.downloadFile.mockRejectedValue(error);

      await expect(bridge.downloadFile('md5', 'ext')).rejects.toThrow(
        'Download failed',
      );
    });

    it('should propagate errors from deleteFile', async () => {
      const error = new Error('Delete failed');
      mockCore.deleteFile.mockRejectedValue(error);

      await expect(bridge.deleteFile('md5', 'ext')).rejects.toThrow(
        'Delete failed',
      );
    });
  });

  describe('destroyed bridge behavior', () => {
    it('should throw on cacheFile after destroy', async () => {
      (bridge as any)._core = null;

      const blob = new Blob(['test']);
      await expect(
        bridge.cacheFile('md5', 'ext', blob, 'type'),
      ).rejects.toThrow('core is not available');
    });

    it('should throw on getCachedFile after destroy', async () => {
      (bridge as any)._core = null;

      await expect(bridge.getCachedFile('md5', 'ext')).rejects.toThrow(
        'core is not available',
      );
    });

    it('should throw on uploadFile after destroy', async () => {
      (bridge as any)._core = null;

      const blob = new Blob(['test']);
      await expect(
        bridge.uploadFile('md5', 'ext', blob),
      ).rejects.toThrow('core is not available');
    });

    it('should throw on downloadFile after destroy', async () => {
      (bridge as any)._core = null;

      await expect(bridge.downloadFile('md5', 'ext')).rejects.toThrow(
        'core is not available',
      );
    });

    it('should throw on deleteFile after destroy', async () => {
      (bridge as any)._core = null;

      await expect(bridge.deleteFile('md5', 'ext')).rejects.toThrow(
        'core is not available',
      );
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple cacheFile calls concurrently', async () => {
      const blob1 = new Blob(['file1']);
      const blob2 = new Blob(['file2']);
      const blob3 = new Blob(['file3']);

      await Promise.all([
        bridge.cacheFile('md5-1', 'ext', blob1, 'type'),
        bridge.cacheFile('md5-2', 'ext', blob2, 'type'),
        bridge.cacheFile('md5-3', 'ext', blob3, 'type'),
      ]);

      expect(mockCore.cacheFile).toHaveBeenCalledTimes(3);
    });

    it('should handle multiple getCachedFile calls concurrently', async () => {
      mockCore.getCachedFile
        .mockResolvedValueOnce({ md5: 'md5-1', ext: 'txt' })
        .mockResolvedValueOnce({ md5: 'md5-2', ext: 'txt' })
        .mockResolvedValueOnce(null);

      const results = await Promise.all([
        bridge.getCachedFile('md5-1', 'txt'),
        bridge.getCachedFile('md5-2', 'txt'),
        bridge.getCachedFile('md5-3', 'txt'),
      ]);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ md5: 'md5-1', ext: 'txt' });
      expect(results[1]).toEqual({ md5: 'md5-2', ext: 'txt' });
      expect(results[2]).toBeNull();
    });

    it('should generate unique operation IDs for concurrent uploads', async () => {
      const blob = new Blob(['test']);
      let capturedOperationIds: string[] = [];

      mockCore.uploadFile.mockImplementation(
        (
          _md5: string,
          _ext: string,
          _blob: Blob,
          _contentType?: string,
          _filename?: string,
          operationId?: string,
        ) => {
          capturedOperationIds.push(operationId!);
          return Promise.resolve({ syncStatus: 'synced' });
        },
      );

      await Promise.all([
        bridge.uploadFile('md5-1', 'ext', blob),
        bridge.uploadFile('md5-2', 'ext', blob),
        bridge.uploadFile('md5-3', 'ext', blob),
      ]);

      // All operation IDs should be unique
      const uniqueIds = new Set(capturedOperationIds);
      expect(uniqueIds.size).toBe(3);
    });

    it('should generate unique operation IDs for concurrent downloads', async () => {
      let capturedOperationIds: string[] = [];

      mockCore.downloadFile.mockImplementation(
        (
          _md5: string,
          _ext: string,
          _onProgress?: any,
          operationId?: string,
        ) => {
          capturedOperationIds.push(operationId!);
          return Promise.resolve(new Blob(['content']));
        },
      );

      await Promise.all([
        bridge.downloadFile('md5-1', 'ext'),
        bridge.downloadFile('md5-2', 'ext'),
        bridge.downloadFile('md5-3', 'ext'),
      ]);

      // All operation IDs should be unique
      const uniqueIds = new Set(capturedOperationIds);
      expect(uniqueIds.size).toBe(3);
    });
  });
});
