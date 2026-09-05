/**
 * Mode Controller
 *
 * Encapsulates AI working mode state. Supports 5 modes:
 * manual, edit, plan, auto, bypass.
 *
 * Corresponds to: `modeContext` (defined in `contexts/mode.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-input-area>`, `<rtc-mode-panel>`
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Mode, ModeState, ModeActions} from '../types/index.js';
import type {ModeContextValue} from '../contexts/mode.js';
import {DEFAULT_MODE_STATE} from '../contexts/mode.js';
import {STORAGE_KEYS} from '../config/auth.js';

/** Valid mode values for validation of localStorage data */
const VALID_MODES: ReadonlySet<string> = new Set(['manual', 'edit', 'plan', 'auto', 'bypass']);

function isValidMode(value: string): value is Mode {
    return VALID_MODES.has(value);
}

export class ModeController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: ModeState = {...DEFAULT_MODE_STATE};

    readonly actions: ModeActions;

    get value(): ModeContextValue {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            setMode: (mode: Mode) => this._setMode(mode),
        };

        // Restore mode from localStorage
        this._restoreMode();
    }

    hostConnected() {}
    hostDisconnected() {}

    /** Restore mode from localStorage */
    private _restoreMode() {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.mode);
            if (stored && isValidMode(stored)) {
                this._state = {currentMode: stored};
            }
        } catch {
            // localStorage may be unavailable
        }
    }

    private _setMode(mode: Mode) {
        this._state = {currentMode: mode};
        this.host.requestUpdate();

        // Persist to localStorage
        try {
            localStorage.setItem(STORAGE_KEYS.mode, mode);
        } catch {
            // localStorage may be unavailable
        }
    }
}
