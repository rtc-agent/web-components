/**
 * WindowState Controller
 *
 * Encapsulates floating-window state logic: mode, position, size, and restore.
 * Extracted from <rtc-agent> root component to keep it under 300 lines.
 *
 * Corresponds to: `windowStateContext` (defined in `contexts/window-state.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-title-bar>`, `<rtc-content-wrapper>`
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {
    WindowState,
    WindowStateActions,
    WindowMode,
} from '../types/index.js';
import type {WindowStateContextValue} from '../contexts/window-state.js';
import {DEFAULT_WINDOW_STATE} from '../contexts/window-state.js';

export class WindowStateController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: WindowState = {...DEFAULT_WINDOW_STATE};

    readonly actions: WindowStateActions;

    get value(): WindowStateContextValue {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            setMode: (mode: WindowMode) => this._setMode(mode),
            setPosition: (pos) => this._updateState({position: pos}),
            setSize: (size) => this._updateState({size}),
            maximize: () => this._setMode('maximized'),
            minimize: () => this._setMode('minimized'),
            restore: () => this._setMode('normal'),
        };
    }

    hostConnected() {}
    hostDisconnected() {}

    private _setMode(mode: WindowMode) {
        const current = this._state;
        const lastState =
            mode !== 'normal'
                ? {position: {...current.position}, size: {...current.size}}
                : current.lastState;

        this._state = {...current, mode, lastState};
        this.host.requestUpdate();
    }

    private _updateState(partial: Partial<WindowState>) {
        this._state = {...this._state, ...partial};
        this.host.requestUpdate();
    }
}
