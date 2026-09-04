import {createContext} from '@lit/context';
import type {WindowState, WindowStateActions} from '../types/index.js';

/**
 * WindowState Context — tracks floating window position, size, and mode.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-title-bar>, <rtc-content-wrapper>
 *
 * State shape: WindowState (mode, position, size, lastState)
 * Actions: WindowStateActions (setMode, setPosition, setSize, maximize, minimize, restore)
 */
export interface WindowStateContextValue {
    state: WindowState;
    actions: WindowStateActions;
}

export const WindowStateContext = createContext<WindowStateContextValue>(
    Symbol('window-state-context')
);

/** Default window state — centered, normal mode, 420×640. */
export const DEFAULT_WINDOW_STATE: WindowState = {
    mode: 'normal',
    position: {x: 100, y: 100},
    size: {width: 420, height: 640},
};
