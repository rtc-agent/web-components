/**
 * Worker + Persistence Integration Tests
 *
 * Tests the data flow between Worker (via WorkerCore) and Persistence layer:
 * - File write operations through Worker → virtualFS → IndexedDB (mocked)
 * - Batch write operations with proper coordination
 * - File deletion and cleanup
 * - Error propagation from Persistence to Worker
 *
 * These tests verify the integration contract between Worker and Persistence
 * by mocking the Persistence layer at the virtualFS boundary. This ensures
 * that WorkerCore correctly calls Persistence APIs without requiring a full
 * IndexedDB implementation in the test environment.
 *
 * For tests that verify actual IndexedDB behavior, see persistence package tests.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { WorkerCore } from './worker-core.js';
import { virtualFS, getDatabase } from '@rtc-agent/persistence';

// Mock logger to avoid noise in tests
vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock performance API to avoid jsdom timing issues
const originalPerformance = global.performance;
beforeAll(() => {
  const mockPerformance = {
    mark: vi.fn(),
    measure: vi.fn(() => ({ duration: 0 })),
    clearMarks: vi.fn(),
    clearMeasures: vi.fn(),
    getEntriesByName: vi.fn(() => []),
    getEntriesByType: vi.fn(() => []),
    getEntries: vi.fn(() => []),
    now: vi.fn(() => Date.now()),
    timing: originalPerformance?.timing,
    navigation: originalPerformance?.navigation,
    onresourcetimingbufferfull: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    toJSON: vi.fn(() => ({})),
  };
  // @ts-ignore - Mocking performance for tests
  global.performance = mockPerformance;
});

afterAll(() => {
  global.performance = originalPerformance;
});

// Mock persistence layer at virtualFS boundary
vi.mock('@rtc-agent/persistence', () => ({
  virtualFS: {
    read: vi.fn(),
    write: vi.fn(),
    writeBatch: vi.fn(),
    remove: vi.fn(),
    exists: vi.fn(),
    stat: vi.fn(),
  },
  getDatabase: vi.fn(),
  initializeVirtualFS: vi.fn(),
}));

describe('Worker + Persistence Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database
    const mockDb = {
      fileSystemEntries: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      },
      ui_updates: {
        add: vi.fn(),
      },
      transaction: vi.fn().mockImplementation(async (_mode, ...args) => {
        const fn = args[args.length - 1];
        return fn();
      }),
    };

    vi.mocked(getDatabase).mockReturnValue(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear any performance marks to avoid cross-test pollution
    try {
      performance.clearMarks();
      performance.clearMeasures();
    } catch {
      // Ignore if not supported
    }
  });

  describe('File Write Operations', () => {
    it('should write file through WorkerCore to virtualFS', async () => {
      const workerCore = new WorkerCore();
      const filePath = '/test-file.txt';
      const content = 'Hello from Worker + Persistence!';

      // Mock virtualFS.write to succeed
      vi.mocked(virtualFS.write).mockResolvedValueOnce(undefined);

      // Write file through Worker
      await workerCore.batchWriteFiles([
        { path: filePath, content, mode: 'overwrite' },
      ]);

      // Verify virtualFS.writeBatch was called
      expect(virtualFS.writeBatch).toHaveBeenCalled();
      const callArgs = vi.mocked(virtualFS.writeBatch).mock.calls[0][0];
      expect(callArgs[0].path).toBe(filePath);
      expect(callArgs[0].content).toBe(content);
    });

    it('should handle multiple sequential writes', async () => {
      const workerCore = new WorkerCore();

      // Mock virtualFS.writeBatch to succeed
      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);

      // Write multiple files sequentially
      const files = [
        { path: '/file1.txt', content: 'Content 1', mode: 'overwrite' },
        { path: '/file2.txt', content: 'Content 2', mode: 'overwrite' },
        { path: '/file3.txt', content: 'Content 3', mode: 'overwrite' },
      ];

      for (const file of files) {
        await workerCore.batchWriteFiles([file]);
      }

      // Verify writeBatch was called for each file
      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(3);
    });

    it('should propagate errors from virtualFS', async () => {
      const workerCore = new WorkerCore();
      const filePath = '/error-test.txt';

      // Mock virtualFS.writeBatch to throw error
      vi.mocked(virtualFS.writeBatch).mockRejectedValueOnce(
        new Error('Simulated write error'),
      );

      // Attempt to write should fail
      await expect(
        workerCore.batchWriteFiles([
          { path: filePath, content: 'Content', mode: 'overwrite' },
        ]),
      ).rejects.toThrow('Simulated write error');
    });
  });

  describe('Batch Write Operations', () => {
    it('should write multiple files in single batch', async () => {
      const workerCore = new WorkerCore();
      const files = [
        { path: '/batch1.txt', content: 'Batch 1', mode: 'overwrite' },
        { path: '/batch2.txt', content: 'Batch 2', mode: 'overwrite' },
        { path: '/batch3.txt', content: 'Batch 3', mode: 'overwrite' },
      ];

      // Mock virtualFS.writeBatch to succeed
      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);

      await workerCore.batchWriteFiles(files);

      // Verify writeBatch was called
      expect(virtualFS.writeBatch).toHaveBeenCalled();
      const callArgs = vi.mocked(virtualFS.writeBatch).mock.calls[0][0];
      expect(callArgs).toHaveLength(3);
      expect(callArgs[0].path).toBe('/batch1.txt');
      expect(callArgs[1].path).toBe('/batch2.txt');
      expect(callArgs[2].path).toBe('/batch3.txt');
    });

    it('should handle batch write with mixed content types', async () => {
      const workerCore = new WorkerCore();
      const files = [
        { path: '/text.txt', content: 'Text content', mode: 'overwrite' },
        { path: '/json.json', content: '{"key":"value"}', mode: 'overwrite' },
        {
          path: '/code.js',
          content: 'console.log("test");',
          mode: 'overwrite',
        },
      ];

      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);

      await workerCore.batchWriteFiles(files);

      // Verify all files were passed to writeBatch
      expect(virtualFS.writeBatch).toHaveBeenCalled();
      const callArgs = vi.mocked(virtualFS.writeBatch).mock.calls[0][0];
      expect(callArgs).toHaveLength(3);
    });
  });

  describe('File Deletion', () => {
    it('should delete file through WorkerCore batchWriteFiles', async () => {
      const workerCore = new WorkerCore();
      const filePath = '/delete-test.txt';

      // Mock virtualFS.writeBatch and remove to succeed
      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);
      vi.mocked(virtualFS.remove).mockResolvedValue(undefined);

      // Delete file using batchWriteFiles with deletePaths
      await workerCore.batchWriteFiles([], [filePath]);

      // Verify virtualFS.remove was called
      expect(virtualFS.remove).toHaveBeenCalledWith(filePath);
    });

    it('should attempt to delete file even if virtualFS.remove fails', async () => {
      const workerCore = new WorkerCore();
      const filePath = '/delete-error.txt';

      // Mock virtualFS.remove to throw error
      vi.mocked(virtualFS.remove).mockRejectedValueOnce(
        new Error('Simulated delete error'),
      );

      // Attempt to delete - the error might be caught internally
      await workerCore.batchWriteFiles([], [filePath]);

      // Verify delete was attempted
      expect(virtualFS.remove).toHaveBeenCalledWith(filePath);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent writes to different files', async () => {
      const workerCore = new WorkerCore();

      // Mock virtualFS.writeBatch to succeed
      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);

      // Launch concurrent writes
      const promises = [
        workerCore.batchWriteFiles([
          { path: '/concurrent1.txt', content: 'C1', mode: 'overwrite' },
        ]),
        workerCore.batchWriteFiles([
          { path: '/concurrent2.txt', content: 'C2', mode: 'overwrite' },
        ]),
        workerCore.batchWriteFiles([
          { path: '/concurrent3.txt', content: 'C3', mode: 'overwrite' },
        ]),
      ];

      await Promise.all(promises);

      // Verify all writes were attempted
      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Protected Paths', () => {
    it('should skip writing to protected paths that have been edited by user', async () => {
      const workerCore = new WorkerCore();

      // Mock _isProtectedPath to protect AGENT.md
      vi.spyOn(workerCore as any, '_isProtectedPath').mockReturnValue(true);

      // Mock the database get to return a file that has been edited by user
      vi.mocked(getDatabase).mockReturnValue({
        fileSystemEntries: {
          get: vi.fn().mockResolvedValue({
            path: '/AGENT.md',
            metadata: { editedByUser: true },
          }),
          put: vi.fn(),
          delete: vi.fn(),
        },
        ui_updates: {
          add: vi.fn(),
        },
        transaction: vi.fn().mockImplementation(async (_mode, ...args) => {
          const fn = args[args.length - 1];
          return fn();
        }),
      } as any);

      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);

      // Attempt to write to protected path should skip the write
      await workerCore.batchWriteFiles([
        { path: '/AGENT.md', content: 'Protected', mode: 'overwrite' },
      ]);

      // Verify virtualFS.writeBatch was called with empty array (file was skipped)
      expect(virtualFS.writeBatch).toHaveBeenCalled();
      const callArgs = vi.mocked(virtualFS.writeBatch).mock.calls[0][0];
      expect(callArgs).toHaveLength(0);
    });

    it('should allow writing to non-protected paths', async () => {
      const workerCore = new WorkerCore();

      // Mock _isProtectedPath to return false
      vi.spyOn(workerCore as any, '_isProtectedPath').mockReturnValue(false);

      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);

      // Should succeed
      await workerCore.batchWriteFiles([
        { path: '/normal.txt', content: 'Normal', mode: 'overwrite' },
      ]);

      // Verify write was attempted
      expect(virtualFS.writeBatch).toHaveBeenCalled();
    });
  });

  describe('Large File Handling', () => {
    it('should handle large file writes', async () => {
      const workerCore = new WorkerCore();
      const filePath = '/large-file.txt';

      // Create large content (1MB)
      const content = 'x'.repeat(1024 * 1024);

      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);

      await workerCore.batchWriteFiles([
        { path: filePath, content, mode: 'overwrite' },
      ]);

      // Verify large file write was attempted
      expect(virtualFS.writeBatch).toHaveBeenCalled();
      const callArgs = vi.mocked(virtualFS.writeBatch).mock.calls[0][0];
      expect(callArgs[0].path).toBe(filePath);
      expect(callArgs[0].content).toBe(content);
    });
  });

  describe('Metadata Handling', () => {
    it('should pass metadata to virtualFS with editedByUser flag', async () => {
      const workerCore = new WorkerCore();
      const filePath = '/metadata-test.txt';
      const metadata = { mtime: '2026-10-15T10:00:00Z' };

      vi.mocked(virtualFS.writeBatch).mockResolvedValue(undefined);

      await workerCore.batchWriteFiles([
        {
          path: filePath,
          content: 'Content',
          mode: 'overwrite',
          metadata,
        },
      ]);

      // Verify metadata was transformed to metadataOverride with editedByUser
      expect(virtualFS.writeBatch).toHaveBeenCalled();
      const callArgs = vi.mocked(virtualFS.writeBatch).mock.calls[0][0];
      expect(callArgs[0].path).toBe(filePath);
      expect(callArgs[0].metadataOverride).toBeDefined();
      expect(callArgs[0].metadataOverride.editedByUser).toBe(false);
    });
  });
});
