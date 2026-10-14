/**
 * WorkerCore Wrapper Methods Tests
 *
 * Tests for wrapper methods that delegate to the persistence layer:
 * - Session operations
 * - Message operations
 * - RTC operations
 * - Debug history operations
 * - Flush operations
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

describe('WorkerCore - Wrapper Methods', () => {
  let workerCore: WorkerCore;
  let mockLayer: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock persistence layer methods
    mockLayer = {
      listSessions: vi.fn().mockResolvedValue([]),
      getSession: vi.fn().mockResolvedValue(undefined),
      listMessages: vi.fn().mockResolvedValue([]),
      getMessage: vi.fn().mockResolvedValue(undefined),
      listRtc: vi.fn().mockResolvedValue([]),
      getNextRtcToProcess: vi.fn().mockResolvedValue(undefined),
      addDebugHistoryItem: vi.fn().mockResolvedValue(undefined),
      queryDebugHistory: vi.fn().mockResolvedValue([]),
      countDebugHistory: vi.fn().mockResolvedValue(0),
      clearDebugHistory: vi.fn().mockResolvedValue(undefined),
      batchDeleteDebugHistory: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      insertLocalMessage: vi.fn().mockResolvedValue(undefined),
      stopTurn: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      openSession: vi.fn().mockResolvedValue(undefined),
      compactSession: vi.fn().mockResolvedValue(undefined),
      submitRtcResult: vi.fn().mockResolvedValue(undefined),
      forkSession: vi.fn().mockResolvedValue(undefined),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      updateSessionTitle: vi.fn().mockResolvedValue(undefined),
      flushAll: vi.fn().mockResolvedValue(undefined),
      initializeVirtualFS: vi.fn().mockResolvedValue(undefined),
      virtualFSRead: vi.fn().mockResolvedValue(null),
      virtualFSWrite: vi.fn().mockResolvedValue(undefined),
      virtualFSLs: vi.fn().mockResolvedValue([]),
      virtualFSFind: vi.fn().mockResolvedValue([]),
      virtualFSGrep: vi.fn().mockResolvedValue([]),
      virtualFSQueryByType: vi.fn().mockResolvedValue([]),
      virtualFSExists: vi.fn().mockResolvedValue(false),
      virtualFSRemove: vi.fn().mockResolvedValue(undefined),
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
      resumeInterruptedUploads: vi.fn().mockResolvedValue({
        expired: 0,
        syncedFiles: [],
        failedFiles: [],
      }),
    };

    workerCore = new WorkerCore();
    // Inject mock layer
    (workerCore as any).layer = mockLayer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Session operations', () => {
    it('should delegate listSessions to layer', async () => {
      const result = await workerCore.listSessions();
      expect(mockLayer.listSessions).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should delegate getSession to layer', async () => {
      const result = await workerCore.getSession('test-client-id');
      expect(mockLayer.getSession).toHaveBeenCalledWith('test-client-id');
      expect(result).toBeUndefined();
    });

    it('should delegate deleteSession to layer', async () => {
      await workerCore.deleteSession('test-client-id');
      expect(mockLayer.deleteSession).toHaveBeenCalledWith('test-client-id');
    });

    it('should delegate updateSessionTitle to layer', async () => {
      await workerCore.updateSessionTitle('test-client-id', 'new-title');
      expect(mockLayer.updateSessionTitle).toHaveBeenCalledWith(
        'test-client-id',
        'new-title',
      );
    });

    it('should delegate closeSession to layer', async () => {
      await workerCore.closeSession('test-client-id');
      expect(mockLayer.closeSession).toHaveBeenCalledWith('test-client-id');
    });

    it('should delegate openSession to layer', async () => {
      await workerCore.openSession('test-client-id');
      expect(mockLayer.openSession).toHaveBeenCalledWith('test-client-id');
    });

    it('should delegate compactSession to layer', async () => {
      await workerCore.compactSession('test-client-id', 100);
      expect(mockLayer.compactSession).toHaveBeenCalledWith(
        'test-client-id',
        100,
      );
    });

    it('should delegate forkSession to layer', async () => {
      const params = {
        sourceClientId: 'source-id',
        sourceMessageId: 'msg-id',
        targetClientId: 'target-id',
      };
      await workerCore.forkSession(params);
      expect(mockLayer.forkSession).toHaveBeenCalledWith(params);
    });
  });

  describe('Message operations', () => {
    it('should delegate listMessages to layer', async () => {
      const result = await workerCore.listMessages('test-client-id');
      expect(mockLayer.listMessages).toHaveBeenCalledWith('test-client-id', undefined, undefined, undefined);
      expect(result).toEqual([]);
    });

    it('should delegate getMessage to layer', async () => {
      const result = await workerCore.getMessage('test-client-id');
      expect(mockLayer.getMessage).toHaveBeenCalledWith('test-client-id');
      expect(result).toBeUndefined();
    });

    it('should delegate sendMessage to layer', async () => {
      const params = {
        sessionClientId: 'test-client-id',
        content: 'test-content',
      };
      await workerCore.sendMessage(params);
      expect(mockLayer.sendMessage).toHaveBeenCalledWith(params);
    });

    it('should delegate insertLocalMessage to layer', async () => {
      const params = {
        sessionClientId: 'test-client-id',
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'test' }],
      };
      await workerCore.insertLocalMessage(params);
      expect(mockLayer.insertLocalMessage).toHaveBeenCalledWith(params);
    });
  });

  describe('RTC operations', () => {
    it('should delegate listRtc to layer', async () => {
      const result = await workerCore.listRtc('test-client-id');
      expect(mockLayer.listRtc).toHaveBeenCalledWith('test-client-id', undefined, undefined);
      expect(result).toEqual([]);
    });

    it('should delegate getNextRtcToProcess to layer', async () => {
      const result = await workerCore.getNextRtcToProcess('test-client-id');
      expect(mockLayer.getNextRtcToProcess).toHaveBeenCalledWith(
        'test-client-id',
      );
      expect(result).toBeUndefined();
    });

    it('should delegate submitRtcResult to layer', async () => {
      const params = {
        rtcClientId: 'rtc-id',
        result: { content: 'test' },
      };
      await workerCore.submitRtcResult(params);
      expect(mockLayer.submitRtcResult).toHaveBeenCalledWith(params);
    });

    it('should delegate stopTurn to layer', async () => {
      await workerCore.stopTurn('test-client-id');
      expect(mockLayer.stopTurn).toHaveBeenCalledWith('test-client-id');
    });
  });

  describe('Debug history operations', () => {
    it('should delegate addDebugHistoryItem to layer', async () => {
      const item = {
        functionName: 'test-fn',
        timestamp: Date.now(),
        args: {},
        result: {},
      };
      await workerCore.addDebugHistoryItem(item);
      expect(mockLayer.addDebugHistoryItem).toHaveBeenCalledWith(item);
    });

    it('should delegate queryDebugHistory to layer', async () => {
      const result = await workerCore.queryDebugHistory('test-fn', undefined, 10);
      expect(mockLayer.queryDebugHistory).toHaveBeenCalledWith('test-fn', undefined, 10);
      expect(result).toEqual([]);
    });

    it('should delegate countDebugHistory to layer', async () => {
      const result = await workerCore.countDebugHistory('test-fn');
      expect(mockLayer.countDebugHistory).toHaveBeenCalledWith('test-fn');
      expect(result).toBe(0);
    });

    it('should delegate clearDebugHistory to layer', async () => {
      await workerCore.clearDebugHistory();
      expect(mockLayer.clearDebugHistory).toHaveBeenCalled();
    });

    it('should delegate batchDeleteDebugHistory to layer', async () => {
      const ids = ['id1', 'id2'];
      await workerCore.batchDeleteDebugHistory(ids);
      expect(mockLayer.batchDeleteDebugHistory).toHaveBeenCalledWith(ids);
    });
  });

  describe('Flush operations', () => {
    it('should delegate flushAll to layer', async () => {
      await workerCore.flushAll();
      expect(mockLayer.flushAll).toHaveBeenCalled();
    });
  });
});
