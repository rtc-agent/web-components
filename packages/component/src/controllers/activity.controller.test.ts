import {describe, it, expect, beforeEach} from 'vitest';
import {ActivityController} from './activity.controller.js';
import {STORAGE_KEYS} from '../config/auth.js';
import {DEFAULT_ACTIVITY_STATE} from '../contexts/activity.js';

class MockHost {
    updateCount = 0;
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('ActivityController', () => {
    let host: MockHost;
    let ctrl: ActivityController;

    beforeEach(() => {
        localStorage.clear();
        host = new MockHost();
        ctrl = new ActivityController(host as any);
    });

    describe('initial state', () => {
        it('should have default activity "chat"', () => {
            expect(ctrl.active).toBe('chat');
        });

        it('should have default sidebarVisible true', () => {
            expect(ctrl.sidebarVisible).toBe(true);
        });

        it('should expose actions object', () => {
            expect(ctrl.actions).toBeDefined();
            expect(typeof ctrl.actions.setActivity).toBe('function');
            expect(typeof ctrl.actions.showSidebar).toBe('function');
            expect(typeof ctrl.actions.hideSidebar).toBe('function');
            expect(typeof ctrl.actions.toggleSidebar).toBe('function');
            expect(typeof ctrl.actions.reset).toBe('function');
        });

        it('should have correct value structure', () => {
            const value = ctrl.value;
            expect(value.state).toBeDefined();
            expect(value.actions).toBeDefined();
            expect(value.state.active).toBe('chat');
            expect(value.state.sidebarVisible).toBe(true);
        });
    });

    describe('setActivity', () => {
        it('should switch to different activity', () => {
            ctrl.actions.setActivity('files');
            expect(ctrl.active).toBe('files');
        });

        it('should toggle sidebar when clicking current activity', () => {
            expect(ctrl.sidebarVisible).toBe(true);
            ctrl.actions.setActivity('chat'); // Current activity
            expect(ctrl.sidebarVisible).toBe(false);

            ctrl.actions.setActivity('chat'); // Current activity again
            expect(ctrl.sidebarVisible).toBe(true);
        });

        it('should switch to settings', () => {
            ctrl.actions.setActivity('settings');
            expect(ctrl.active).toBe('settings');
        });

        it('should preserve sidebarVisible when switching activities', () => {
            ctrl.actions.hideSidebar();
            expect(ctrl.sidebarVisible).toBe(false);

            ctrl.actions.setActivity('files');
            expect(ctrl.active).toBe('files');
            expect(ctrl.sidebarVisible).toBe(false);
        });

        it('should request host update on activity change', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.setActivity('files');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });

        it('should request host update on sidebar toggle', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.setActivity('chat'); // Toggles sidebar
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('showSidebar', () => {
        it('should show sidebar when hidden', () => {
            ctrl.actions.hideSidebar();
            expect(ctrl.sidebarVisible).toBe(false);

            ctrl.actions.showSidebar();
            expect(ctrl.sidebarVisible).toBe(true);
        });

        it('should do nothing when already visible', () => {
            expect(ctrl.sidebarVisible).toBe(true);
            const updatesBefore = host.updateCount;
            ctrl.actions.showSidebar();
            expect(host.updateCount).toBe(updatesBefore);
        });

        it('should request host update when showing', () => {
            ctrl.actions.hideSidebar();
            const updatesBefore = host.updateCount;
            ctrl.actions.showSidebar();
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('hideSidebar', () => {
        it('should hide sidebar when visible', () => {
            expect(ctrl.sidebarVisible).toBe(true);
            ctrl.actions.hideSidebar();
            expect(ctrl.sidebarVisible).toBe(false);
        });

        it('should do nothing when already hidden', () => {
            ctrl.actions.hideSidebar();
            const updatesBefore = host.updateCount;
            ctrl.actions.hideSidebar();
            expect(host.updateCount).toBe(updatesBefore);
        });

        it('should request host update when hiding', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.hideSidebar();
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('toggleSidebar', () => {
        it('should toggle from visible to hidden', () => {
            expect(ctrl.sidebarVisible).toBe(true);
            ctrl.actions.toggleSidebar();
            expect(ctrl.sidebarVisible).toBe(false);
        });

        it('should toggle from hidden to visible', () => {
            ctrl.actions.hideSidebar();
            ctrl.actions.toggleSidebar();
            expect(ctrl.sidebarVisible).toBe(true);
        });

        it('should request host update', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.toggleSidebar();
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('reset', () => {
        it('should reset to default state', () => {
            ctrl.actions.setActivity('files');
            ctrl.actions.hideSidebar();

            ctrl.actions.reset();

            expect(ctrl.active).toBe(DEFAULT_ACTIVITY_STATE.active);
            expect(ctrl.sidebarVisible).toBe(DEFAULT_ACTIVITY_STATE.sidebarVisible);
        });

        it('should request host update', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.reset();
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('persistence', () => {
        it('should persist state to localStorage', () => {
            ctrl.actions.setActivity('files');
            ctrl.actions.hideSidebar();

            const stored = localStorage.getItem(STORAGE_KEYS.activityBar);
            expect(stored).toBeDefined();

            const data = JSON.parse(stored!);
            expect(data.active).toBe('files');
            expect(data.sidebarVisible).toBe(false);
        });

        it('should persist on activity change', () => {
            ctrl.actions.setActivity('settings');
            const stored = localStorage.getItem(STORAGE_KEYS.activityBar);
            const data = JSON.parse(stored!);
            expect(data.active).toBe('settings');
        });

        it('should persist on sidebar toggle', () => {
            ctrl.actions.hideSidebar();
            const stored = localStorage.getItem(STORAGE_KEYS.activityBar);
            const data = JSON.parse(stored!);
            expect(data.sidebarVisible).toBe(false);
        });

        it('should restore state on construction', () => {
            const savedData = {active: 'files', sidebarVisible: false};
            localStorage.setItem(STORAGE_KEYS.activityBar, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new ActivityController(newHost as any);

            expect(newCtrl.active).toBe('files');
            expect(newCtrl.sidebarVisible).toBe(false);
        });

        it('should handle corrupted localStorage data', () => {
            localStorage.setItem(STORAGE_KEYS.activityBar, 'not-json');
            const newHost = new MockHost();
            const newCtrl = new ActivityController(newHost as any);

            expect(newCtrl.active).toBe('chat');
            expect(newCtrl.sidebarVisible).toBe(true);
        });

        it('should handle invalid activity value', () => {
            const savedData = {active: 'invalid-activity', sidebarVisible: true};
            localStorage.setItem(STORAGE_KEYS.activityBar, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new ActivityController(newHost as any);

            expect(newCtrl.active).toBe('chat'); // Falls back to default
        });

        it('should handle invalid sidebarVisible value', () => {
            const savedData = {active: 'files', sidebarVisible: 'not-boolean'};
            localStorage.setItem(STORAGE_KEYS.activityBar, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new ActivityController(newHost as any);

            expect(newCtrl.sidebarVisible).toBe(true); // Falls back to default
        });
    });

    describe('activity types', () => {
        it('should support "files" activity', () => {
            ctrl.actions.setActivity('files');
            expect(ctrl.active).toBe('files');
        });

        it('should support "chat" activity', () => {
            ctrl.actions.setActivity('files');
            ctrl.actions.setActivity('chat');
            expect(ctrl.active).toBe('chat');
        });

        it('should support "settings" activity', () => {
            ctrl.actions.setActivity('settings');
            expect(ctrl.active).toBe('settings');
        });
    });

    describe('edge cases', () => {
        it('should handle rapid activity changes', () => {
            const activities: Array<'files' | 'chat' | 'settings'> = ['files', 'chat', 'settings', 'files', 'chat'];
            for (const activity of activities) {
                ctrl.actions.setActivity(activity);
            }
            expect(ctrl.active).toBe('chat');
        });

        it('should handle rapid sidebar toggles', () => {
            for (let i = 0; i < 10; i++) {
                ctrl.actions.toggleSidebar();
            }
            // After even number of toggles, should be back to initial state
            expect(ctrl.sidebarVisible).toBe(true);
        });

        it('should maintain state consistency across operations', () => {
            ctrl.actions.setActivity('files');
            ctrl.actions.hideSidebar();
            ctrl.actions.setActivity('settings');
            ctrl.actions.showSidebar();
            ctrl.actions.setActivity('chat');

            expect(ctrl.active).toBe('chat');
            expect(ctrl.sidebarVisible).toBe(true);
        });
    });

    describe('readonly accessors', () => {
        it('should provide readonly active accessor', () => {
            ctrl.actions.setActivity('files');
            expect(ctrl.active).toBe('files');
        });

        it('should provide readonly sidebarVisible accessor', () => {
            ctrl.actions.hideSidebar();
            expect(ctrl.sidebarVisible).toBe(false);
        });
    });

    describe('value getter', () => {
        it('should return complete context value', () => {
            const value = ctrl.value;
            expect(value).toHaveProperty('state');
            expect(value).toHaveProperty('actions');
            expect(value.state).toHaveProperty('active');
            expect(value.state).toHaveProperty('sidebarVisible');
        });

        it('should reflect current state', () => {
            ctrl.actions.setActivity('files');
            const value = ctrl.value;
            expect(value.state.active).toBe('files');
        });
    });
});
