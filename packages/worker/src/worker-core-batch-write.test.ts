/**
 * WorkerCore Batch Write Tests
 *
 * Tests for batchWriteFiles method:
 * - Transaction-based atomicity (Fix 55)
 * - Protected file handling
 * - Delete path operations
 * - Broadcast behavior
 * - Metadata handling
 * - Edge cases and error scenarios
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerCore } from './worker-core.js';
import { virtualFS } from '@rtc-agent/persistence';

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

describe('WorkerCore - batchWriteFiles', () => {
  let workerCore: WorkerCore;
  let mockDb: any;
  let mockBroadcastUIUpdate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database with transaction support
    mockDb = {
      fileSystemEntries: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      },
      ui_updates: {
        add: vi.fn(),
      },
      transaction: vi.fn().mockImplementation(async (_mode, ...args) => {
        // Last argument is the transaction function
        const fn = args[args.length - 1];
        // Execute the transaction function
        return fn();
      }),
    };

    const persistence = await import('@rtc-agent/persistence');
    vi.mocked(persistence.getDatabase).mockReturnValue(mockDb);

    // Create WorkerCore instance
    workerCore = new WorkerCore();

    // Mock broadcastUIUpdate
    mockBroadcastUIUpdate = vi.fn();
    (workerCore as any).broadcastUIUpdate = mockBroadcastUIUpdate;

    // Mock _isProtectedPath
    (workerCore as any)._isProtectedPath = vi
      .fn()
      .mockImplementation((path: string) => {
        return path === '/AGENT.md' || path.startsWith('/scenarios/');
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('transaction atomicity', () => {
    it('should commit all writes when all succeed', async () => {
      const files = [
        { path: '/file1.txt', content: 'content1' },
        { path: '/file2.txt', content: 'content2' },
        { path: '/file3.txt', content: 'content3' },
      ];

      await workerCore.batchWriteFiles(files);

      // Verify writeBatch was called with all files
      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(1);
      expect(virtualFS.writeBatch).toHaveBeenCalledWith([
        {
          path: '/file1.txt',
          content: 'content1',
          mode: 'overwrite',
          metadataOverride: { editedByUser: false },
        },
        {
          path: '/file2.txt',
          content: 'content2',
          mode: 'overwrite',
          metadataOverride: { editedByUser: false },
        },
        {
          path: '/file3.txt',
          content: 'content3',
          mode: 'overwrite',
          metadataOverride: { editedByUser: false },
        },
      ]);

      // Verify broadcast was called
      expect(mockBroadcastUIUpdate).toHaveBeenCalledTimes(1);
    });

    it('should rollback all writes when one fails', async () => {
      const files = [
        { path: '/file1.txt', content: 'content1' },
        { path: '/file2.txt', content: 'content2' },
        { path: '/file3.txt', content: 'content3' },
      ];

      // Mock transaction to simulate failure
      mockDb.transaction.mockImplementation(
        async (_mode: string, ...args: any[]) => {
          // Last argument is the transaction function
          const fn = args[args.length - 1] as () => Promise<any>;
          try {
            return await fn();
          } catch (err) {
            // Transaction rollback happens automatically
            throw err;
          }
        },
      );

      // Mock virtualFS.writeBatch to fail
      vi.mocked(virtualFS.writeBatch).mockRejectedValue(new Error('Write failed'));

      // Should throw
      await expect(workerCore.batchWriteFiles(files)).rejects.toThrow(
        'Write failed',
      );

      // Verify broadcast was NOT called (transaction failed)
      expect(mockBroadcastUIUpdate).not.toHaveBeenCalled();
    });

    it('should use Dexie transaction for atomicity', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      await workerCore.batchWriteFiles(files);

      // Verify transaction was called with 'rw' mode and both tables
      expect(mockDb.transaction).toHaveBeenCalledWith(
        'rw',
        mockDb.fileSystemEntries,
        mockDb.ui_updates,
        expect.any(Function),
      );
    });
  });

  describe('protected files', () => {
    it('should skip protected files edited by user', async () => {
      const files = [
        { path: '/AGENT.md', content: 'system content' },
        { path: '/file1.txt', content: 'content1' },
      ];

      // Mock existing file with editedByUser=true
      mockDb.fileSystemEntries.get.mockResolvedValue({
        path: '/AGENT.md',
        content: 'user edited',
        metadata: { editedByUser: true },
      });

      await workerCore.batchWriteFiles(files);

      // Only file1.txt should be written, AGENT.md should be skipped
      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(1);
      expect(virtualFS.writeBatch).toHaveBeenCalledWith([
        {
          path: '/file1.txt',
          content: 'content1',
          mode: 'overwrite',
          metadataOverride: { editedByUser: false },
        },
      ]);
    });

    it('should overwrite protected files not edited by user', async () => {
      const files = [{ path: '/AGENT.md', content: 'system content' }];

      // Mock existing file without editedByUser
      mockDb.fileSystemEntries.get.mockResolvedValue({
        path: '/AGENT.md',
        content: 'old system content',
        metadata: { editedByUser: false },
      });

      await workerCore.batchWriteFiles(files);

      // AGENT.md should be overwritten
      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(1);
      expect(virtualFS.writeBatch).toHaveBeenCalledWith([
        {
          path: '/AGENT.md',
          content: 'system content',
          mode: 'overwrite',
          metadataOverride: { editedByUser: false },
        },
      ]);
    });

    it('should create protected files if they do not exist', async () => {
      const files = [{ path: '/AGENT.md', content: 'new content' }];

      // Mock file does not exist
      mockDb.fileSystemEntries.get.mockResolvedValue(undefined);

      await workerCore.batchWriteFiles(files);

      // AGENT.md should be created
      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(1);
      expect(virtualFS.writeBatch).toHaveBeenCalledWith([
        {
          path: '/AGENT.md',
          content: 'new content',
          mode: 'overwrite',
          metadataOverride: { editedByUser: false },
        },
      ]);
    });
  });

  describe('delete paths', () => {
    it('should delete specified paths after writes', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];
      const deletePaths = ['/old1.txt', '/old2.txt'];

      await workerCore.batchWriteFiles(files, deletePaths);

      // Verify deletes were called
      expect(virtualFS.remove).toHaveBeenCalledTimes(2);
      expect(virtualFS.remove).toHaveBeenNthCalledWith(1, '/old1.txt');
      expect(virtualFS.remove).toHaveBeenNthCalledWith(2, '/old2.txt');
    });

    it('should continue if delete fails', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];
      const deletePaths = ['/old1.txt', '/old2.txt'];

      // Mock first delete to fail
      vi.mocked(virtualFS.remove).mockImplementation(async (path) => {
        if (path === '/old1.txt') {
          throw new Error('Delete failed');
        }
      });

      // Should not throw
      await expect(
        workerCore.batchWriteFiles(files, deletePaths),
      ).resolves.not.toThrow();

      // Both deletes should be attempted
      expect(virtualFS.remove).toHaveBeenCalledTimes(2);

      // Broadcast should still happen (delete failures are logged but don't fail the batch)
      expect(mockBroadcastUIUpdate).toHaveBeenCalledTimes(1);
    });

    it('should handle empty deletePaths array', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      await workerCore.batchWriteFiles(files, []);

      // No deletes should be called
      expect(virtualFS.remove).not.toHaveBeenCalled();

      // Broadcast should happen
      expect(mockBroadcastUIUpdate).toHaveBeenCalledTimes(1);
    });

    it('should handle undefined deletePaths', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      await workerCore.batchWriteFiles(files, undefined);

      // No deletes should be called
      expect(virtualFS.remove).not.toHaveBeenCalled();
    });
  });

  describe('broadcast behavior', () => {
    it('should broadcast only after successful transaction', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      await workerCore.batchWriteFiles(files);

      // Verify broadcast was called with correct parameters
      expect(mockBroadcastUIUpdate).toHaveBeenCalledWith({
        entity: 'file',
        action: 'updated',
        entityId: '',
        field: 'batch',
        oldValue: undefined,
        newValue: { paths: ['/file1.txt'] },
      });
    });

    it('should not broadcast when transaction fails', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      // Mock transaction to throw
      mockDb.transaction.mockImplementation(
        async (_mode: string, _tables: any[], _fn: () => Promise<any>) => {
          throw new Error('Transaction failed');
        },
      );

      await expect(workerCore.batchWriteFiles(files)).rejects.toThrow(
        'Transaction failed',
      );

      // Broadcast should not be called
      expect(mockBroadcastUIUpdate).not.toHaveBeenCalled();
    });
  });

  describe('metadata handling', () => {
    it('should set editedByUser to false for all writes', async () => {
      const files = [
        {
          path: '/file1.txt',
          content: 'content1',
          metadata: { editedByUser: true },
        },
      ];

      await workerCore.batchWriteFiles(files);

      // Verify editedByUser is overridden to false
      expect(virtualFS.writeBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          path: '/file1.txt',
          content: 'content1',
          mode: 'overwrite',
          metadataOverride: expect.objectContaining({ editedByUser: false }),
        }),
      ]);
    });

    it('should preserve other metadata fields', async () => {
      const files = [
        {
          path: '/file1.txt',
          content: 'content1',
          metadata: { description: 'test description', tags: ['tag1', 'tag2'] },
        },
      ];

      await workerCore.batchWriteFiles(files);

      // Verify all metadata fields are preserved
      expect(virtualFS.writeBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          path: '/file1.txt',
          content: 'content1',
          mode: 'overwrite',
          metadataOverride: expect.objectContaining({
            description: 'test description',
            tags: ['tag1', 'tag2'],
            editedByUser: false,
          }),
        }),
      ]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty files array', async () => {
      await workerCore.batchWriteFiles([]);

      // writeBatch should be called with empty array
      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(1);
      expect(virtualFS.writeBatch).toHaveBeenCalledWith([]);

      // Broadcast should still happen
      expect(mockBroadcastUIUpdate).toHaveBeenCalledTimes(1);
    });

    it('should handle large batch of files', async () => {
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `/file${i}.txt`,
        content: `content${i}`,
      }));

      await workerCore.batchWriteFiles(files);

      // writeBatch should be called once with all 100 files
      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(1);
      expect(virtualFS.writeBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: '/file0.txt' }),
          expect.objectContaining({ path: '/file99.txt' }),
        ]),
      );
      // Verify the array has 100 items
      expect(virtualFS.writeBatch).toHaveBeenCalledWith(expect.any(Array));
      const call = vi.mocked(virtualFS.writeBatch).mock.calls[0][0];
      expect(call).toHaveLength(100);
    });

    it('should handle files with special characters in path', async () => {
      const files = [
        { path: '/path/with spaces/file.txt', content: 'content' },
        { path: '/path/with-dashes/file.txt', content: 'content' },
        { path: '/path/with_underscores/file.txt', content: 'content' },
      ];

      await workerCore.batchWriteFiles(files);

      expect(virtualFS.writeBatch).toHaveBeenCalledTimes(1);
      expect(virtualFS.writeBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: '/path/with spaces/file.txt' }),
          expect.objectContaining({ path: '/path/with-dashes/file.txt' }),
          expect.objectContaining({ path: '/path/with_underscores/file.txt' }),
        ]),
      );
    });

    it('should handle files with empty content', async () => {
      const files = [{ path: '/file1.txt', content: '' }];

      await workerCore.batchWriteFiles(files);

      expect(virtualFS.writeBatch).toHaveBeenCalledWith([
        {
          path: '/file1.txt',
          content: '',
          mode: 'overwrite',
          metadataOverride: { editedByUser: false },
        },
      ]);
    });
  });

  describe('error scenarios', () => {
    it('should propagate write errors', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      vi.mocked(virtualFS.writeBatch).mockRejectedValue(new Error('Disk full'));

      await expect(workerCore.batchWriteFiles(files)).rejects.toThrow(
        'Disk full',
      );

      // Broadcast should not be called
      expect(mockBroadcastUIUpdate).not.toHaveBeenCalled();
    });

    it('should handle transaction errors', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      mockDb.transaction.mockRejectedValue(new Error('Transaction error'));

      await expect(workerCore.batchWriteFiles(files)).rejects.toThrow(
        'Transaction error',
      );

      // Broadcast should not be called
      expect(mockBroadcastUIUpdate).not.toHaveBeenCalled();
    });

    it('should handle transaction timeout gracefully', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      // Mock transaction to timeout
      mockDb.transaction.mockImplementation(async () => {
        throw new Error('Transaction timeout');
      });

      await expect(workerCore.batchWriteFiles(files)).rejects.toThrow(
        'Transaction timeout',
      );
    });

    it('should handle database corruption during write', async () => {
      const files = [{ path: '/file1.txt', content: 'content1' }];

      // Mock database corruption
      mockDb.transaction.mockImplementation(async () => {
        throw new DOMException('Database corrupted', 'DataCloneError');
      });

      await expect(workerCore.batchWriteFiles(files)).rejects.toThrow(
        'Database corrupted',
      );
    });

    it('should handle concurrent write conflicts', async () => {
      const files = [
        { path: '/file1.txt', content: 'content1' },
        { path: '/file2.txt', content: 'content2' },
      ];

      let callCount = 0;
      mockDb.transaction.mockImplementation(async (_mode, ...args) => {
        callCount++;
        if (callCount === 1) {
          // First call succeeds
          const fn = args[args.length - 1];
          return fn();
        } else {
          // Second call fails (conflict)
          throw new Error('Transaction conflict');
        }
      });

      // First batch should succeed
      await workerCore.batchWriteFiles([files[0]]);

      // Second batch should fail
      await expect(workerCore.batchWriteFiles([files[1]])).rejects.toThrow(
        'Transaction conflict',
      );
    });
  });
});
