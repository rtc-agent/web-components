import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleEditorSave, type VfsDeps } from './vfs-operations.js';
import { virtualFS } from '@rtc-agent/persistence';

// Mock virtualFS
vi.mock('@rtc-agent/persistence', () => ({
    virtualFS: {
        write: vi.fn(),
        read: vi.fn(),
        exists: vi.fn(),
        ls: vi.fn(),
    },
}));

describe('handleEditorSave', () => {
    let mockDeps: VfsDeps;
    let mockWrite: any;
    let mockSaveFile: any;
    let mockToast: any;
    let mockLogger: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockWrite = vi.mocked(virtualFS.write);
        mockSaveFile = vi.fn();
        mockToast = { show: vi.fn() };
        mockLogger = {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
        };

        mockDeps = {
            persistenceIsConnected: true,
            fileExplorer: {
                actions: {
                    setRoot: vi.fn(),
                    setLoading: vi.fn(),
                    updateChildren: vi.fn(),
                    selectNode: vi.fn(),
                },
                value: {
                    isExpanded: vi.fn(),
                },
            },
            editorArea: {
                tabs: [],
                activeFilePath: null,
                actions: {
                    openFile: vi.fn(),
                    closeFile: vi.fn(),
                    loadContent: vi.fn(),
                    saveFile: mockSaveFile,
                },
            },
            toast: mockToast,
            settingsDefaultViewMode: 'edit',
            logger: mockLogger,
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Basic Functionality ──

    describe('basic save functionality', () => {
        it('should save file content to VFS and mark as saved', async () => {
            const filePath = '/test/file.md';
            const content = '# Test Content';

            mockDeps.editorArea.tabs = [{
                filePath,
                content,
                isDirty: true,
            }];

            mockWrite.mockResolvedValue(1);

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledWith(
                filePath,
                content,
                'overwrite',
                { editedByUser: true }
            );
            expect(mockSaveFile).toHaveBeenCalledWith(filePath);
            expect(mockToast.show).toHaveBeenCalledWith(
                expect.any(String),
                'success'
            );
        });

        it('should not save if tab does not exist', async () => {
            const filePath = '/nonexistent/file.md';
            mockDeps.editorArea.tabs = [];

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).not.toHaveBeenCalled();
            expect(mockSaveFile).not.toHaveBeenCalled();
            expect(mockToast.show).not.toHaveBeenCalled();
        });

        it('should handle empty content', async () => {
            const filePath = '/empty.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: '',
                isDirty: true,
            }];
            mockWrite.mockResolvedValue(1);

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledWith(
                filePath,
                '',
                'overwrite',
                { editedByUser: true }
            );
            expect(mockSaveFile).toHaveBeenCalledWith(filePath);
        });

        it('should handle very large content', async () => {
            const filePath = '/large.md';
            const largeContent = 'x'.repeat(10 * 1024 * 1024); // 10MB
            mockDeps.editorArea.tabs = [{
                filePath,
                content: largeContent,
                isDirty: true,
            }];
            mockWrite.mockResolvedValue(largeContent.length);

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledWith(
                filePath,
                largeContent,
                'overwrite',
                { editedByUser: true }
            );
            expect(mockSaveFile).toHaveBeenCalledWith(filePath);
        });
    });

    // ── Error Handling ──

    describe('error handling', () => {
        it('should handle write failure and show error toast', async () => {
            const filePath = '/test/file.md';
            const error = new Error('Write failed');

            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];
            mockWrite.mockRejectedValue(error);

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalled();
            expect(mockSaveFile).not.toHaveBeenCalled();
            expect(mockToast.show).toHaveBeenCalledWith(
                expect.any(String),
                'error'
            );
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to save file:',
                filePath,
                error
            );
        });

        it('should not retry on write failure even if content drifts', async () => {
            const filePath = '/test/file.md';
            const error = new Error('Write failed');

            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'initial',
                isDirty: true,
            }];

            let writeCallCount = 0;
            mockWrite.mockImplementation(async () => {
                writeCallCount++;
                // Simulate content drift after first write attempt
                if (writeCallCount === 1) {
                    mockDeps.editorArea.tabs = [{
                        filePath,
                        content: 'changed',
                        isDirty: true,
                    }];
                }
                throw error;
            });

            await handleEditorSave(filePath, mockDeps);

            // Should only attempt write once, not retry
            expect(mockWrite).toHaveBeenCalledTimes(1);
            expect(mockSaveFile).not.toHaveBeenCalled();
            expect(mockToast.show).toHaveBeenCalledWith(
                expect.any(String),
                'error'
            );
        });

        it('should release lock even after write failure', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];
            mockWrite.mockRejectedValue(new Error('Write failed'));

            await handleEditorSave(filePath, mockDeps);

            // Try to save again - should not be blocked by lock
            mockWrite.mockResolvedValue(1);
            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledTimes(2);
            expect(mockSaveFile).toHaveBeenCalledWith(filePath);
        });
    });

    // ── Content Drift Detection ──

    describe('content drift detection', () => {
        it('should detect content drift and re-save with new content', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'initial',
                isDirty: true,
            }];

            let writeCallCount = 0;
            mockWrite.mockImplementation(async (path, content) => {
                writeCallCount++;
                // Simulate delay
                await new Promise(resolve => setTimeout(resolve, 10));
                // Simulate user typing during first write
                if (writeCallCount === 1) {
                    mockDeps.editorArea.tabs = [{
                        filePath,
                        content: 'initial + more',
                        isDirty: true,
                    }];
                }
                return content.length;
            });

            await handleEditorSave(filePath, mockDeps);

            // Should write twice: once for initial, once for drifted content
            expect(mockWrite).toHaveBeenCalledTimes(2);
            expect(mockWrite).toHaveBeenNthCalledWith(
                1,
                filePath,
                'initial',
                'overwrite',
                { editedByUser: true }
            );
            expect(mockWrite).toHaveBeenNthCalledWith(
                2,
                filePath,
                'initial + more',
                'overwrite',
                { editedByUser: true }
            );
            // But saveFile and toast only once
            expect(mockSaveFile).toHaveBeenCalledTimes(1);
            expect(mockToast.show).toHaveBeenCalledTimes(1);
        });

        it('should handle multiple drift iterations', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'v1',
                isDirty: true,
            }];

            let writeCallCount = 0;
            const contents = ['v1', 'v2', 'v3', 'v3']; // Stabilizes at v3
            mockWrite.mockImplementation(async (path, content) => {
                // Simulate drift on first two writes
                if (writeCallCount < 2) {
                    mockDeps.editorArea.tabs = [{
                        filePath,
                        content: contents[writeCallCount + 1],
                        isDirty: true,
                    }];
                }
                writeCallCount++;
                return content.length;
            });

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledTimes(3);
            expect(mockWrite).toHaveBeenNthCalledWith(1, filePath, 'v1', 'overwrite', expect.anything());
            expect(mockWrite).toHaveBeenNthCalledWith(2, filePath, 'v2', 'overwrite', expect.anything());
            expect(mockWrite).toHaveBeenNthCalledWith(3, filePath, 'v3', 'overwrite', expect.anything());
            expect(mockSaveFile).toHaveBeenCalledTimes(1);
        });

        it('should converge when user stops typing', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'typing...',
                isDirty: true,
            }];

            let writeCallCount = 0;
            mockWrite.mockImplementation(async (path, content) => {
                writeCallCount++;
                // User types once more during first write, then stops
                if (writeCallCount === 1) {
                    mockDeps.editorArea.tabs = [{
                        filePath,
                        content: 'typing... done',
                        isDirty: true,
                    }];
                }
                return content.length;
            });

            await handleEditorSave(filePath, mockDeps);

            // First write: "typing..."
            // Second write: "typing... done" (drift detected)
            // Third check: content stable, break
            expect(mockWrite).toHaveBeenCalledTimes(2);
            expect(mockSaveFile).toHaveBeenCalledTimes(1);
        });
    });

    // ── Concurrency Guard ──

    describe('concurrency guard', () => {
        it('should skip concurrent saves for the same file', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];

            let firstWriteStarted = false;
            let firstWriteResolve: (() => void) | null = null;

            mockWrite.mockImplementation(async () => {
                if (!firstWriteStarted) {
                    firstWriteStarted = true;
                    // Hold the first write until we test concurrency
                    await new Promise<void>(resolve => {
                        firstWriteResolve = resolve;
                    });
                }
                return 7;
            });

            // Start first save (don't await)
            const firstSave = handleEditorSave(filePath, mockDeps);

            // Wait for first write to start
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(firstWriteStarted).toBe(true);

            // Try second save while first is in progress
            await handleEditorSave(filePath, mockDeps);

            // Second save should be skipped (write only called once)
            expect(mockWrite).toHaveBeenCalledTimes(1);

            // Complete first save
            firstWriteResolve!();
            await firstSave;

            expect(mockSaveFile).toHaveBeenCalledTimes(1);
        });

        it('should allow concurrent saves for different files', async () => {
            const file1 = '/file1.md';
            const file2 = '/file2.md';

            mockDeps.editorArea.tabs = [
                { filePath: file1, content: 'content1', isDirty: true },
                { filePath: file2, content: 'content2', isDirty: true },
            ];

            let write1Started = false;
            let write2Started = false;

            mockWrite.mockImplementation(async (path) => {
                if (path === file1) {
                    write1Started = true;
                    await new Promise(resolve => setTimeout(resolve, 10));
                } else if (path === file2) {
                    write2Started = true;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                return 8;
            });

            // Start both saves concurrently
            await Promise.all([
                handleEditorSave(file1, mockDeps),
                handleEditorSave(file2, mockDeps),
            ]);

            // Both should have executed
            expect(write1Started).toBe(true);
            expect(write2Started).toBe(true);
            expect(mockWrite).toHaveBeenCalledTimes(2);
            expect(mockSaveFile).toHaveBeenCalledTimes(2);
        });

        it('should release lock after successful save', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];
            mockWrite.mockResolvedValue(7);

            // First save
            await handleEditorSave(filePath, mockDeps);
            expect(mockWrite).toHaveBeenCalledTimes(1);

            // Second save should work (lock released)
            await handleEditorSave(filePath, mockDeps);
            expect(mockWrite).toHaveBeenCalledTimes(2);
        });

        it('should release lock after tab closed during save', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];

            mockWrite.mockImplementation(async () => {
                // Simulate tab being closed during write
                mockDeps.editorArea.tabs = [];
                return 7;
            });

            await handleEditorSave(filePath, mockDeps);

            // Should complete without error
            expect(mockWrite).toHaveBeenCalledTimes(1);
            expect(mockSaveFile).not.toHaveBeenCalled(); // Tab closed, no saveFile

            // Lock should be released - try saving a different file
            const otherFile = '/other.md';
            mockDeps.editorArea.tabs = [{
                filePath: otherFile,
                content: 'other',
                isDirty: true,
            }];
            mockWrite.mockResolvedValue(5);

            await handleEditorSave(otherFile, mockDeps);
            expect(mockWrite).toHaveBeenCalledTimes(2);
        });
    });

    // ── Tab State Edge Cases ──

    describe('tab state edge cases', () => {
        it('should handle tab closed immediately after write starts', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];

            mockWrite.mockImplementation(async () => {
                // Tab closed during write
                mockDeps.editorArea.tabs = [];
                return 7;
            });

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledTimes(1);
            expect(mockSaveFile).not.toHaveBeenCalled();
        });

        it('should handle tab content changed to empty during save', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];

            mockWrite.mockImplementation(async () => {
                // User deleted all content during write
                mockDeps.editorArea.tabs = [{
                    filePath,
                    content: '',
                    isDirty: true,
                }];
                return 7;
            });

            await handleEditorSave(filePath, mockDeps);

            // Should detect drift and write again with empty content
            expect(mockWrite).toHaveBeenCalledTimes(2);
            expect(mockWrite).toHaveBeenNthCalledWith(2, filePath, '', 'overwrite', expect.anything());
        });

        it('should handle multiple tabs correctly', async () => {
            const file1 = '/file1.md';
            const file2 = '/file2.md';
            const file3 = '/file3.md';

            mockDeps.editorArea.tabs = [
                { filePath: file1, content: 'content1', isDirty: true },
                { filePath: file2, content: 'content2', isDirty: false },
                { filePath: file3, content: 'content3', isDirty: true },
            ];

            mockWrite.mockResolvedValue(8);

            await handleEditorSave(file2, mockDeps);

            expect(mockWrite).toHaveBeenCalledWith(
                file2,
                'content2',
                'overwrite',
                { editedByUser: true }
            );
            expect(mockSaveFile).toHaveBeenCalledWith(file2);
        });

        it('should find correct tab after content drift', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [
                { filePath: '/other.md', content: 'other', isDirty: false },
                { filePath, content: 'initial', isDirty: true },
            ];

            mockWrite.mockImplementation(async () => {
                // Simulate tab reordering during write
                mockDeps.editorArea.tabs = [
                    { filePath, content: 'changed', isDirty: true },
                    { filePath: '/other.md', content: 'other', isDirty: false },
                ];
                return 7;
            });

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledTimes(2);
            expect(mockWrite).toHaveBeenNthCalledWith(2, filePath, 'changed', 'overwrite', expect.anything());
        });
    });

    // ── Lock Lifecycle ──

    describe('lock lifecycle', () => {
        it('should hold lock throughout entire loop', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'v1',
                isDirty: true,
            }];

            const writeTimes: number[] = [];
            mockWrite.mockImplementation(async (path, content) => {
                writeTimes.push(Date.now());
                if (writeTimes.length === 1) {
                    mockDeps.editorArea.tabs = [{
                        filePath,
                        content: 'v2',
                        isDirty: true,
                    }];
                }
                await new Promise(resolve => setTimeout(resolve, 5));
                return content.length;
            });

            await handleEditorSave(filePath, mockDeps);

            // Writes should be sequential (second starts after first completes)
            expect(writeTimes.length).toBe(2);
            expect(mockSaveFile).toHaveBeenCalledTimes(1);
        });

        it('should release lock in finally block even on unexpected error', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];

            mockWrite.mockImplementation(async () => {
                throw new Error('Unexpected error');
            });

            await handleEditorSave(filePath, mockDeps);

            // Lock should be released - try saving again
            mockWrite.mockResolvedValue(7);
            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledTimes(2);
        });

        it('should handle rapid successive saves correctly', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];
            mockWrite.mockResolvedValue(7);

            // Rapid successive saves
            await handleEditorSave(filePath, mockDeps);
            await handleEditorSave(filePath, mockDeps);
            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledTimes(3);
            expect(mockSaveFile).toHaveBeenCalledTimes(3);
        });
    });

    // ── Integration Scenarios ──

    describe('integration scenarios', () => {
        it('should handle Ctrl+S during auto-save (out-of-order write prevention)', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'A',
                isDirty: true,
            }];

            let autoSaveStarted = false;
            let autoSaveResolve: (() => void) | null = null;

            mockWrite.mockImplementation(async (path, content) => {
                if (!autoSaveStarted) {
                    autoSaveStarted = true;
                    // Hold auto-save write
                    await new Promise<void>(resolve => {
                        autoSaveResolve = resolve;
                    });
                    // Simulate user typing during auto-save
                    mockDeps.editorArea.tabs = [{
                        filePath,
                        content: 'AB',
                        isDirty: true,
                    }];
                }
                return content.length;
            });

            // Start auto-save (don't await)
            const autoSave = handleEditorSave(filePath, mockDeps);

            await new Promise(resolve => setTimeout(resolve, 10));
            expect(autoSaveStarted).toBe(true);

            // User presses Ctrl+S while auto-save is in progress
            await handleEditorSave(filePath, mockDeps);

            // Ctrl+S should be skipped (lock held by auto-save)
            expect(mockWrite).toHaveBeenCalledTimes(1);

            // Complete auto-save
            autoSaveResolve!();
            await autoSave;

            // Auto-save should detect drift and write again
            expect(mockWrite).toHaveBeenCalledTimes(2);
            expect(mockWrite).toHaveBeenNthCalledWith(2, filePath, 'AB', 'overwrite', expect.anything());
            expect(mockSaveFile).toHaveBeenCalledTimes(1);
        });

        it('should handle page close scenario (save in progress, user closes tab)', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];

            mockWrite.mockImplementation(async () => {
                // Simulate slow write
                await new Promise(resolve => setTimeout(resolve, 100));
                // Tab closed during write
                mockDeps.editorArea.tabs = [];
                return 7;
            });

            await handleEditorSave(filePath, mockDeps);

            expect(mockWrite).toHaveBeenCalledTimes(1);
            expect(mockSaveFile).not.toHaveBeenCalled();
            expect(mockToast.show).not.toHaveBeenCalled();
        });

        it('should handle continuous typing with multiple saves', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'typing',
                isDirty: true,
            }];

            let writeCount = 0;
            mockWrite.mockImplementation(async (path, content) => {
                writeCount++;
                await new Promise(resolve => setTimeout(resolve, 5));
                // Simulate continuous typing
                if (writeCount === 1) {
                    mockDeps.editorArea.tabs = [{
                        filePath,
                        content: 'typing more',
                        isDirty: true,
                    }];
                } else if (writeCount === 2) {
                    mockDeps.editorArea.tabs = [{
                        filePath,
                        content: 'typing more text',
                        isDirty: true,
                    }];
                }
                return content.length;
            });

            await handleEditorSave(filePath, mockDeps);

            // Should loop until content stabilizes
            expect(mockWrite).toHaveBeenCalledTimes(3);
            expect(mockSaveFile).toHaveBeenCalledTimes(1);
        });
    });

    // ── Memory and Performance ──

    describe('memory and performance', () => {
        it('should not leak memory with many saves', async () => {
            const filePath = '/test/file.md';
            mockDeps.editorArea.tabs = [{
                filePath,
                content: 'content',
                isDirty: true,
            }];
            mockWrite.mockResolvedValue(7);

            // Perform many saves
            for (let i = 0; i < 100; i++) {
                await handleEditorSave(filePath, mockDeps);
            }

            expect(mockWrite).toHaveBeenCalledTimes(100);
            expect(mockSaveFile).toHaveBeenCalledTimes(100);
        });

        it('should handle concurrent saves for many different files', async () => {
            const files = Array.from({ length: 20 }, (_, i) => `/file${i}.md`);

            mockDeps.editorArea.tabs = files.map(filePath => ({
                filePath,
                content: `content-${filePath}`,
                isDirty: true,
            }));

            mockWrite.mockResolvedValue(8);

            // Save all files concurrently
            await Promise.all(
                files.map(filePath => handleEditorSave(filePath, mockDeps))
            );

            expect(mockWrite).toHaveBeenCalledTimes(20);
            expect(mockSaveFile).toHaveBeenCalledTimes(20);
        });
    });
});
