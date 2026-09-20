import {describe, it, expect, beforeEach, vi} from 'vitest';
import {EditorAreaController} from './editor-area.controller.js';
import {STORAGE_KEYS} from '../config/auth.js';

class MockHost {
    updateCount = 0;
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('EditorAreaController', () => {
    let host: MockHost;
    let ctrl: EditorAreaController;

    beforeEach(() => {
        localStorage.clear();
        host = new MockHost();
        ctrl = new EditorAreaController(host as any);
    });

    describe('initial state', () => {
        it('should have empty tabs and no active file', () => {
            expect(ctrl.state.tabs).toEqual([]);
            expect(ctrl.state.activeFilePath).toBe('');
        });

        it('should expose actions object', () => {
            expect(ctrl.actions).toBeDefined();
            expect(typeof ctrl.actions.openFile).toBe('function');
            expect(typeof ctrl.actions.closeFile).toBe('function');
            expect(typeof ctrl.actions.closeAll).toBe('function');
            expect(typeof ctrl.actions.switchTab).toBe('function');
            expect(typeof ctrl.actions.updateContent).toBe('function');
            expect(typeof ctrl.actions.saveFile).toBe('function');
            expect(typeof ctrl.actions.setViewMode).toBe('function');
            expect(typeof ctrl.actions.setCursorPosition).toBe('function');
            expect(typeof ctrl.actions.loadContent).toBe('function');
        });

        it('should have undefined activeTab when no tabs', () => {
            expect(ctrl.activeTab).toBeUndefined();
        });
    });

    describe('openFile', () => {
        it('should open new file as new tab', () => {
            ctrl.actions.openFile('/test.md', '# Hello', 'edit');
            expect(ctrl.state.tabs).toHaveLength(1);
            expect(ctrl.state.tabs[0].filePath).toBe('/test.md');
            expect(ctrl.state.tabs[0].content).toBe('# Hello');
            expect(ctrl.state.tabs[0].viewMode).toBe('edit');
            expect(ctrl.state.tabs[0].isDirty).toBe(false);
            expect(ctrl.state.activeFilePath).toBe('/test.md');
        });

        it('should not duplicate existing tab (idempotent)', () => {
            ctrl.actions.openFile('/test.md', 'First Content', 'edit');
            ctrl.actions.openFile('/test.md', 'Second Content', 'edit');

            expect(ctrl.state.tabs).toHaveLength(1);
            expect(ctrl.state.tabs[0].content).toBe('First Content');
            expect(ctrl.state.activeFilePath).toBe('/test.md');
        });

        it('should use default viewMode when not specified', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            expect(ctrl.state.tabs[0].viewMode).toBe('edit');
        });

        it('should support preview viewMode', () => {
            ctrl.actions.openFile('/test.md', 'Content', 'preview');
            expect(ctrl.state.tabs[0].viewMode).toBe('preview');
        });

        it('should support split viewMode', () => {
            ctrl.actions.openFile('/test.md', 'Content', 'split');
            expect(ctrl.state.tabs[0].viewMode).toBe('split');
        });

        it('should set initial cursor position to 1:1', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            expect(ctrl.state.tabs[0].cursorPosition).toEqual({line: 1, column: 1});
        });

        it('should request host update on open', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.openFile('/test.md', 'Content');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('closeFile', () => {
        it('should close existing file', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            ctrl.actions.closeFile('/test1.md');

            expect(ctrl.state.tabs).toHaveLength(1);
            expect(ctrl.state.tabs[0].filePath).toBe('/test2.md');
        });

        it('should activate left adjacent tab when closing active', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            ctrl.actions.openFile('/test3.md', 'Content 3');
            expect(ctrl.state.activeFilePath).toBe('/test3.md');

            ctrl.actions.closeFile('/test3.md');
            expect(ctrl.state.activeFilePath).toBe('/test2.md');
        });

        it('should activate right adjacent tab when closing middle', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            ctrl.actions.openFile('/test3.md', 'Content 3');
            ctrl.actions.switchTab('/test2.md');

            ctrl.actions.closeFile('/test2.md');
            expect(ctrl.state.activeFilePath).toBe('/test3.md');
        });

        it('should clear activeFilePath when closing last tab', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.closeFile('/test.md');

            expect(ctrl.state.tabs).toHaveLength(0);
            expect(ctrl.state.activeFilePath).toBe('');
        });

        it('should not change activeFilePath when closing non-active tab', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            ctrl.actions.switchTab('/test2.md');

            ctrl.actions.closeFile('/test1.md');
            expect(ctrl.state.activeFilePath).toBe('/test2.md');
        });

