/**
 * Settings Controller
 *
 * Encapsulates global settings state with localStorage persistence.
 * Handles DOM side effects (theme, fontSize) and multi-tab synchronization.
 * Follows the same pattern as ModeController.
 *
 * Corresponds to: `SettingsContext` (defined in `contexts/settings.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-settings-layout>`, 各功能组件
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {
    SettingsState,
    SettingsActions,
    SettingsContextValue,
} from '../contexts/settings.js';
import {DEFAULT_SETTINGS_STATE} from '../contexts/settings.js';
import {STORAGE_KEYS} from '../config/auth.js';

export class SettingsController implements ReactiveController {
    host: ReactiveControllerHost & HTMLElement;

    private _state: SettingsState = {...DEFAULT_SETTINGS_STATE};

    readonly actions: SettingsActions;

    private _storageListener?: () => void;
    private _themeMediaQuery?: MediaQueryList;
    private _themeMediaListener?: () => void;

    get value(): SettingsContextValue {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost & HTMLElement) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            updateAppearance: (p) => this._update('appearance', p),
            updateChat: (p) => this._update('chat', p),
            updateFiles: (p) => this._update('files', p),
            updateNotifications: (p) => this._update('notifications', p),
            resetAll: () => this._reset(),
        };

        // Restore settings from localStorage
        this._restore();
    }

    hostConnected() {
        // Check if the user explicitly set the theme attribute before applying settings
        const rtcAgent = this.host.closest('rtc-agent') || this.host;
        const userSetTheme = rtcAgent.hasAttribute('theme');

        // Apply initial settings to DOM (skip theme if user set it explicitly)
        if (!userSetTheme) {
            this._applyTheme();
        }
        this._applyFontSize();

        // Listen for multi-tab synchronization
        this._storageListener = () => this._handleStorageChange();
        window.addEventListener('storage', this._storageListener);

        // Listen for system theme changes
        this._themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this._themeMediaListener = () => {
            if (this._state.appearance.theme === 'system') {
                this._applyTheme();
            }
        };
        this._themeMediaQuery.addEventListener('change', this._themeMediaListener);
    }

    hostDisconnected() {
        if (this._storageListener) {
            window.removeEventListener('storage', this._storageListener);
        }
        if (this._themeMediaQuery && this._themeMediaListener) {
            this._themeMediaQuery.removeEventListener('change', this._themeMediaListener);
        }
        // Clean up font size override
        document.documentElement.style.removeProperty('--rtc-font-size-user');
    }

    /** Restore settings from localStorage with validation */
    private _restore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.settings);
            if (!raw) return;
            const saved = JSON.parse(raw);
            // 逐分组合并，保留默认值作为 fallback，并验证值域
            this._state = {
                appearance: {
                    theme: this._validateTheme(saved.appearance?.theme),
                    fontSize: this._validateFontSize(saved.appearance?.fontSize),
                },
                chat: {...DEFAULT_SETTINGS_STATE.chat, ...saved.chat},
                files: {...DEFAULT_SETTINGS_STATE.files, ...saved.files},
                notifications: {...DEFAULT_SETTINGS_STATE.notifications, ...saved.notifications},
            };
        } catch {
            // localStorage may be unavailable or data corrupted
        }
    }

    private _update<K extends keyof SettingsState>(
        group: K,
        partial: Partial<SettingsState[K]>
    ) {
        const oldState = this._state;
        this._state = {
            ...this._state,
            [group]: {...this._state[group], ...partial},
        };
        this._persist();

        // Apply DOM side effects incrementally
        this._applyDiff(oldState, this._state);
        this.host.requestUpdate();
    }

    private _reset() {
        const oldState = this._state;
        this._state = {...DEFAULT_SETTINGS_STATE};
        this._persist();
        this._applyDiff(oldState, this._state);
        this.host.requestUpdate();
    }

    /** Persist settings to localStorage */
    private _persist() {
        try {
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this._state));
        } catch {
            // localStorage may be unavailable
        }
    }

    /** Apply DOM side effects only for changed properties */
    private _applyDiff(oldState: SettingsState, newState: SettingsState) {
        if (oldState.appearance.theme !== newState.appearance.theme) {
            this._applyTheme();
        }
        if (oldState.appearance.fontSize !== newState.appearance.fontSize) {
            this._applyFontSize();
        }
        // chat/files/notifications changes don't require DOM operations
        // Consumer components handle these via context subscription
    }

    /** Apply theme to rtc-agent element's theme attribute */
    private _applyTheme() {
        const theme = this._state.appearance.theme;
        // Find rtc-agent element (host itself or closest ancestor)
        const rtcAgent = this.host.closest('rtc-agent') || this.host;
        if ('theme' in rtcAgent) {
            (rtcAgent as any).theme = theme;
        }
    }

    /** Apply font size as CSS variable on document root */
    private _applyFontSize() {
        const size = this._state.appearance.fontSize;
        const clamped = Math.min(24, Math.max(12, size));
        // Set on document root so it propagates through all shadow DOMs
        // tokens.ts defines --rtc-font-size-base as var(--rtc-font-size-user, 14px)
        // so setting --rtc-font-size-user overrides the base size globally
        document.documentElement.style.setProperty('--rtc-font-size-user', `${clamped}px`);
    }

    /** Handle multi-tab synchronization via storage event */
    private _handleStorageChange() {
        const oldState = this._state;
        this._restore();
        this._applyDiff(oldState, this._state);
        this.host.requestUpdate();
    }

    /** Validate theme value */
    private _validateTheme(value: unknown): 'light' | 'dark' | 'system' {
        if (value === 'light' || value === 'dark' || value === 'system') {
            return value;
        }
        return 'system';
    }

    /** Validate and clamp font size */
    private _validateFontSize(value: unknown): number {
        const num = typeof value === 'number' ? value : 14;
        return Math.min(24, Math.max(12, num));
    }
}
