import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleEditorSave, loadFolderChildren, restoreEditorAreaContent, handleFileChange, type VfsDeps } from './vfs-operations.js';
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

// ── Fix 42: loadFolderChildren Generation Counter Tests ──

describe('loadFolderChildren (Fix 42)', () => {
    let mockDeps: VfsDeps;
    let mockLs: any;
    let mockExists: any;
    let mockSetLoading: any;
    let mockUpdateChildren: any;
    let mockLogger: any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        mockLs = vi.mocked(virtualFS.ls);
        mockExists = vi.mocked(virtualFS.exists);
        mockSetLoading = vi.fn();
        mockUpdateChildren = vi.fn();
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
                    setLoading: mockSetLoading,
                    updateChildren: mockUpdateChildren,
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
                    saveFile: vi.fn(),
                },
            },
            toast: { show: vi.fn() },
            settingsDefaultViewMode: 'edit',
            logger: mockLogger,
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('basic functionality', () => {
        it('should load children and update UI', async () => {
            const path = '/test';
            mockLs.mockResolvedValue(['file1.txt', 'file2.txt']);
            mockExists.mockResolvedValue(true);

            const promise = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise;

            expect(mockSetLoading).toHaveBeenCalledWith(path, true);
            expect(mockUpdateChildren).toHaveBeenCalledWith(path, [
                { path: '/test/file1.txt', name: 'file1.txt', type: 'file' },
                { path: '/test/file2.txt', name: 'file2.txt', type: 'file' },
            ]);
            expect(mockSetLoading).toHaveBeenCalledWith(path, false);
        });

        it('should handle folders correctly', async () => {
            const path = '/test';
            mockLs.mockResolvedValue(['folder1', 'file.txt']);
            mockExists.mockImplementation(async (p: string) => p === '/test/file.txt');

            const promise = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise;

            expect(mockUpdateChildren).toHaveBeenCalledWith(path, [
                { path: '/test/folder1', name: 'folder1', type: 'folder' },
                { path: '/test/file.txt', name: 'file.txt', type: 'file' },
            ]);
        });

        it('should handle root path correctly', async () => {
            const path = '/';
            mockLs.mockResolvedValue(['file.txt']);
            mockExists.mockResolvedValue(true);

            const promise = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise;

            expect(mockUpdateChildren).toHaveBeenCalledWith(path, [
                { path: '/file.txt', name: 'file.txt', type: 'file' },
            ]);
        });
    });

    describe('generation counter (Fix 42)', () => {
        it('should discard stale results from concurrent loads', async () => {
            const path = '/test';

            // Use deferred promises to control timing
            let resolveFirstLs: (value: string[]) => void;
            let resolveSecondLs: (value: string[]) => void;
            const firstLsPromise = new Promise<string[]>((resolve) => {
                resolveFirstLs = resolve;
            });
            const secondLsPromise = new Promise<string[]>((resolve) => {
                resolveSecondLs = resolve;
            });

            let lsCallCount = 0;
            mockLs.mockImplementation(async () => {
                lsCallCount++;
                if (lsCallCount === 1) {
                    return firstLsPromise;
                } else {
                    return secondLsPromise;
                }
            });
            mockExists.mockResolvedValue(true);

            // Start first load (generation 1)
            const promise1 = loadFolderChildren(path, mockDeps);

            // Give it a moment to start
            await Promise.resolve();

            // Start second load (generation 2) before first completes
            const promise2 = loadFolderChildren(path, mockDeps);

            // Now resolve both - second resolves first
            resolveSecondLs!(['current1.txt', 'current2.txt']);
            await promise2;

            // Then first resolves (but should be discarded)
            resolveFirstLs!(['stale1.txt', 'stale2.txt']);
            await promise1;

            // Only the second (current) load should update UI
            expect(mockUpdateChildren).toHaveBeenCalledTimes(1);
            expect(mockUpdateChildren).toHaveBeenCalledWith(path, [
                { path: '/test/current1.txt', name: 'current1.txt', type: 'file' },
                { path: '/test/current2.txt', name: 'current2.txt', type: 'file' },
            ]);
        });

        it('should increment generation counter on each call', async () => {
            const path = '/test';
            mockLs.mockResolvedValue([]);
            mockExists.mockResolvedValue(true);

            // Call multiple times
            const promise1 = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise1;

            const promise2 = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise2;

            const promise3 = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise3;

            // All should update UI since they're sequential
            expect(mockUpdateChildren).toHaveBeenCalledTimes(3);
        });

        it('should handle different paths independently', async () => {
            mockLs.mockResolvedValue(['file.txt']);
            mockExists.mockResolvedValue(true);

            // Load two different paths concurrently
            const promise1 = loadFolderChildren('/path1', mockDeps);
            const promise2 = loadFolderChildren('/path2', mockDeps);

            await vi.runAllTimersAsync();
            await promise1;
            await promise2;

            // Both should update UI (different paths don't interfere)
            expect(mockUpdateChildren).toHaveBeenCalledTimes(2);
            expect(mockUpdateChildren).toHaveBeenCalledWith('/path1', expect.any(Array));
            expect(mockUpdateChildren).toHaveBeenCalledWith('/path2', expect.any(Array));
        });

        it('should only clear loading state for current generation', async () => {
            const path = '/test';

            // Use deferred promises to control timing
            let resolveFirstLs: (value: string[]) => void;
            let resolveSecondLs: (value: string[]) => void;
            const firstLsPromise = new Promise<string[]>((resolve) => {
                resolveFirstLs = resolve;
            });
            const secondLsPromise = new Promise<string[]>((resolve) => {
                resolveSecondLs = resolve;
            });

            let lsCallCount = 0;
            mockLs.mockImplementation(async () => {
                lsCallCount++;
                if (lsCallCount === 1) {
                    return firstLsPromise;
                } else {
                    return secondLsPromise;
                }
            });
            mockExists.mockResolvedValue(true);

            // Start first load (generation 1)
            const promise1 = loadFolderChildren(path, mockDeps);
            await Promise.resolve();

            // Start second load (generation 2)
            const promise2 = loadFolderChildren(path, mockDeps);

            // Resolve second first
            resolveSecondLs!(['current.txt']);
            await promise2;

            // Then resolve first (should be discarded)
            resolveFirstLs!(['stale.txt']);
            await promise1;

            // setLoading(true) called twice (once per load)
            // setLoading(false) called only once (by the second/current load)
            expect(mockSetLoading).toHaveBeenCalledWith(path, true);
            expect(mockSetLoading).toHaveBeenCalledWith(path, false);
            // 2x true (both loads start), 1x false (only current generation clears)
            expect(mockSetLoading).toHaveBeenCalledTimes(3);
        });

        it('should handle errors without updating UI', async () => {
            const path = '/test';
            mockLs.mockRejectedValue(new Error('VFS error'));

            const promise = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise;

            expect(mockUpdateChildren).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenCalledWith(path, false);
            expect(mockLogger.error).toHaveBeenCalledWith('Failed to load folder children:', path, expect.any(Error));
        });

        it('should handle persistence disconnected', async () => {
            mockDeps.persistenceIsConnected = false;

            await loadFolderChildren('/test', mockDeps);

            expect(mockLs).not.toHaveBeenCalled();
            expect(mockSetLoading).not.toHaveBeenCalled();
        });
    });

    describe('edge cases', () => {
        it('should handle empty directory', async () => {
            const path = '/empty';
            mockLs.mockResolvedValue([]);

            const promise = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise;

            expect(mockUpdateChildren).toHaveBeenCalledWith(path, []);
        });

        it('should handle rapid successive loads', async () => {
            const path = '/test';
            mockLs.mockResolvedValue(['file.txt']);
            mockExists.mockResolvedValue(true);

            // Start 5 loads sequentially, waiting for each to complete
            for (let i = 0; i < 5; i++) {
                await loadFolderChildren(path, mockDeps);
            }

            // All should update UI since they're sequential (not concurrent)
            expect(mockUpdateChildren).toHaveBeenCalledTimes(5);
        });

        it('should handle load during previous load checkpoint', async () => {
            const path = '/test';
            let lsCallCount = 0;

            mockLs.mockImplementation(async () => {
                lsCallCount++;
                if (lsCallCount === 1) {
                    // First call: will trigger checkpoint after ls
                    return ['file1.txt'];
                } else {
                    // Second call: will complete first
                    return ['file2.txt'];
                }
            });
            mockExists.mockImplementation(async () => {
                if (lsCallCount === 1) {
                    // During first load's exists check, start second load
                    if (!mockExists.mock.calls.some(c => c[0] === '/test/file1.txt')) {
                        // Trigger second load
                        loadFolderChildren(path, mockDeps);
                    }
                }
                return true;
            });

            const promise1 = loadFolderChildren(path, mockDeps);
            await vi.runAllTimersAsync();
            await promise1;

            // Should handle gracefully
            expect(mockUpdateChildren).toHaveBeenCalled();
        });
    });
});

