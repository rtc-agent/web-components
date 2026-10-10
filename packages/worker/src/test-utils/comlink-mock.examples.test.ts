/**
 * Comlink Proxy Mock Usage Examples
 *
 * This file demonstrates how to use the comprehensive Comlink proxy mock
 * for testing Worker-related code.
 *
 * The mock provides:
 * - Type-safe implementations for all WorkerPersistenceCore methods
 * - Sensible defaults that can be overridden per test
 * - Proper async/Promise handling
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createWorkerBridgeMock,
  createWorkerCallbacksMock,
  type WorkerBridgeMock,
  type WorkerCallbacksMock,
} from './comlink-mock.js';

describe('Comlink Proxy Mock Examples', () => {
  let mockBridge: WorkerBridgeMock;
  let mockCallbacks: WorkerCallbacksMock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridge = createWorkerBridgeMock();
    mockCallbacks = createWorkerCallbacksMock();
  });

  describe('Basic Usage', () => {
    it('should use default mock values', async () => {
      // All methods return sensible defaults
      const sessions = await mockBridge.listSessions();
      expect(sessions).toEqual([]);

      const state = await mockBridge.getConnectionState();
      expect(state).toBe('disconnected');

      const result = await mockBridge.ping();
      expect(result).toBe('pong');
    });

    it('should override default values per test', async () => {
      // Override listSessions to return test data
      mockBridge.listSessions.mockResolvedValue([
        { clientId: 'session-1', title: 'Test Session 1' },
        { clientId: 'session-2', title: 'Test Session 2' },
      ]);

      const sessions = await mockBridge.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].title).toBe('Test Session 1');
    });

    it('should mock error scenarios', async () => {
      // Simulate connection failure
      mockBridge.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(mockBridge.connect()).rejects.toThrow('Connection failed');
    });
  });

  describe('Callback Management', () => {
    it('should register and unregister callbacks', () => {
      mockBridge.registerCallback(mockCallbacks);
      expect(mockBridge.registerCallback).toHaveBeenCalledWith(mockCallbacks);

      mockBridge.unregisterCallback(mockCallbacks);
      expect(mockBridge.unregisterCallback).toHaveBeenCalledWith(mockCallbacks);
    });

    it('should invoke callback methods', async () => {
      // Simulate UI update broadcast
      const payload = {
        event: { entity: 'session', action: 'created', entityId: '123' },
        seq: 42,
      };

      await mockCallbacks.onUIUpdate(payload);
      expect(mockCallbacks.onUIUpdate).toHaveBeenCalledWith(payload);
    });

    it('should mock token requests', async () => {
      mockCallbacks.requestToken.mockResolvedValue('custom-token-123');

      const token = await mockCallbacks.requestToken();
      expect(token).toBe('custom-token-123');
    });
  });

  describe('Session Operations', () => {
    it('should mock sendMessage', async () => {
      mockBridge.sendMessage.mockResolvedValue({
        session: { clientId: 'session-1', title: 'New Session' },
        message: { clientId: 'msg-1', content: 'Hello' },
      });

      const result = await mockBridge.sendMessage({
        content: { text: 'Hello' },
        messageClientId: 'msg-1',
        sessionClientId: 'session-1',
      });

      expect(result.session.clientId).toBe('session-1');
      expect(result.message.clientId).toBe('msg-1');
    });

    it('should mock listMessages', async () => {
      mockBridge.listMessages.mockResolvedValue([
        { clientId: 'msg-1', content: 'Message 1' },
        { clientId: 'msg-2', content: 'Message 2' },
      ]);

      const messages = await mockBridge.listMessages('session-1');
      expect(messages).toHaveLength(2);
    });
  });

  describe('Virtual File System', () => {
    it('should mock file operations', async () => {
      // Mock reading a file
      mockBridge.virtualFSRead.mockResolvedValue('File content here');

      const content = await mockBridge.virtualFSRead('/AGENT.md');
      expect(content).toBe('File content here');

      // Mock writing a file
      mockBridge.virtualFSWrite.mockResolvedValue(100); // bytes written

      const bytesWritten = await mockBridge.virtualFSWrite(
        '/test.txt',
        'Test content',
        'overwrite',
      );
      expect(bytesWritten).toBe(100);

      // Mock listing files
      mockBridge.virtualFSLs.mockResolvedValue(['/file1.txt', '/file2.txt']);

      const files = await mockBridge.virtualFSLs('/');
      expect(files).toHaveLength(2);
    });

    it('should mock batch write operations', async () => {
      const files = [
        { path: '/file1.txt', content: 'Content 1' },
        { path: '/file2.txt', content: 'Content 2' },
      ];

      await mockBridge.batchWriteFiles(files, ['/old-file.txt']);

      expect(mockBridge.batchWriteFiles).toHaveBeenCalledWith(
        files,
        ['/old-file.txt'],
      );
    });
  });

  describe('File Cache & S3 Operations', () => {
    it('should mock file caching', async () => {
      const blob = new Blob(['test content'], { type: 'text/plain' });

      await mockBridge.cacheFile(
        'abc123',
        'txt',
        blob,
        'text/plain',
        7 * 24 * 60 * 60 * 1000, // 7 days
      );

      expect(mockBridge.cacheFile).toHaveBeenCalled();
    });

    it('should mock file upload', async () => {
      mockBridge.uploadFile.mockResolvedValue({
        syncStatus: 'synced',
        syncedAt: Date.now(),
      });

      const blob = new Blob(['test content'], { type: 'text/plain' });
      const result = await mockBridge.uploadFile(
        'abc123',
        'txt',
        blob,
        'text/plain',
      );

      expect(result.syncStatus).toBe('synced');
      expect(result.syncedAt).toBeDefined();
    });

    it('should mock file download', async () => {
      const testBlob = new Blob(['downloaded content'], { type: 'text/plain' });
      mockBridge.downloadFile.mockResolvedValue(testBlob);

      const downloaded = await mockBridge.downloadFile('abc123', 'txt');
      expect(downloaded).toBe(testBlob);
    });
  });

  describe('Connection State', () => {
    it('should mock connection state changes', async () => {
      mockBridge.getConnectionState.mockResolvedValue('connected');

      const state = await mockBridge.getConnectionState();
      expect(state).toBe('connected');
    });

    it('should mock connection lifecycle', async () => {
      await mockBridge.connect();
      expect(mockBridge.connect).toHaveBeenCalled();

      await mockBridge.disconnect();
      expect(mockBridge.disconnect).toHaveBeenCalled();
    });
  });

  describe('Catch-Up Events', () => {
    it('should mock getCatchUpEvents with gap', async () => {
      mockBridge.getCatchUpEvents.mockResolvedValue({
        entries: [
          { seq: 1, event: { entity: 'session' } },
          { seq: 2, event: { entity: 'message' } },
        ],
        hasGap: true,
        hasMore: false,
      });

      const result = await mockBridge.getCatchUpEvents(0);
      expect(result.entries).toHaveLength(2);
      expect(result.hasGap).toBe(true);
    });

    it('should mock getCatchUpEvents with hasMore', async () => {
      mockBridge.getCatchUpEvents.mockResolvedValue({
        entries: [{ seq: 1, event: {} }],
        hasGap: false,
        hasMore: true,
      });

      const result = await mockBridge.getCatchUpEvents(0, 1);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('Debug History', () => {
    it('should mock debug history operations', async () => {
      mockBridge.queryDebugHistory.mockResolvedValue({
        items: [
          { id: '1', functionName: 'test', timestamp: Date.now() },
        ],
        nextCursor: 'cursor-1',
      });

      const result = await mockBridge.queryDebugHistory('test', undefined, 10);
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe('cursor-1');
    });
  });

  describe('Cache Statistics', () => {
    it('should mock cache stats', async () => {
      mockBridge.getCacheStats.mockResolvedValue({
        totalFiles: 100,
        totalSize: 1024 * 1024, // 1MB
        byStatus: {
          pending: { count: 10, size: 1024 },
          syncing: { count: 5, size: 512 },
          synced: { count: 80, size: 900 * 1024 },
          failed: { count: 5, size: 1024 },
        },
      });

      const stats = await mockBridge.getCacheStats();
      expect(stats.totalFiles).toBe(100);
      expect(stats.byStatus.synced.count).toBe(80);
    });
  });

  describe('Verification Patterns', () => {
    it('should verify method calls with specific arguments', async () => {
      await mockBridge.updateSessionTitle('session-1', 'New Title');

      expect(mockBridge.updateSessionTitle).toHaveBeenCalledWith(
        'session-1',
        'New Title',
      );
    });

    it('should verify method call count', async () => {
      await mockBridge.listSessions();
      await mockBridge.listSessions();

      expect(mockBridge.listSessions).toHaveBeenCalledTimes(2);
    });

    it('should verify method call order', async () => {
      await mockBridge.connect();
      await mockBridge.listSessions();
      await mockBridge.disconnect();

      // Verify all methods were called
      expect(mockBridge.connect).toHaveBeenCalled();
      expect(mockBridge.listSessions).toHaveBeenCalled();
      expect(mockBridge.disconnect).toHaveBeenCalled();

      // Verify call count
      expect(mockBridge.connect).toHaveBeenCalledTimes(1);
      expect(mockBridge.listSessions).toHaveBeenCalledTimes(1);
      expect(mockBridge.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
