import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {SettingsController} from './settings.controller.js';
import {STORAGE_KEYS} from '../config/auth.js';
import {DEFAULT_SETTINGS_STATE} from '../contexts/settings.js';

class MockHost {
    updateCount = 0;
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
    closest(_selector: string) { return null; }
    hasAttribute(_name: string) { return false; }
}

describe('SettingsController', () => {
    let host: MockHost;
    let ctrl: SettingsController;

    beforeEach(() => {
        localStorage.clear();
        host = new MockHost();
        // Mock document.documentElement.style
        vi.spyOn(document.documentElement.style, 'setProperty');
        vi.spyOn(document.documentElement.style, 'removeProperty');
        ctrl = new SettingsController(host as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('initial state', () => {
        it('should have default settings', () => {
            const value = ctrl.value;
            expect(value.state.appearance.theme).toBe(DEFAULT_SETTINGS_STATE.appearance.theme);
            expect(value.state.appearance.fontSize).toBe(DEFAULT_SETTINGS_STATE.appearance.fontSize);
        });

        it('should expose actions object', () => {
            expect(ctrl.actions).toBeDefined();
            expect(typeof ctrl.actions.updateAppearance).toBe('function');
            expect(typeof ctrl.actions.updateChat).toBe('function');
            expect(typeof ctrl.actions.updateFiles).toBe('function');
            expect(typeof ctrl.actions.updateNotifications).toBe('function');
            expect(typeof ctrl.actions.resetAll).toBe('function');
        });

        it('should have correct value structure', () => {
            const value = ctrl.value;
            expect(value.state).toBeDefined();
            expect(value.actions).toBeDefined();
        });
    });

    describe('updateAppearance', () => {
        it('should update theme', () => {
            ctrl.actions.updateAppearance({theme: 'dark'});
            expect(ctrl.value.state.appearance.theme).toBe('dark');
        });

        it('should update fontSize', () => {
            ctrl.actions.updateAppearance({fontSize: 16});
            expect(ctrl.value.state.appearance.fontSize).toBe(16);
        });

        it('should update multiple appearance properties', () => {
            ctrl.actions.updateAppearance({theme: 'dark', fontSize: 18});
            expect(ctrl.value.state.appearance.theme).toBe('dark');
            expect(ctrl.value.state.appearance.fontSize).toBe(18);
        });

        it('should preserve other appearance properties', () => {
            ctrl.actions.updateAppearance({theme: 'dark'});
            ctrl.actions.updateAppearance({fontSize: 20});
            expect(ctrl.value.state.appearance.theme).toBe('dark');
            expect(ctrl.value.state.appearance.fontSize).toBe(20);
        });

        it('should request host update', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.updateAppearance({theme: 'dark'});
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('updateChat', () => {
        it('should update chat settings', () => {
            ctrl.actions.updateChat({sendShortcut: 'Ctrl+Enter'});
            expect(ctrl.value.state.chat.sendShortcut).toBe('Ctrl+Enter');
        });

        it('should preserve other chat properties', () => {
            const originalSettings = {...ctrl.value.state.chat};
            ctrl.actions.updateChat({density: 'compact'});
            expect(ctrl.value.state.chat).toMatchObject({
                ...originalSettings,
                density: 'compact',
            });
        });
    });

    describe('updateFiles', () => {
        it('should update files settings', () => {
            ctrl.actions.updateFiles({autoSave: false});
            expect(ctrl.value.state.files.autoSave).toBe(false);
        });
    });

    describe('updateNotifications', () => {
        it('should update notification settings', () => {
            ctrl.actions.updateNotifications({soundEnabled: false});
            expect(ctrl.value.state.notifications.soundEnabled).toBe(false);
        });
    });

    describe('resetAll', () => {
        it('should reset to default state', () => {
            ctrl.actions.updateAppearance({theme: 'dark', fontSize: 20});
            ctrl.actions.updateChat({sendShortcut: 'Ctrl+Enter'});

            ctrl.actions.resetAll();

            expect(ctrl.value.state.appearance.theme).toBe(DEFAULT_SETTINGS_STATE.appearance.theme);
            expect(ctrl.value.state.appearance.fontSize).toBe(DEFAULT_SETTINGS_STATE.appearance.fontSize);
            expect(ctrl.value.state.chat).toEqual(DEFAULT_SETTINGS_STATE.chat);
        });

        it('should request host update', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.resetAll();
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('theme validation', () => {
        it('should accept "light" theme', () => {
            ctrl.actions.updateAppearance({theme: 'light'});
            expect(ctrl.value.state.appearance.theme).toBe('light');
        });

        it('should accept "dark" theme', () => {
            ctrl.actions.updateAppearance({theme: 'dark'});
            expect(ctrl.value.state.appearance.theme).toBe('dark');
        });

        it('should accept "system" theme', () => {
            ctrl.actions.updateAppearance({theme: 'system'});
            expect(ctrl.value.state.appearance.theme).toBe('system');
        });

        it('should validate theme on restore from storage', () => {
            const savedData = {appearance: {theme: 'invalid', fontSize: 14}};
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);

            // Invalid theme is replaced with default during restore
            expect(newCtrl.value.state.appearance.theme).toBe(DEFAULT_SETTINGS_STATE.appearance.theme);
        });
    });

    describe('fontSize validation', () => {
        it('should accept valid fontSize', () => {
            ctrl.actions.updateAppearance({fontSize: 16});
            expect(ctrl.value.state.appearance.fontSize).toBe(16);
        });

        it('should clamp fontSize to minimum on restore', () => {
            const savedData = {appearance: {theme: 'light', fontSize: 8}};
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);

            expect(newCtrl.value.state.appearance.fontSize).toBe(12);
        });

        it('should clamp fontSize to maximum on restore', () => {
            const savedData = {appearance: {theme: 'light', fontSize: 30}};
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);

            expect(newCtrl.value.state.appearance.fontSize).toBe(24);
        });

        it('should accept boundary values', () => {
            ctrl.actions.updateAppearance({fontSize: 12});
            expect(ctrl.value.state.appearance.fontSize).toBe(12);

            ctrl.actions.updateAppearance({fontSize: 24});
            expect(ctrl.value.state.appearance.fontSize).toBe(24);
        });
    });

    describe('persistence', () => {
        it('should persist state to localStorage', () => {
            ctrl.actions.updateAppearance({theme: 'dark', fontSize: 18});
            const stored = localStorage.getItem(STORAGE_KEYS.settings);
            expect(stored).toBeDefined();

            const data = JSON.parse(stored!);
            expect(data.appearance.theme).toBe('dark');
            expect(data.appearance.fontSize).toBe(18);
        });

        it('should persist on any update', () => {
            ctrl.actions.updateChat({sendShortcut: 'Ctrl+Enter'});
            const stored = localStorage.getItem(STORAGE_KEYS.settings);
            const data = JSON.parse(stored!);
            expect(data.chat.sendShortcut).toBe('Ctrl+Enter');
        });

        it('should restore state on construction', () => {
            const savedData = {
                appearance: {theme: 'dark', fontSize: 18},
                chat: {sendShortcut: 'Ctrl+Enter'},
                files: {},
                notifications: {},
            };
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);

            expect(newCtrl.value.state.appearance.theme).toBe('dark');
            expect(newCtrl.value.state.appearance.fontSize).toBe(18);
            expect(newCtrl.value.state.chat.sendShortcut).toBe('Ctrl+Enter');
        });

        it('should handle corrupted localStorage data', () => {
            localStorage.setItem(STORAGE_KEYS.settings, 'not-json');
            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);

            expect(newCtrl.value.state.appearance.theme).toBe(DEFAULT_SETTINGS_STATE.appearance.theme);
        });

        it('should handle missing fields in stored data', () => {
            const savedData = {appearance: {theme: 'dark'}}; // Missing fontSize
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);

            expect(newCtrl.value.state.appearance.theme).toBe('dark');
            expect(newCtrl.value.state.appearance.fontSize).toBe(DEFAULT_SETTINGS_STATE.appearance.fontSize);
        });

        it('should validate restored theme value', () => {
            const savedData = {appearance: {theme: 'invalid'}};
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);

            expect(newCtrl.value.state.appearance.theme).toBe(DEFAULT_SETTINGS_STATE.appearance.theme);
        });

        it('should clamp restored fontSize value', () => {
            const savedData = {appearance: {theme: 'light', fontSize: 100}};
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(savedData));

            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);

            expect(newCtrl.value.state.appearance.fontSize).toBe(24);
        });
    });

    describe('DOM side effects', () => {
        it('should apply font size to document root', () => {
            ctrl.actions.updateAppearance({fontSize: 18});
            expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
                '--rtc-font-size-user',
                '18px'
            );
        });

        it('should clamp font size before applying', () => {
            ctrl.actions.updateAppearance({fontSize: 30});
            expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
                '--rtc-font-size-user',
                '24px'
            );
        });
    });

    describe('hostConnected', () => {
        it('should apply initial settings to DOM', () => {
            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);
            newCtrl.hostConnected();

            // Should have called setProperty for font size
            expect(document.documentElement.style.setProperty).toHaveBeenCalled();
        });

        it('should listen for storage events', () => {
            const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);
            newCtrl.hostConnected();

            expect(addEventListenerSpy).toHaveBeenCalledWith('storage', expect.any(Function));
            addEventListenerSpy.mockRestore();
        });

        it('should listen for system theme changes', () => {
            const matchMediaSpy = vi.spyOn(window, 'matchMedia');
            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);
            newCtrl.hostConnected();

            expect(matchMediaSpy).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
        });
    });

    describe('hostDisconnected', () => {
        it('should cleanup storage event listener', () => {
            const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);
            newCtrl.hostConnected();
            newCtrl.hostDisconnected();

            expect(removeEventListenerSpy).toHaveBeenCalledWith('storage', expect.any(Function));
            removeEventListenerSpy.mockRestore();
        });

        it('should cleanup font size CSS variable', () => {
            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);
            newCtrl.hostConnected();
            newCtrl.hostDisconnected();

            expect(document.documentElement.style.removeProperty).toHaveBeenCalledWith('--rtc-font-size-user');
        });
    });

    describe('multi-tab synchronization', () => {
        it('should update state on storage event', () => {
            const newHost = new MockHost();
            const newCtrl = new SettingsController(newHost as any);
            newCtrl.hostConnected();

            // Simulate storage event from another tab
            const savedData = {
                appearance: {theme: 'dark', fontSize: 20},
                chat: {},
                files: {},
                notifications: {},
            };
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(savedData));

            const storageEvent = new StorageEvent('storage', {
                key: STORAGE_KEYS.settings,
                newValue: JSON.stringify(savedData),
            });
            window.dispatchEvent(storageEvent);

            expect(newCtrl.value.state.appearance.theme).toBe('dark');
            expect(newCtrl.value.state.appearance.fontSize).toBe(20);
        });
    });

    describe('edge cases', () => {
        it('should handle rapid updates', () => {
            for (let i = 0; i < 10; i++) {
                ctrl.actions.updateAppearance({fontSize: 12 + i});
            }
            expect(ctrl.value.state.appearance.fontSize).toBe(21);
        });

        it('should handle partial updates', () => {
            ctrl.actions.updateAppearance({theme: 'dark'});
            ctrl.actions.updateChat({sendShortcut: 'Ctrl+Enter'});
            ctrl.actions.updateFiles({autoSave: false});

            expect(ctrl.value.state.appearance.theme).toBe('dark');
            expect(ctrl.value.state.chat.sendShortcut).toBe('Ctrl+Enter');
            expect(ctrl.value.state.files.autoSave).toBe(false);
        });
    });

    describe('value getter', () => {
        it('should return complete context value', () => {
            const value = ctrl.value;
            expect(value).toHaveProperty('state');
            expect(value).toHaveProperty('actions');
            expect(value.state).toHaveProperty('appearance');
            expect(value.state).toHaveProperty('chat');
            expect(value.state).toHaveProperty('files');
            expect(value.state).toHaveProperty('notifications');
        });

        it('should reflect current state', () => {
            ctrl.actions.updateAppearance({theme: 'dark'});
            const value = ctrl.value;
            expect(value.state.appearance.theme).toBe('dark');
        });
    });
});