// ── Fix 43/49: restoreEditorAreaContent Tab Existence Check Tests ──

describe('restoreEditorAreaContent (Fix 43/49)', () => {
    let mockDeps: VfsDeps;
    let mockRead: any;
    let mockLoadContent: any;
    let mockCloseFile: any;
    let mockSelectNode: any;
    let mockLogger: any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        mockRead = vi.mocked(virtualFS.read);
        mockLoadContent = vi.fn();
        mockCloseFile = vi.fn();
        mockSelectNode = vi.fn();
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
                    selectNode: mockSelectNode,
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
                    closeFile: mockCloseFile,
                    loadContent: mockLoadContent,
                    saveFile: vi.fn(),
                },
            },
            toast: { show: vi.fn() },
            settingsDefaultViewMode: 'edit',
            logger: mockLogger,
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('basic functionality', () => {
        it('should restore content for all tabs', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/file1.txt', content: '', isDirty: false },
                { filePath: '/file2.txt', content: '', isDirty: false },
            ];
            mockRead.mockImplementation(async (path: string) => `content-${path}`);

            await restoreEditorAreaContent(false, mockDeps);

            expect(mockRead).toHaveBeenCalledTimes(2);
            expect(mockLoadContent).toHaveBeenCalledTimes(2);
            expect(mockLoadContent).toHaveBeenCalledWith('/file1.txt', 'content-/file1.txt');
            expect(mockLoadContent).toHaveBeenCalledWith('/file2.txt', 'content-/file2.txt');
        });

        it('should do nothing if no tabs', async () => {
            mockDeps.editorArea.tabs = [];

            await restoreEditorAreaContent(false, mockDeps);

            expect(mockRead).not.toHaveBeenCalled();
            expect(mockLoadContent).not.toHaveBeenCalled();
        });

        it('should select active file if file tree loaded', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/file1.txt', content: '', isDirty: false },
            ];
            mockDeps.editorArea.activeFilePath = '/file1.txt';
            mockRead.mockResolvedValue('content');

            await restoreEditorAreaContent(true, mockDeps);

            expect(mockSelectNode).toHaveBeenCalledWith('/file1.txt');
        });

        it('should not select active file if file tree not loaded', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/file1.txt', content: '', isDirty: false },
            ];
            mockDeps.editorArea.activeFilePath = '/file1.txt';
            mockRead.mockResolvedValue('content');

            await restoreEditorAreaContent(false, mockDeps);

            expect(mockSelectNode).not.toHaveBeenCalled();
        });
    });

    describe('tab closed during await (Fix 43/49)', () => {
        it('should skip loadContent if tab was closed during read', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/file1.txt', content: '', isDirty: false },
            ];

            let readCalled = false;
            mockRead.mockImplementation(async () => {
                readCalled = true;
                // Simulate tab being closed during await
                mockDeps.editorArea.tabs = [];
                return 'content';
            });

            await restoreEditorAreaContent(false, mockDeps);

            expect(readCalled).toBe(true);
            expect(mockLoadContent).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Tab was closed during restore, skipping:',
                '/file1.txt'
            );
        });

        it('should continue with other tabs if one was closed', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/file1.txt', content: '', isDirty: false },
                { filePath: '/file2.txt', content: '', isDirty: false },
            ];

            let readCount = 0;
            mockRead.mockImplementation(async (path: string) => {
                readCount++;
                if (path === '/file1.txt') {
                    // Simulate first tab being closed during await
                    mockDeps.editorArea.tabs = [
                        { filePath: '/file2.txt', content: '', isDirty: false },
                    ];
                }
                return `content-${path}`;
            });

            await restoreEditorAreaContent(false, mockDeps);

            expect(mockRead).toHaveBeenCalledTimes(2);
            // First tab was closed, so loadContent should not be called for it
            // Second tab should still be loaded
            expect(mockLoadContent).toHaveBeenCalledTimes(1);
            expect(mockLoadContent).toHaveBeenCalledWith('/file2.txt', 'content-/file2.txt');
        });
    });

    describe('file not found in VFS', () => {
        it('should close tab if file not found and tab still exists', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/missing.txt', content: '', isDirty: false },
            ];
            mockRead.mockRejectedValue(new Error('File not found'));

            await restoreEditorAreaContent(false, mockDeps);

            expect(mockCloseFile).toHaveBeenCalledWith('/missing.txt');
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Restored tab file not found in VFS, closing:',
                '/missing.txt'
            );
        });

        it('should not close tab if file not found and tab already closed', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/missing.txt', content: '', isDirty: false },
            ];

            mockRead.mockImplementation(async () => {
                // Simulate tab being closed during await
                mockDeps.editorArea.tabs = [];
                throw new Error('File not found');
            });

            await restoreEditorAreaContent(false, mockDeps);

            // Should not try to close the tab since it's already closed
            expect(mockCloseFile).not.toHaveBeenCalled();
        });

        it('should continue with other tabs if one file is missing', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/missing.txt', content: '', isDirty: false },
                { filePath: '/file2.txt', content: '', isDirty: false },
            ];

            mockRead.mockImplementation(async (path: string) => {
                if (path === '/missing.txt') {
                    throw new Error('File not found');
                }
                return 'content';
            });

            await restoreEditorAreaContent(false, mockDeps);

            expect(mockCloseFile).toHaveBeenCalledWith('/missing.txt');
            expect(mockLoadContent).toHaveBeenCalledWith('/file2.txt', 'content');
        });
    });

    describe('edge cases', () => {
        it('should handle empty activeFilePath', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/file1.txt', content: '', isDirty: false },
            ];
            mockDeps.editorArea.activeFilePath = null;
            mockRead.mockResolvedValue('content');

            await restoreEditorAreaContent(true, mockDeps);

            expect(mockSelectNode).not.toHaveBeenCalled();
        });

        it('should handle activeFilePath that is not in tabs', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/file1.txt', content: '', isDirty: false },
            ];
            mockDeps.editorArea.activeFilePath = '/other.txt';
            mockRead.mockResolvedValue('content');

            await restoreEditorAreaContent(true, mockDeps);

            // Should still select the active file even if not in tabs
            expect(mockSelectNode).toHaveBeenCalledWith('/other.txt');
        });

        it('should handle multiple tabs with mixed scenarios', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/file1.txt', content: '', isDirty: false },
                { filePath: '/file2.txt', content: '', isDirty: false },
                { filePath: '/file3.txt', content: '', isDirty: false },
            ];

            mockRead.mockImplementation(async (path: string) => {
                if (path === '/file1.txt') {
                    // Tab closed during read
                    mockDeps.editorArea.tabs = [
                        { filePath: '/file2.txt', content: '', isDirty: false },
                        { filePath: '/file3.txt', content: '', isDirty: false },
                    ];
                    return 'content1';
                } else if (path === '/file2.txt') {
                    // File not found
                    throw new Error('File not found');
                }
                return 'content3';
            });

            await restoreEditorAreaContent(false, mockDeps);

            // file1: skipped (tab closed)
            // file2: closed (file not found, tab still exists)
            // file3: loaded successfully
            expect(mockLoadContent).toHaveBeenCalledTimes(1);
            expect(mockLoadContent).toHaveBeenCalledWith('/file3.txt', 'content3');
            expect(mockCloseFile).toHaveBeenCalledTimes(1);
            expect(mockCloseFile).toHaveBeenCalledWith('/file2.txt');
        });
    });
});

