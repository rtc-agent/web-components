import {createContext} from '@lit/context';

/**
 * Settings Context — 全局设置状态和操作
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-settings-layout>, 各功能组件
 */

export interface SettingsState {
    appearance: {
        theme: 'light' | 'dark' | 'system';
        fontSize: number;
    };
    chat: {
        sendShortcut: 'Enter' | 'Ctrl+Enter';
        density: 'compact' | 'comfortable';
    };
    files: {
        autoSave: boolean;
        defaultViewMode: 'edit' | 'preview' | 'split';
    };
    notifications: {
        soundEnabled: boolean;
        toastEnabled: boolean;
    };
}

export interface SettingsActions {
    updateAppearance(partial: Partial<SettingsState['appearance']>): void;
    updateChat(partial: Partial<SettingsState['chat']>): void;
    updateFiles(partial: Partial<SettingsState['files']>): void;
    updateNotifications(partial: Partial<SettingsState['notifications']>): void;
    resetAll(): void;
}

export interface SettingsContextValue {
    state: SettingsState;
    actions: SettingsActions;
}

export const SettingsContext = createContext<SettingsContextValue>(
    Symbol('settings-context')
);

export const DEFAULT_SETTINGS_STATE: SettingsState = {
    appearance: {theme: 'system', fontSize: 14},
    chat: {sendShortcut: 'Enter', density: 'comfortable'},
    files: {autoSave: true, defaultViewMode: 'split'},
    notifications: {soundEnabled: true, toastEnabled: true},
};
