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

import { createLogger } from '@rtc-agent/protocol';
import type { ReactiveControllerHost } from 'lit';
import { STORAGE_KEYS } from '../config/auth.js';
import type { ModeContextValue } from '../contexts/mode.js';
import { DEFAULT_MODE_STATE } from '../contexts/mode.js';
import { CachedContextController } from '../core/cached-context.controller.js';
import type { Mode, ModeActions, ModeState } from '../types/index.js';

const log = createLogger('ModeController');

/** Valid mode values for validation of localStorage data */
const VALID_MODES: ReadonlySet<string> = new Set([
  'manual',
  'edit',
  'plan',
  'auto',
  'bypass',
]);

function isValidMode(value: string): value is Mode {
  return VALID_MODES.has(value);
}

export class ModeController extends CachedContextController<
  ModeState,
  ModeActions
> {
  constructor(host: ReactiveControllerHost) {
    // Initialize with default state and actions
    const actions: ModeActions = {
      setMode: (mode: Mode) => this._setMode(mode),
    };

    // Restore mode from localStorage before calling super
    const initialState = ModeController._restoreModeFromStorage();

    super(host, initialState, actions, log);
  }

  /** Restore mode from localStorage */
  private static _restoreModeFromStorage(): ModeState {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.mode);
      if (stored && isValidMode(stored)) {
        return { currentMode: stored };
      }
    } catch (e) {
      // localStorage may be unavailable
      log.debug('Failed to restore mode:', e);
    }
    return { ...DEFAULT_MODE_STATE };
  }

  /** Override value getter to return ModeContextValue type */
  get value(): ModeContextValue {
    return super.value as ModeContextValue;
  }

  private _setMode(mode: Mode) {
    log.debug('Setting mode:', mode);
    this._setState({ currentMode: mode });
    this.host.requestUpdate();

    // Persist to localStorage
    try {
      localStorage.setItem(STORAGE_KEYS.mode, mode);
    } catch (e) {
      // localStorage may be unavailable
      log.debug('Failed to persist mode:', e);
    }
  }
}