describe('handleFileChange (Fix 48)', () => {
    let mockDeps: VfsDeps;
    let mockLoadTree: ReturnType<typeof vi.fn>;
    let mockLoadChildren: ReturnType<typeof vi.fn>;
    let mockRead: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRead = vi.mocked(virtualFS.read);
        mockLoadTree = vi.fn().mockResolvedValue(undefined);
        mockLoadChildren = vi.fn().mockResolvedValue(undefined);

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
                    isExpanded: vi.fn().mockReturnValue(false),
                },
            },
            editorArea: {
                tabs: [
                    { filePath: '/test.txt', content: 'old content', isDirty: false },
                ],
                activeFilePath: '/test.txt',
                actions: {
                    openFile: vi.fn(),
                    closeFile: vi.fn(),
                    loadContent: vi.fn(),
                    saveFile: vi.fn(),
                },
            },
            toast: {
                show: vi.fn(),
            },
            settingsDefaultViewMode: 'preview',
            logger: {
                debug: vi.fn(),
                error: vi.fn(),
                warn: vi.fn(),
                info: vi.fn(),
            },
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('write/create events', () => {
        it('should call loadContent (not openFile) when file is open and not dirty', async () => {
            mockRead.mockResolvedValue('file content');

            await handleFileChange('/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            // Fix 48: Should use loadContent to preserve viewMode and cursor
            expect(mockDeps.editorArea.actions.loadContent).toHaveBeenCalledWith('/test.txt', 'file content');
            expect(mockDeps.editorArea.actions.openFile).not.toHaveBeenCalled();
        });

        it('should not reload content if file is dirty', async () => {
            mockRead.mockResolvedValue('file content');
            mockDeps.editorArea.tabs = [
                { filePath: '/test.txt', content: 'modified content', isDirty: true },
            ];

            await handleFileChange('/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            // Should show toast notification instead of reloading
            expect(mockDeps.toast.show).toHaveBeenCalled();
            expect(mockDeps.editorArea.actions.loadContent).not.toHaveBeenCalled();
            expect(mockDeps.editorArea.actions.openFile).not.toHaveBeenCalled();
        });

        it('should do nothing if file is not open in any tab', async () => {
            mockRead.mockResolvedValue('file content');
            mockDeps.editorArea.tabs = [
                { filePath: '/other.txt', content: 'content', isDirty: false },
            ];

            await handleFileChange('/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockDeps.editorArea.actions.loadContent).not.toHaveBeenCalled();
            expect(mockDeps.editorArea.actions.openFile).not.toHaveBeenCalled();
        });

        it('should handle create event the same as write', async () => {
            mockRead.mockResolvedValue('file content');

            await handleFileChange('/test.txt', 'create', true, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockDeps.editorArea.actions.loadContent).toHaveBeenCalledWith('/test.txt', 'file content');
            expect(mockDeps.editorArea.actions.openFile).not.toHaveBeenCalled();
        });

        it('should handle read failure gracefully', async () => {
            mockRead.mockRejectedValue(new Error('Read failed'));

            await handleFileChange('/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            // Should not throw, should keep current content
            expect(mockDeps.editorArea.actions.loadContent).not.toHaveBeenCalled();
            expect(mockDeps.editorArea.actions.openFile).not.toHaveBeenCalled();
        });
    });

    describe('delete events', () => {
        it('should close tab when file is deleted', async () => {
            await handleFileChange('/test.txt', 'delete', true, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockDeps.editorArea.actions.closeFile).toHaveBeenCalledWith('/test.txt');
            expect(mockDeps.toast.show).toHaveBeenCalled();
        });

        it('should do nothing if deleted file is not open', async () => {
            mockDeps.editorArea.tabs = [
                { filePath: '/other.txt', content: 'content', isDirty: false },
            ];

            await handleFileChange('/test.txt', 'delete', true, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockDeps.editorArea.actions.closeFile).not.toHaveBeenCalled();
        });
    });

    describe('batch events', () => {
        it('should reload entire file tree on batch event', async () => {
            await handleFileChange('/test.txt', 'batch', true, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockLoadTree).toHaveBeenCalled();
            expect(mockDeps.editorArea.actions.loadContent).not.toHaveBeenCalled();
            expect(mockDeps.editorArea.actions.openFile).not.toHaveBeenCalled();
        });

        it('should not reload tree if fileTreeLoaded is false', async () => {
            await handleFileChange('/test.txt', 'batch', false, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockLoadTree).not.toHaveBeenCalled();
        });
    });

    describe('file tree updates', () => {
        it('should reload parent directory for write/create events', async () => {
            mockRead.mockResolvedValue('file content');

            await handleFileChange('/dir/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockLoadChildren).toHaveBeenCalledWith('/dir');
        });

        it('should reload root directory if parent is root', async () => {
            mockRead.mockResolvedValue('file content');

            await handleFileChange('/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockLoadTree).toHaveBeenCalled();
        });

        it('should not reload tree if fileTreeLoaded is false', async () => {
            mockRead.mockResolvedValue('file content');

            await handleFileChange('/test.txt', 'write', false, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockLoadTree).not.toHaveBeenCalled();
            expect(mockLoadChildren).not.toHaveBeenCalled();
        });
    });

    describe('edge cases', () => {
        it('should handle empty file path', async () => {
            mockRead.mockResolvedValue('file content');

            await handleFileChange('', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            // Should handle gracefully without crashing
            expect(mockLoadTree).toHaveBeenCalled(); // Empty path treated as root
        });

        it('should handle file path with only filename', async () => {
            mockRead.mockResolvedValue('file content');

            await handleFileChange('test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            // Should treat as root-level file
            expect(mockLoadTree).toHaveBeenCalled();
        });

        it('should handle deeply nested paths', async () => {
            mockRead.mockResolvedValue('file content');

            await handleFileChange('/a/b/c/d/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            expect(mockLoadChildren).toHaveBeenCalledWith('/a/b/c/d');
        });

        it('should handle multiple tabs with same file', async () => {
            mockRead.mockResolvedValue('file content');
            mockDeps.editorArea.tabs = [
                { filePath: '/test.txt', content: 'content1', isDirty: false },
                { filePath: '/test.txt', content: 'content2', isDirty: false },
            ];

            await handleFileChange('/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            // Should update the first matching tab
            expect(mockDeps.editorArea.actions.loadContent).toHaveBeenCalledWith('/test.txt', 'file content');
        });

        it('should preserve viewMode when using loadContent', async () => {
            // This test verifies the fix: loadContent preserves viewMode, openFile resets it
            mockRead.mockResolvedValue('file content');

            // Simulate a tab in preview mode
            mockDeps.editorArea.tabs = [
                { filePath: '/test.txt', content: 'old content', isDirty: false, viewMode: 'preview' },
            ];

            await handleFileChange('/test.txt', 'write', true, mockDeps, mockLoadTree, mockLoadChildren);

            // loadContent should be called (preserves viewMode)
            expect(mockDeps.editorArea.actions.loadContent).toHaveBeenCalledWith('/test.txt', 'file content');
            // openFile should NOT be called (would reset viewMode)
            expect(mockDeps.editorArea.actions.openFile).not.toHaveBeenCalled();
        });
    });
});
