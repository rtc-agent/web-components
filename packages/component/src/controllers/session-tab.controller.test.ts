import {describe, it, expect, beforeEach} from 'vitest';
import {SessionTabController} from './session-tab.controller.js';

class MockHost {
    updateCount = 0;
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('SessionTabController', () => {
    let host: MockHost;
    let ctrl: SessionTabController;

    beforeEach(() => {
        host = new MockHost();
        ctrl = new SessionTabController(host as any);
        // 清理 localStorage
        localStorage.clear();
    });

    describe('initial state', () => {
        it('should have empty tabs and null activeSessionId', () => {
            expect(ctrl.value.state.tabs).toEqual([]);
            expect(ctrl.value.state.activeSessionId).toBeNull();
        });

        it('should expose actions object', () => {
            expect(ctrl.value.actions).toBeDefined();
            expect(typeof ctrl.value.actions.openOrActivate).toBe('function');
            expect(typeof ctrl.value.actions.closeTab).toBe('function');
            expect(typeof ctrl.value.actions.setActiveTab).toBe('function');
            expect(typeof ctrl.value.actions.clearAll).toBe('function');
        });
    });

    describe('openOrActivate', () => {
        it('should add new tab when session not open', () => {
            ctrl.actions.openOrActivate('session-1', 'Test Session');
            expect(ctrl.value.state.tabs).toHaveLength(1);
            expect(ctrl.value.state.tabs[0].sessionId).toBe('session-1');
            expect(ctrl.value.state.tabs[0].title).toBe('Test Session');
            expect(ctrl.value.state.activeSessionId).toBe('session-1');
        });

        it('should activate existing tab without duplicating', () => {
            ctrl.actions.openOrActivate('session-1', 'First Title');
            ctrl.actions.openOrActivate('session-2', 'Second Title');
            expect(ctrl.value.state.tabs).toHaveLength(2);
            expect(ctrl.value.state.activeSessionId).toBe('session-2');

            // Re-activate first tab
            ctrl.actions.openOrActivate('session-1', 'New Title');
            expect(ctrl.value.state.tabs).toHaveLength(2);
            expect(ctrl.value.state.activeSessionId).toBe('session-1');
        });

        it('should not overwrite real title with placeholder', () => {
            ctrl.actions.openOrActivate('session-1', 'Real Title');
            ctrl.actions.openOrActivate('session-1', 'Untitled');
            expect(ctrl.value.state.tabs[0].title).toBe('Real Title');
        });

        it('should overwrite placeholder with real title', () => {
            ctrl.actions.openOrActivate('session-1', 'Untitled');
            ctrl.actions.openOrActivate('session-1', 'Real Title');
            expect(ctrl.value.state.tabs[0].title).toBe('Real Title');
        });

        it('should mark placeholder titles as isDefault', () => {
            ctrl.actions.openOrActivate('session-1', 'Untitled');
            expect(ctrl.value.state.tabs[0].isDefault).toBe(true);

            ctrl.actions.openOrActivate('session-2', 'New Chat');
            expect(ctrl.value.state.tabs[1].isDefault).toBe(true);

            ctrl.actions.openOrActivate('session-3', 'Real Title');
            expect(ctrl.value.state.tabs[2].isDefault).toBe(false);
        });

        it('should handle isUnsaved option', () => {
            ctrl.actions.openOrActivate('session-1', 'Draft', {isUnsaved: true});
            expect(ctrl.value.state.tabs[0].isUnsaved).toBe(true);
        });

        it('should skip activation when activate=false', () => {
            ctrl.actions.openOrActivate('session-1', 'First');
            ctrl.actions.openOrActivate('session-2', 'Second', {activate: false});
            expect(ctrl.value.state.activeSessionId).toBe('session-1');
            expect(ctrl.value.state.tabs).toHaveLength(2);
        });

        it('should request host update on tab open', () => {
            const initialUpdates = host.updateCount;
            ctrl.actions.openOrActivate('session-1', 'Test');
            expect(host.updateCount).toBeGreaterThan(initialUpdates);
        });
    });

    describe('closeTab', () => {
        it('should close existing tab', () => {
            ctrl.actions.openOrActivate('session-1', 'First');
            ctrl.actions.openOrActivate('session-2', 'Second');
            ctrl.actions.closeTab('session-1');
            expect(ctrl.value.state.tabs).toHaveLength(1);
            expect(ctrl.value.state.tabs[0].sessionId).toBe('session-2');
        });

        it('should activate adjacent tab when closing active tab', () => {
            ctrl.actions.openOrActivate('session-1', 'First');
            ctrl.actions.openOrActivate('session-2', 'Second');
            ctrl.actions.openOrActivate('session-3', 'Third');
            expect(ctrl.value.state.activeSessionId).toBe('session-3');

            // Close active (rightmost) tab
            ctrl.actions.closeTab('session-3');
            expect(ctrl.value.state.activeSessionId).toBe('session-2');
        });

        it('should activate right tab when closing middle tab', () => {
            ctrl.actions.openOrActivate('session-1', 'First');
            ctrl.actions.openOrActivate('session-2', 'Second');
            ctrl.actions.openOrActivate('session-3', 'Third');
            ctrl.actions.setActiveTab('session-2');
            expect(ctrl.value.state.activeSessionId).toBe('session-2');

            // Closing middle tab activates right tab (session-3)
            ctrl.actions.closeTab('session-2');
            expect(ctrl.value.state.activeSessionId).toBe('session-3');
        });

        it('should clear activeSessionId when closing last tab', () => {
            ctrl.actions.openOrActivate('session-1', 'Only Tab');
            expect(ctrl.value.state.activeSessionId).toBe('session-1');

            ctrl.actions.closeTab('session-1');
            expect(ctrl.value.state.tabs).toHaveLength(0);
            expect(ctrl.value.state.activeSessionId).toBeNull();
        });

        it('should do nothing when closing non-existent tab', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            const tabsBefore = ctrl.value.state.tabs.length;
            ctrl.actions.closeTab('non-existent');
            expect(ctrl.value.state.tabs.length).toBe(tabsBefore);
        });

        it('should request host update on tab close', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            const updatesBefore = host.updateCount;
            ctrl.actions.closeTab('session-1');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('setActiveTab', () => {
        it('should set active tab', () => {
            ctrl.actions.openOrActivate('session-1', 'First');
            ctrl.actions.openOrActivate('session-2', 'Second');
            ctrl.actions.setActiveTab('session-1');
            expect(ctrl.value.state.activeSessionId).toBe('session-1');
        });

        it('should set active tab to null', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            ctrl.actions.setActiveTab(null);
            expect(ctrl.value.state.activeSessionId).toBeNull();
        });

        it('should request host update when changing active tab', () => {
            ctrl.actions.openOrActivate('session-1', 'First');
            ctrl.actions.openOrActivate('session-2', 'Second');
            const updatesBefore = host.updateCount;
            ctrl.actions.setActiveTab('session-1');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('clearAll', () => {
        it('should clear all tabs and reset activeSessionId', () => {
            ctrl.actions.openOrActivate('session-1', 'First');
            ctrl.actions.openOrActivate('session-2', 'Second');
            ctrl.actions.clearAll();
            expect(ctrl.value.state.tabs).toHaveLength(0);
            expect(ctrl.value.state.activeSessionId).toBeNull();
        });

        it('should request host update', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            const updatesBefore = host.updateCount;
            ctrl.actions.clearAll();
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('filterInvalidTabs', () => {
        it('should remove tabs with invalid session IDs', () => {
            ctrl.actions.openOrActivate('session-1', 'Valid 1');
            ctrl.actions.openOrActivate('session-2', 'Valid 2');
            ctrl.actions.openOrActivate('session-3', 'Invalid');

            const validIds = new Set(['session-1', 'session-2']);
            const changed = ctrl.filterInvalidTabs(validIds);

            expect(changed).toBe(true);
            expect(ctrl.value.state.tabs).toHaveLength(2);
            expect(ctrl.value.state.tabs.map(t => t.sessionId)).toEqual(['session-1', 'session-2']);
        });

        it('should keep unsaved tabs even if not in valid IDs', () => {
            ctrl.actions.openOrActivate('session-1', 'Valid');
            ctrl.actions.openOrActivate('draft-1', 'Draft', {isUnsaved: true});

            const validIds = new Set(['session-1']);
            ctrl.filterInvalidTabs(validIds);

            expect(ctrl.value.state.tabs).toHaveLength(2);
            expect(ctrl.value.state.tabs.find(t => t.sessionId === 'draft-1')).toBeDefined();
        });

        it('should activate first tab when active tab is filtered out', () => {
            ctrl.actions.openOrActivate('session-1', 'Valid');
            ctrl.actions.openOrActivate('session-2', 'To Remove');
            ctrl.actions.setActiveTab('session-2');

            const validIds = new Set(['session-1']);
            ctrl.filterInvalidTabs(validIds);

            expect(ctrl.value.state.activeSessionId).toBe('session-1');
        });

        it('should set activeSessionId to null when all tabs filtered', () => {
            ctrl.actions.openOrActivate('session-1', 'To Remove');
            const validIds = new Set<string>();
            ctrl.filterInvalidTabs(validIds);

            expect(ctrl.value.state.tabs).toHaveLength(0);
            expect(ctrl.value.state.activeSessionId).toBeNull();
        });

        it('should return false when no tabs are removed', () => {
            ctrl.actions.openOrActivate('session-1', 'Valid');
            const validIds = new Set(['session-1']);
            const changed = ctrl.filterInvalidTabs(validIds);

            expect(changed).toBe(false);
        });
    });

    describe('updateTabTitles', () => {
        it('should update tab titles from map', () => {
            ctrl.actions.openOrActivate('session-1', 'Old Title');
            ctrl.actions.openOrActivate('session-2', 'Another Title');

            const titleMap = new Map<string, string>([
                ['session-1', 'New Title 1'],
                ['session-2', 'New Title 2'],
            ]);
            const changed = ctrl.actions.updateTabTitles(titleMap);

            expect(changed).toBe(true);
            expect(ctrl.value.state.tabs[0].title).toBe('New Title 1');
            expect(ctrl.value.state.tabs[1].title).toBe('New Title 2');
        });

        it('should skip empty titles', () => {
            ctrl.actions.openOrActivate('session-1', 'Original Title');
            const titleMap = new Map<string, string>([['session-1', '']]);
            ctrl.actions.updateTabTitles(titleMap);

            expect(ctrl.value.state.tabs[0].title).toBe('Original Title');
        });

        it('should skip undefined titles (unsaved tabs)', () => {
            ctrl.actions.openOrActivate('session-1', 'Unsaved', {isUnsaved: true});
            const titleMap = new Map<string, string>(); // No entry for session-1
            ctrl.actions.updateTabTitles(titleMap);

            expect(ctrl.value.state.tabs[0].title).toBe('Unsaved');
        });

        it('should skip when title unchanged', () => {
            ctrl.actions.openOrActivate('session-1', 'Same Title');
            const titleMap = new Map<string, string>([['session-1', 'Same Title']]);
            const changed = ctrl.actions.updateTabTitles(titleMap);

            expect(changed).toBe(false);
        });

        it('should clear isDefault when title updated', () => {
            ctrl.actions.openOrActivate('session-1', 'Untitled');
            expect(ctrl.value.state.tabs[0].isDefault).toBe(true);

            const titleMap = new Map<string, string>([['session-1', 'Real Title']]);
            ctrl.actions.updateTabTitles(titleMap);

            expect(ctrl.value.state.tabs[0].isDefault).toBe(false);
            expect(ctrl.value.state.tabs[0].isUnsaved).toBe(false);
        });
    });

    describe('syncTabStatuses', () => {
        it('should update tab statuses from map', () => {
            ctrl.actions.openOrActivate('session-1', 'Session 1');
            ctrl.actions.openOrActivate('session-2', 'Session 2');

            const statusMap = new Map<string, any>([
                ['session-1', 'active'],
                ['session-2', 'idle'],
            ]);
            const changed = ctrl.actions.syncTabStatuses(statusMap);

            expect(changed).toBe(true);
            expect(ctrl.value.state.tabs[0].status).toBe('active');
            expect(ctrl.value.state.tabs[1].status).toBe('idle');
        });

        it('should skip when status unchanged', () => {
            ctrl.actions.openOrActivate('session-1', 'Session 1');
            ctrl.actions.updateTabStatus('session-1', 'active');

            const statusMap = new Map<string, any>([['session-1', 'active']]);
            const changed = ctrl.actions.syncTabStatuses(statusMap);

            expect(changed).toBe(false);
        });

        it('should skip undefined statuses', () => {
            ctrl.actions.openOrActivate('session-1', 'Session 1');
            const statusMap = new Map<string, any>(); // No entry
            ctrl.actions.syncTabStatuses(statusMap);

            expect(ctrl.value.state.tabs[0].status).toBeUndefined();
        });
    });

    describe('markSaved', () => {
        it('should mark unsaved tab as saved', () => {
            ctrl.actions.openOrActivate('session-1', 'Draft', {isUnsaved: true});
            expect(ctrl.value.state.tabs[0].isUnsaved).toBe(true);

            ctrl.actions.markSaved('session-1');
            expect(ctrl.value.state.tabs[0].isUnsaved).toBe(false);
        });

        it('should do nothing for non-unsaved tab', () => {
            ctrl.actions.openOrActivate('session-1', 'Saved Tab');
            ctrl.actions.markSaved('session-1');
            expect(ctrl.value.state.tabs[0].isUnsaved).toBeFalsy();
        });

        it('should do nothing for non-existent session', () => {
            ctrl.actions.openOrActivate('session-1', 'Test', {isUnsaved: true});
            ctrl.actions.markSaved('non-existent');
            expect(ctrl.value.state.tabs[0].isUnsaved).toBe(true);
        });
    });

    describe('findUnsavedTab', () => {
        it('should find unsaved tab', () => {
            ctrl.actions.openOrActivate('session-1', 'Saved');
            ctrl.actions.openOrActivate('session-2', 'Draft', {isUnsaved: true});

            const unsaved = ctrl.actions.findUnsavedTab();
            expect(unsaved).toBeDefined();
            expect(unsaved?.sessionId).toBe('session-2');
        });

        it('should return undefined when no unsaved tab', () => {
            ctrl.actions.openOrActivate('session-1', 'Saved 1');
            ctrl.actions.openOrActivate('session-2', 'Saved 2');

            const unsaved = ctrl.actions.findUnsavedTab();
            expect(unsaved).toBeUndefined();
        });

        it('should return first unsaved tab', () => {
            ctrl.actions.openOrActivate('session-1', 'Draft 1', {isUnsaved: true});
            ctrl.actions.openOrActivate('session-2', 'Draft 2', {isUnsaved: true});

            const unsaved = ctrl.actions.findUnsavedTab();
            expect(unsaved?.sessionId).toBe('session-1');
        });
    });

    describe('updateTabStatus', () => {
        it('should update tab status', () => {
            ctrl.actions.openOrActivate('session-1', 'Session');
            ctrl.actions.updateTabStatus('session-1', 'active');
            expect(ctrl.value.state.tabs[0].status).toBe('active');

            ctrl.actions.updateTabStatus('session-1', 'idle');
            expect(ctrl.value.state.tabs[0].status).toBe('idle');
        });

        it('should skip when tab not found', () => {
            ctrl.actions.openOrActivate('session-1', 'Session');
            ctrl.actions.updateTabStatus('non-existent', 'active');
            // Should not throw
        });

        it('should skip when status unchanged', () => {
            ctrl.actions.openOrActivate('session-1', 'Session');
            ctrl.actions.updateTabStatus('session-1', 'active');
            const updatesBefore = host.updateCount;
            ctrl.actions.updateTabStatus('session-1', 'active');
            expect(host.updateCount).toBe(updatesBefore);
        });
    });

    describe('localStorage persistence', () => {
        it('should persist activeSessionId to localStorage', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            const stored = localStorage.getItem('rtc:active-tab');
            expect(stored).toBe('session-1');
        });

        it('should remove from localStorage when clearing all', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            ctrl.actions.clearAll();
            const stored = localStorage.getItem('rtc:active-tab');
            expect(stored).toBeNull();
        });

        it('should remove from localStorage when setting active to null', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            ctrl.actions.setActiveTab(null);
            const stored = localStorage.getItem('rtc:active-tab');
            expect(stored).toBeNull();
        });

        it('should restore active tab from storage', () => {
            ctrl.actions.openOrActivate('session-1', 'First');
            ctrl.actions.openOrActivate('session-2', 'Second');
            localStorage.setItem('rtc:active-tab', 'session-1');

            const restored = ctrl.actions.restoreActiveFromStorage();
            expect(restored).toBe(true);
            expect(ctrl.value.state.activeSessionId).toBe('session-1');
        });

        it('should not restore if stored ID not in tabs', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            localStorage.setItem('rtc:active-tab', 'non-existent');

            const restored = ctrl.actions.restoreActiveFromStorage();
            expect(restored).toBe(false);
            expect(ctrl.value.state.activeSessionId).toBe('session-1');
        });

        it('should not restore if already active', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            localStorage.setItem('rtc:active-tab', 'session-1');

            const restored = ctrl.actions.restoreActiveFromStorage();
            expect(restored).toBe(false);
        });

        it('should get stored active session ID', () => {
            ctrl.actions.openOrActivate('session-1', 'Test');
            const storedId = ctrl.actions.getStoredActiveSessionId();
            expect(storedId).toBe('session-1');
        });
    });

    describe('edge cases', () => {
        it('should handle rapid open/close operations', () => {
            for (let i = 0; i < 10; i++) {
                ctrl.actions.openOrActivate(`session-${i}`, `Session ${i}`);
            }
            expect(ctrl.value.state.tabs).toHaveLength(10);

            for (let i = 0; i < 5; i++) {
                ctrl.actions.closeTab(`session-${i}`);
            }
            expect(ctrl.value.state.tabs).toHaveLength(5);
        });

        it('should handle special characters in titles', () => {
            ctrl.actions.openOrActivate('session-1', 'Title with "quotes" and <brackets>');
            expect(ctrl.value.state.tabs[0].title).toBe('Title with "quotes" and <brackets>');
        });

        it('should handle very long titles', () => {
            const longTitle = 'A'.repeat(1000);
            ctrl.actions.openOrActivate('session-1', longTitle);
            expect(ctrl.value.state.tabs[0].title).toBe(longTitle);
        });
    });
});