        it('should do nothing when closing non-existent file', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            const tabsBefore = ctrl.state.tabs.length;
            ctrl.actions.closeFile('/non-existent.md');
            expect(ctrl.state.tabs.length).toBe(tabsBefore);
        });

        it('should request host update on close', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            const updatesBefore = host.updateCount;
            ctrl.actions.closeFile('/test.md');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('closeAll', () => {
        it('should close all tabs', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            ctrl.actions.closeAll();

            expect(ctrl.state.tabs).toHaveLength(0);
            expect(ctrl.state.activeFilePath).toBe('');
        });

        it('should request host update', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            const updatesBefore = host.updateCount;
            ctrl.actions.closeAll();
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('switchTab', () => {
        it('should switch to existing tab', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            ctrl.actions.switchTab('/test1.md');

            expect(ctrl.state.activeFilePath).toBe('/test1.md');
        });

        it('should do nothing when switching to non-existent tab', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.switchTab('/non-existent.md');
            expect(ctrl.state.activeFilePath).toBe('/test.md');
        });

        it('should request host update on switch', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            const updatesBefore = host.updateCount;
            ctrl.actions.switchTab('/test1.md');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('updateContent', () => {
        it('should update file content and mark dirty', () => {
            ctrl.actions.openFile('/test.md', 'Original');
            ctrl.actions.updateContent('/test.md', 'Updated');

            expect(ctrl.state.tabs[0].content).toBe('Updated');
            expect(ctrl.state.tabs[0].isDirty).toBe(true);
        });

        it('should only update specified file', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            ctrl.actions.updateContent('/test1.md', 'Updated 1');

            expect(ctrl.state.tabs[0].content).toBe('Updated 1');
            expect(ctrl.state.tabs[0].isDirty).toBe(true);
            expect(ctrl.state.tabs[1].content).toBe('Content 2');
            expect(ctrl.state.tabs[1].isDirty).toBe(false);
        });

        it('should request host update', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            const updatesBefore = host.updateCount;
            ctrl.actions.updateContent('/test.md', 'Updated');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('saveFile', () => {
        it('should clear dirty flag', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.updateContent('/test.md', 'Updated');
            expect(ctrl.state.tabs[0].isDirty).toBe(true);

            ctrl.actions.saveFile('/test.md');
            expect(ctrl.state.tabs[0].isDirty).toBe(false);
        });

        it('should not change content', () => {
            ctrl.actions.openFile('/test.md', 'Original');
            ctrl.actions.updateContent('/test.md', 'Updated');
            ctrl.actions.saveFile('/test.md');

            expect(ctrl.state.tabs[0].content).toBe('Updated');
        });

        it('should request host update', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.updateContent('/test.md', 'Updated');
            const updatesBefore = host.updateCount;
            ctrl.actions.saveFile('/test.md');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('setViewMode', () => {
        it('should update view mode', () => {
            ctrl.actions.openFile('/test.md', 'Content', 'edit');
            ctrl.actions.setViewMode('/test.md', 'preview');

            expect(ctrl.state.tabs[0].viewMode).toBe('preview');
        });

        it('should support all view modes', () => {
            ctrl.actions.openFile('/test.md', 'Content');

            ctrl.actions.setViewMode('/test.md', 'preview');
            expect(ctrl.state.tabs[0].viewMode).toBe('preview');

            ctrl.actions.setViewMode('/test.md', 'split');
            expect(ctrl.state.tabs[0].viewMode).toBe('split');

            ctrl.actions.setViewMode('/test.md', 'edit');
            expect(ctrl.state.tabs[0].viewMode).toBe('edit');
        });

        it('should request host update', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            const updatesBefore = host.updateCount;
            ctrl.actions.setViewMode('/test.md', 'preview');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('setCursorPosition', () => {
        it('should update cursor position', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.setCursorPosition('/test.md', {line: 10, column: 5});

            expect(ctrl.state.tabs[0].cursorPosition).toEqual({line: 10, column: 5});
        });

        it('should do nothing when position unchanged', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.setCursorPosition('/test.md', {line: 1, column: 1});
            const updatesBefore = host.updateCount;
            ctrl.actions.setCursorPosition('/test.md', {line: 1, column: 1});
            expect(host.updateCount).toBe(updatesBefore);
        });

        it('should do nothing for non-existent file', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.setCursorPosition('/non-existent.md', {line: 1, column: 1});
            // Should not throw
        });

        it('should request host update on position change', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            const updatesBefore = host.updateCount;
            ctrl.actions.setCursorPosition('/test.md', {line: 5, column: 3});
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('loadContent', () => {
        it('should load content to existing tab without marking dirty', () => {
            ctrl.actions.openFile('/test.md', 'Original');
            ctrl.actions.loadContent('/test.md', 'Loaded');

            expect(ctrl.state.tabs[0].content).toBe('Loaded');
            expect(ctrl.state.tabs[0].isDirty).toBe(false);
        });

        it('should create new tab if file not open', () => {
            ctrl.actions.loadContent('/test.md', 'Loaded');

            expect(ctrl.state.tabs).toHaveLength(1);
            expect(ctrl.state.tabs[0].filePath).toBe('/test.md');
            expect(ctrl.state.tabs[0].content).toBe('Loaded');
            expect(ctrl.state.tabs[0].isDirty).toBe(false);
        });

        it('should set activeFilePath if no tabs', () => {
            ctrl.actions.loadContent('/test.md', 'Loaded');
            expect(ctrl.state.activeFilePath).toBe('/test.md');
        });

        it('should not change activeFilePath if tabs exist', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.loadContent('/test2.md', 'Content 2');
            expect(ctrl.state.activeFilePath).toBe('/test1.md');
        });

        it('should request host update', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            const updatesBefore = host.updateCount;
            ctrl.actions.loadContent('/test.md', 'Loaded');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('getters', () => {
        it('should return activeTab correctly', () => {
            ctrl.actions.openFile('/test1.md', 'Content 1');
            ctrl.actions.openFile('/test2.md', 'Content 2');
            ctrl.actions.switchTab('/test1.md');

            const activeTab = ctrl.activeTab;
            expect(activeTab).toBeDefined();
            expect(activeTab?.filePath).toBe('/test1.md');
        });

        it('should return readonly tabs array', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            const tabs = ctrl.tabs;
            expect(tabs).toHaveLength(1);
        });
    });

    describe('persistence', () => {
        it('should persist tabs to localStorage', () => {
            ctrl.actions.openFile('/test.md', 'Content', 'preview');
            const stored = localStorage.getItem(STORAGE_KEYS.editorArea);
            expect(stored).toBeDefined();

            const data = JSON.parse(stored!);
            expect(data.tabs).toHaveLength(1);
            expect(data.tabs[0].filePath).toBe('/test.md');
            expect(data.tabs[0].viewMode).toBe('preview');
            expect(data.activeFilePath).toBe('/test.md');
        });

        it('should not persist content (only metadata)', () => {
            ctrl.actions.openFile('/test.md', 'Secret Content');
            const stored = localStorage.getItem(STORAGE_KEYS.editorArea);
            const data = JSON.parse(stored!);

            expect(data.tabs[0]).not.toHaveProperty('content');
            expect(data.tabs[0]).not.toHaveProperty('isDirty');
        });

        it('should persist cursor position (after throttle delay)', async () => {
            vi.useFakeTimers();
            try {
                ctrl.actions.openFile('/test.md', 'Content');
                ctrl.actions.setCursorPosition('/test.md', {line: 10, column: 5});

                // Advance past the 2s throttle delay
                vi.advanceTimersByTime(2100);

                const stored = localStorage.getItem(STORAGE_KEYS.editorArea);
                const data = JSON.parse(stored!);
                expect(data.tabs[0].cursorPosition).toEqual({line: 10, column: 5});
            } finally {
                vi.useRealTimers();
            }
        });

        it('should remove from localStorage when closing all', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.closeAll();

            const stored = localStorage.getItem(STORAGE_KEYS.editorArea);
            expect(stored).toBeNull();
        });

        it('should restore tabs on construction', () => {
            const savedData = {
                tabs: [
                    {filePath: '/test1.md', viewMode: 'edit', cursorPosition: {line: 1, column: 1}},
                    {filePath: '/test2.md', viewMode: 'preview', cursorPosition: {line: 5, column: 3}},
                ],
                activeFilePath: '/test2.md',
            };
            localStorage.setItem(STORAGE_KEYS.editorArea, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new EditorAreaController(newHost as any);

            expect(newCtrl.state.tabs).toHaveLength(2);
            expect(newCtrl.state.tabs[0].filePath).toBe('/test1.md');
            expect(newCtrl.state.tabs[0].viewMode).toBe('edit');
            expect(newCtrl.state.tabs[0].content).toBe(''); // Content not restored
            expect(newCtrl.state.tabs[1].filePath).toBe('/test2.md');
            expect(newCtrl.state.tabs[1].viewMode).toBe('preview');
            expect(newCtrl.state.activeFilePath).toBe('/test2.md');
        });

        it('should handle corrupted localStorage data', () => {
            localStorage.setItem(STORAGE_KEYS.editorArea, 'not-json');
            const newHost = new MockHost();
            const newCtrl = new EditorAreaController(newHost as any);

            expect(newCtrl.state.tabs).toHaveLength(0);
        });

        it('should handle invalid viewMode in storage', () => {
            const savedData = {
                tabs: [{filePath: '/test.md', viewMode: 'invalid', cursorPosition: {line: 1, column: 1}}],
                activeFilePath: '/test.md',
            };
            localStorage.setItem(STORAGE_KEYS.editorArea, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new EditorAreaController(newHost as any);

            expect(newCtrl.state.tabs[0].viewMode).toBe('edit'); // Defaults to edit
        });

        it('should restore first tab as active if stored active not found', () => {
            const savedData = {
                tabs: [{filePath: '/test.md', viewMode: 'edit', cursorPosition: {line: 1, column: 1}}],
                activeFilePath: '/non-existent.md',
            };
            localStorage.setItem(STORAGE_KEYS.editorArea, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new EditorAreaController(newHost as any);

            expect(newCtrl.state.activeFilePath).toBe('/test.md');
        });
    });

    describe('hostDisconnected', () => {
        it('should cleanup cursor persist timer', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.setCursorPosition('/test.md', {line: 5, column: 3});

            // Trigger hostDisconnected
            ctrl.hostDisconnected();

            // Timer should be cleared (no error thrown)
        });
    });

    describe('edge cases', () => {
        it('should handle rapid open/close operations', () => {
            for (let i = 0; i < 10; i++) {
                ctrl.actions.openFile(`/test${i}.md`, `Content ${i}`);
            }
            expect(ctrl.state.tabs).toHaveLength(10);

            for (let i = 0; i < 5; i++) {
                ctrl.actions.closeFile(`/test${i}.md`);
            }
            expect(ctrl.state.tabs).toHaveLength(5);
        });

        it('should handle special characters in file paths', () => {
            const specialPath = '/path/with spaces/and-dashes_and_underscores.md';
            ctrl.actions.openFile(specialPath, 'Content');
            expect(ctrl.state.tabs[0].filePath).toBe(specialPath);
        });

        it('should handle very large content', () => {
            const largeContent = 'A'.repeat(100000);
            ctrl.actions.openFile('/test.md', largeContent);
            expect(ctrl.state.tabs[0].content).toBe(largeContent);
        });

        it('should handle cursor position at boundaries', () => {
            ctrl.actions.openFile('/test.md', 'Content');
            ctrl.actions.setCursorPosition('/test.md', {line: 1, column: 1});
            expect(ctrl.state.tabs[0].cursorPosition).toEqual({line: 1, column: 1});

            ctrl.actions.setCursorPosition('/test.md', {line: 1000, column: 1000});
            expect(ctrl.state.tabs[0].cursorPosition).toEqual({line: 1000, column: 1000});
        });
    });
});
