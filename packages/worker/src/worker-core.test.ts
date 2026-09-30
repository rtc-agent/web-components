/**
 * Worker Core Unit Tests
 *
 * Tests:
 * - batchWriteFiles: transaction-based atomicity (Fix 55)
 * - getCatchUpEvents: gap detection boundary conditions
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerCore } from './worker-core.js';
import { virtualFS } from '@rtc-agent/persistence';

// Mock dependencies
vi.mock('@rtc-agent/persistence', () => ({
    virtualFS: {
        write: vi.fn(),
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

describe('WorkerCore - batchWriteFiles (Fix 55)', () => {
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
            transaction: vi.fn().mockImplementation(async (_mode, _tables, fn) => {
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
        (workerCore as any)._isProtectedPath = vi.fn().mockImplementation((path: string) => {
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

            // Verify all writes were called
            expect(virtualFS.write).toHaveBeenCalledTimes(3);
            expect(virtualFS.write).toHaveBeenNthCalledWith(1, '/file1.txt', 'content1', 'overwrite', { editedByUser: false });
            expect(virtualFS.write).toHaveBeenNthCalledWith(2, '/file2.txt', 'content2', 'overwrite', { editedByUser: false });
            expect(virtualFS.write).toHaveBeenNthCalledWith(3, '/file3.txt', 'content3', 'overwrite', { editedByUser: false });

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
            mockDb.transaction.mockImplementation(async (_mode: string, _tables: any[], fn: () => Promise<any>) => {
                try {
                    return await fn();
                } catch (err) {
                    // Transaction rollback happens automatically
                    throw err;
                }
            });

            // Mock virtualFS.write to fail on second call
            let callCount = 0;
            vi.mocked(virtualFS.write).mockImplementation(async (_path, _content, _mode, _metadata) => {
                callCount++;
                if (callCount === 2) {
                    throw new Error('Write failed');
                }
                return 0;
            });

            // Should throw
            await expect(workerCore.batchWriteFiles(files)).rejects.toThrow('Write failed');

            // Verify broadcast was NOT called (transaction failed)
            expect(mockBroadcastUIUpdate).not.toHaveBeenCalled();
        });

        it('should use Dexie transaction for atomicity', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];

            await workerCore.batchWriteFiles(files);

            // Verify transaction was called with 'rw' mode
            expect(mockDb.transaction).toHaveBeenCalledWith(
                'rw',
                mockDb.fileSystemEntries,
                expect.any(Function)
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
            expect(virtualFS.write).toHaveBeenCalledTimes(1);
            expect(virtualFS.write).toHaveBeenCalledWith('/file1.txt', 'content1', 'overwrite', { editedByUser: false });
        });

        it('should overwrite protected files not edited by user', async () => {
            const files = [
                { path: '/AGENT.md', content: 'system content' },
            ];

            // Mock existing file without editedByUser
            mockDb.fileSystemEntries.get.mockResolvedValue({
                path: '/AGENT.md',
                content: 'old system content',
                metadata: { editedByUser: false },
            });

            await workerCore.batchWriteFiles(files);

            // AGENT.md should be overwritten
            expect(virtualFS.write).toHaveBeenCalledTimes(1);
            expect(virtualFS.write).toHaveBeenCalledWith('/AGENT.md', 'system content', 'overwrite', { editedByUser: false });
        });

        it('should create protected files if they do not exist', async () => {
            const files = [
                { path: '/AGENT.md', content: 'new content' },
            ];

            // Mock file does not exist
            mockDb.fileSystemEntries.get.mockResolvedValue(undefined);

            await workerCore.batchWriteFiles(files);

            // AGENT.md should be created
            expect(virtualFS.write).toHaveBeenCalledTimes(1);
            expect(virtualFS.write).toHaveBeenCalledWith('/AGENT.md', 'new content', 'overwrite', { editedByUser: false });
        });
    });

    describe('delete paths', () => {
        it('should delete specified paths after writes', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];
            const deletePaths = ['/old1.txt', '/old2.txt'];

            await workerCore.batchWriteFiles(files, deletePaths);

            // Verify deletes were called
            expect(virtualFS.remove).toHaveBeenCalledTimes(2);
            expect(virtualFS.remove).toHaveBeenNthCalledWith(1, '/old1.txt');
            expect(virtualFS.remove).toHaveBeenNthCalledWith(2, '/old2.txt');
        });

        it('should continue if delete fails', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];
            const deletePaths = ['/old1.txt', '/old2.txt'];

            // Mock first delete to fail
            vi.mocked(virtualFS.remove).mockImplementation(async (path) => {
                if (path === '/old1.txt') {
                    throw new Error('Delete failed');
                }
            });

            // Should not throw
            await expect(workerCore.batchWriteFiles(files, deletePaths)).resolves.not.toThrow();

            // Both deletes should be attempted
            expect(virtualFS.remove).toHaveBeenCalledTimes(2);

            // Broadcast should still happen (delete failures are logged but don't fail the batch)
            expect(mockBroadcastUIUpdate).toHaveBeenCalledTimes(1);
        });

        it('should handle empty deletePaths array', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];

            await workerCore.batchWriteFiles(files, []);

            // No deletes should be called
            expect(virtualFS.remove).not.toHaveBeenCalled();

            // Broadcast should happen
            expect(mockBroadcastUIUpdate).toHaveBeenCalledTimes(1);
        });

        it('should handle undefined deletePaths', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];

            await workerCore.batchWriteFiles(files, undefined);

            // No deletes should be called
            expect(virtualFS.remove).not.toHaveBeenCalled();
        });
    });

    describe('broadcast behavior', () => {
        it('should broadcast only after successful transaction', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];

            await workerCore.batchWriteFiles(files);

            // Verify broadcast was called with correct parameters
            expect(mockBroadcastUIUpdate).toHaveBeenCalledWith({
                entity: 'file',
                action: 'updated',
                entityId: '',
                field: 'batch',
                oldValue: undefined,
                newValue: undefined,
            });
        });

        it('should not broadcast when transaction fails', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];

            // Mock transaction to throw
            mockDb.transaction.mockImplementation(async (_mode: string, _tables: any[], _fn: () => Promise<any>) => {
                throw new Error('Transaction failed');
            });

            await expect(workerCore.batchWriteFiles(files)).rejects.toThrow('Transaction failed');

            // Broadcast should not be called
            expect(mockBroadcastUIUpdate).not.toHaveBeenCalled();
        });
    });

    describe('metadata handling', () => {
        it('should set editedByUser to false for all writes', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1', metadata: { editedByUser: true } },
            ];

            await workerCore.batchWriteFiles(files);

            // Verify editedByUser is overridden to false
            expect(virtualFS.write).toHaveBeenCalledWith(
                '/file1.txt',
                'content1',
                'overwrite',
                expect.objectContaining({ editedByUser: false })
            );
        });

        it('should preserve other metadata fields', async () => {
            const files = [
                {
                    path: '/file1.txt',
                    content: 'content1',
                    metadata: { description: 'test description', tags: ['tag1', 'tag2'] }
                },
            ];

            await workerCore.batchWriteFiles(files);

            // Verify all metadata fields are preserved
            expect(virtualFS.write).toHaveBeenCalledWith(
                '/file1.txt',
                'content1',
                'overwrite',
                expect.objectContaining({
                    description: 'test description',
                    tags: ['tag1', 'tag2'],
                    editedByUser: false
                })
            );
        });
    });

    describe('edge cases', () => {
        it('should handle empty files array', async () => {
            await workerCore.batchWriteFiles([]);

            // No writes should be called
            expect(virtualFS.write).not.toHaveBeenCalled();

            // Broadcast should still happen
            expect(mockBroadcastUIUpdate).toHaveBeenCalledTimes(1);
        });

        it('should handle large batch of files', async () => {
            const files = Array.from({ length: 100 }, (_, i) => ({
                path: `/file${i}.txt`,
                content: `content${i}`,
            }));

            await workerCore.batchWriteFiles(files);

            // All writes should be called
            expect(virtualFS.write).toHaveBeenCalledTimes(100);
        });

        it('should handle files with special characters in path', async () => {
            const files = [
                { path: '/path/with spaces/file.txt', content: 'content' },
                { path: '/path/with-dashes/file.txt', content: 'content' },
                { path: '/path/with_underscores/file.txt', content: 'content' },
            ];

            await workerCore.batchWriteFiles(files);

            expect(virtualFS.write).toHaveBeenCalledTimes(3);
        });

        it('should handle files with empty content', async () => {
            const files = [
                { path: '/file1.txt', content: '' },
            ];

            await workerCore.batchWriteFiles(files);

            expect(virtualFS.write).toHaveBeenCalledWith('/file1.txt', '', 'overwrite', { editedByUser: false });
        });
    });

    describe('error scenarios', () => {
        it('should propagate write errors', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];

            vi.mocked(virtualFS.write).mockRejectedValue(new Error('Disk full'));

            await expect(workerCore.batchWriteFiles(files)).rejects.toThrow('Disk full');

            // Broadcast should not be called
            expect(mockBroadcastUIUpdate).not.toHaveBeenCalled();
        });

        it('should handle transaction errors', async () => {
            const files = [
                { path: '/file1.txt', content: 'content1' },
            ];

            mockDb.transaction.mockRejectedValue(new Error('Transaction error'));

            await expect(workerCore.batchWriteFiles(files)).rejects.toThrow('Transaction error');

            // Broadcast should not be called
            expect(mockBroadcastUIUpdate).not.toHaveBeenCalled();
        });
    });
});

// ========== getCatchUpEvents: Gap Detection ==========

describe('WorkerCore - getCatchUpEvents (Gap Detection)', () => {
    let workerCore: WorkerCore;
    let mockDb: any;

    /**
     * Build a mock DB whose `ui_updates` supports the Dexie query chains
     * used by getCatchUpEvents():
     *   - where('seq').above(n).limit(k).toArray()
     *   - orderBy('seq').last()
     */
    function createMockDb(options: {
        entries: Array<{ seq: number; event: object; timestamp: number }>;
    }) {
        const allEntries = [...options.entries].sort((a, b) => a.seq - b.seq);

        return {
            ui_updates: {
                where: (_field: string) => ({
                    above: (_fromSeq: number) => {
                        // Capture fromSeq for filtering
                        let filtered = allEntries.filter((e) => e.seq > _fromSeq);
                        return {
                            limit: (max: number) => ({
                                toArray: async () => filtered.slice(0, max),
                            }),
                        };
                    },
                }),
                orderBy: (_field: string) => ({
                    last: async () => {
                        if (allEntries.length === 0) return undefined;
                        return allEntries[allEntries.length - 1];
                    },
                }),
            },
        };
    }

    beforeEach(async () => {
        vi.clearAllMocks();

        const persistence = await import('@rtc-agent/persistence');
        vi.mocked(persistence.getDatabase).mockImplementation(() => mockDb);

        workerCore = new WorkerCore();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('fromSeq > 0 and entries.length === 0 (empty result boundary)', () => {
        it('should set hasGap = true when latest.seq < fromSeq (all events TTL-deleted beyond cursor)', async () => {
            // DB has events up to seq=5, but we ask for events after seq=10.
            // where('seq').above(10) returns nothing, orderBy('seq').last() returns {seq:5}.
            // Since latest.seq (5) !== fromSeq (10), this is a gap.
            mockDb = createMockDb({
                entries: [
                    { seq: 3, event: {}, timestamp: 1 },
                    { seq: 5, event: {}, timestamp: 2 },
                ],
            });

            const result = await workerCore.getCatchUpEvents(10);

            expect(result.entries).toEqual([]);
            expect(result.hasGap).toBe(true);
            expect(result.hasMore).toBe(false);
        });

        it('should set hasGap = false when latest.seq === fromSeq (no missed events, cursor is current)', async () => {
            // DB has events up to seq=10, we ask for events after seq=10.
            // where('seq').above(10) returns nothing, orderBy('seq').last() returns {seq:10}.
            // Since latest.seq (10) === fromSeq (10), no gap — cursor is perfectly current.
            mockDb = createMockDb({
                entries: [
                    { seq: 8, event: {}, timestamp: 1 },
                    { seq: 10, event: {}, timestamp: 2 },
                ],
            });

            const result = await workerCore.getCatchUpEvents(10);

            expect(result.entries).toEqual([]);
            expect(result.hasGap).toBe(false);
            expect(result.hasMore).toBe(false);
        });

        it('should set hasGap = true when DB is completely empty but fromSeq > 0', async () => {
            // All events were TTL-deleted, DB is empty, but we still have a cursor.
            mockDb = createMockDb({ entries: [] });

            const result = await workerCore.getCatchUpEvents(5);

            expect(result.entries).toEqual([]);
            expect(result.hasGap).toBe(true);
        });
    });

    describe('fromSeq > 0 and entries.length > 0 (non-empty result gap detection)', () => {
        it('should detect gap at start when first entry seq > fromSeq + 1', async () => {
            mockDb = createMockDb({
                entries: [
                    { seq: 5, event: {}, timestamp: 1 },
                    { seq: 6, event: {}, timestamp: 2 },
                ],
            });

            // fromSeq=2, first entry seq=5 > 2+1=3 → gap at start
            const result = await workerCore.getCatchUpEvents(2);

            expect(result.hasGap).toBe(true);
            expect(result.entries.length).toBe(2);
        });

        it('should set hasGap = false for middle gaps (intentionally not detected)', async () => {
            // Middle gaps are NOT checked by design: IndexedDB auto-increment can skip seq
            // numbers when a transaction fails (e.g., constraint violation, quota exceeded),
            // which does not indicate data loss — the event was never persisted.
            mockDb = createMockDb({
                entries: [
                    { seq: 3, event: {}, timestamp: 1 },
                    { seq: 4, event: {}, timestamp: 2 },
                    { seq: 7, event: {}, timestamp: 3 }, // middle gap: expected 5, got 7
                    { seq: 8, event: {}, timestamp: 4 },
                ],
            });

            const result = await workerCore.getCatchUpEvents(2);

            // Middle gaps are intentionally not detected (see worker-core.ts comments)
            expect(result.hasGap).toBe(false);
            expect(result.entries.length).toBe(4);
        });

        it('should set hasGap = false when entries are perfectly consecutive from fromSeq', async () => {
            mockDb = createMockDb({
                entries: [
                    { seq: 3, event: {}, timestamp: 1 },
                    { seq: 4, event: {}, timestamp: 2 },
                    { seq: 5, event: {}, timestamp: 3 },
                ],
            });

            const result = await workerCore.getCatchUpEvents(2);

            expect(result.hasGap).toBe(false);
            expect(result.entries.length).toBe(3);
        });
    });

    describe('fromSeq === 0 (no gap detection needed)', () => {
        it('should set hasGap = false regardless of entries', async () => {
            mockDb = createMockDb({
                entries: [
                    { seq: 5, event: {}, timestamp: 1 },
                    { seq: 10, event: {}, timestamp: 2 },
                ],
            });

            const result = await workerCore.getCatchUpEvents(0);

            expect(result.hasGap).toBe(false);
        });
    });

    describe('hasMore detection', () => {
        it('should set hasMore = true when entries exceed limit', async () => {
            // Create 5 entries, request with limit=3 → should return 3, hasMore=true
            const entries = Array.from({ length: 5 }, (_, i) => ({
                seq: i + 1,
                event: {},
                timestamp: i,
            }));
            mockDb = createMockDb({ entries });

            const result = await workerCore.getCatchUpEvents(0, 3);

            expect(result.hasMore).toBe(true);
            expect(result.entries.length).toBe(3);
        });

        it('should set hasMore = false when entries fit within limit', async () => {
            const entries = [
                { seq: 1, event: {}, timestamp: 1 },
                { seq: 2, event: {}, timestamp: 2 },
            ];
            mockDb = createMockDb({ entries });

            const result = await workerCore.getCatchUpEvents(0, 10);

            expect(result.hasMore).toBe(false);
            expect(result.entries.length).toBe(2);
        });
    });
});
