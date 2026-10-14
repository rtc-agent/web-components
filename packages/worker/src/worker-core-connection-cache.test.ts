/**
 * WorkerCore Connection & Cache Operations Tests
 *
 * Tests for:
 * - Connection management (connect, reconnect, getConnectionState)
 * - Cache operations (cacheFile, getCachedFile, evictCache, etc.)
 * - File sync operations (resumeInterruptedUploads, getCacheStats, updateFileMetadata)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerCore } from './worker-core.js';

// Mock dependencies
vi.mock('@rtc-agent/persistence', () => ({
  virtualFS: {
    write: vi.fn(),
    writeBatch: vi.fn(),
    remove: vi.fn(),
  },
  getDatabase: vi.fn(),
  initializeVirtualFS: vi.fn(),
}));

vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('WorkerCore - Connection Management', () => {
  let workerCore: WorkerCore;
  let mockLayer: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLayer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      reconnect: vi.fn().mockResolvedValue(undefined),
      getClient: vi.fn().mockReturnValue({
        getConnectionState: vi.fn().mockReturnValue('disconnected'),
        on: vi.fn().mockReturnValue(() => {}),
      }),
    };

    workerCore = new WorkerCore();
    (workerCore as any).layer = mockLayer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect()', () => {
    it('should delegate connect to layer', async () => {
      await workerCore.connect();
      expect(mockLayer.connect).toHaveBeenCalled();
    });
  });

  describe('reconnect()', () => {
    it('should delegate reconnect to layer', async () => {
      await workerCore.reconnect();
      expect(mockLayer.reconnect).toHaveBeenCalled();
    });
  });

  describe('getConnectionState()', () => {
    it('should return connection state from layer client', async () => {
      const state = await workerCore.getConnectionState();
      expect(mockLayer.getClient).toHaveBeenCalled();
      expect(state).toBe('disconnected');
    });
  });
});

describe('WorkerCore - Cache Operations', () => {
  let workerCore: WorkerCore;
  let mockLayer: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLayer = {
      cacheFile: vi.fn().mockResolvedValue(undefined),
      cacheFilePending: vi.fn().mockResolvedValue(undefined),
      getCachedFile: vi.fn().mockResolvedValue(null),
      evictExpiredCache: vi.fn().mockResolvedValue(undefined),
      evictCache: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      getFileOpCoordinator: vi.fn().mockReturnValue({
        createAbortController: vi.fn().mockReturnValue({
          signal: {},
          abort: vi.fn(),
        }),
      }),
    };

    workerCore = new WorkerCore();
    (workerCore as any).layer = mockLayer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cacheFile()', () => {
    it('should delegate cacheFile to layer', async () => {
      const blob = new Blob(['test']);
      await workerCore.cacheFile('md5', 'txt', blob, 'text/plain');
      expect(mockLayer.cacheFile).toHaveBeenCalledWith(
        'md5',
        'txt',
        blob,
        'text/plain',
        undefined,
      );
    });
  });

  describe('cacheFilePending()', () => {
    it('should delegate cacheFilePending to layer', async () => {
      const blob = new Blob(['test']);
      await workerCore.cacheFilePending(
        'md5',
        'txt',
        blob,
        'text/plain',
        'test.txt',
      );
      expect(mockLayer.cacheFilePending).toHaveBeenCalledWith(
        'md5',
        'txt',
        blob,
        'text/plain',
        'test.txt',
      );
    });
  });

  describe('getCachedFile()', () => {
    it('should delegate getCachedFile to layer', async () => {
      const result = await workerCore.getCachedFile('md5', 'txt');
      expect(mockLayer.getCachedFile).toHaveBeenCalledWith('md5', 'txt');
      expect(result).toBeNull();
    });
  });

  describe('evictExpiredCache()', () => {
    it('should delegate evictExpiredCache to layer', async () => {
      await workerCore.evictExpiredCache();
      expect(mockLayer.evictExpiredCache).toHaveBeenCalled();
    });
  });

  describe('evictCache()', () => {
    it('should delegate evictCache to layer', async () => {
      await workerCore.evictCache(1000);
      expect(mockLayer.evictCache).toHaveBeenCalledWith(1000);
    });
  });

  describe('deleteFile()', () => {
    it('should delegate deleteFile to layer', async () => {
      await workerCore.deleteFile('md5', 'txt');
      expect(mockLayer.deleteFile).toHaveBeenCalledWith('md5', 'txt');
    });
  });
});

describe('WorkerCore - File Sync Operations', () => {
  let workerCore: WorkerCore;
  let mockLayer: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLayer = {
      resumeInterruptedUploads: vi.fn().mockResolvedValue({
        expired: 0,
        syncedFiles: [],
        failedFiles: [],
      }),
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
      broadcastUIUpdate: vi.fn(),
    };

    workerCore = new WorkerCore();
    (workerCore as any).layer = mockLayer;
    (workerCore as any)._broadcastFileSyncStatus = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resumeInterruptedUploads()', () => {
    it('should delegate resumeInterruptedUploads to layer', async () => {
      const result = await workerCore.resumeInterruptedUploads();
      expect(mockLayer.resumeInterruptedUploads).toHaveBeenCalled();
      expect(result).toEqual({
        expired: 0,
        syncedFiles: [],
        failedFiles: [],
      });
    });
  });

  describe('getCacheStats()', () => {
    it('should delegate getCacheStats to layer', async () => {
      const result = await workerCore.getCacheStats();
      expect(mockLayer.getCacheStats).toHaveBeenCalled();
      expect(result).toEqual({
        totalFiles: 0,
        totalSize: 0,
        byStatus: {
          pending: { count: 0, size: 0 },
          syncing: { count: 0, size: 0 },
          synced: { count: 0, size: 0 },
          failed: { count: 0, size: 0 },
        },
      });
    });
  });

  describe('updateFileMetadata()', () => {
    it('should delegate updateFileMetadata to layer', async () => {
      await workerCore.updateFileMetadata('md5', 'txt', {
        filename: 'new-name.txt',
      });
      expect(mockLayer.updateFileMetadata).toHaveBeenCalledWith(
        'md5',
        'txt',
        { filename: 'new-name.txt' },
      );
    });
  });
});
