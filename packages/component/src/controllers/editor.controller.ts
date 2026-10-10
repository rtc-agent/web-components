/**
 * Editor Controller
 *
 * Manages editor state: view mode, toolbar button availability.
 *
 * Phase 2.5 only implements toolbar-related state; tab management (openTabs / activeFile)
 * is deferred to Phase 2.7.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-editor-toolbar>, <rtc-editor-area>
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {EditorViewMode} from '../types/index.js';
import {
    type EditorState,
    type EditorActions,
    type EditorContextValue,
    DEFAULT_EDITOR_STATE,
} from '../contexts/editor.js';

export class EditorController implements ReactiveController {
    private _host: ReactiveControllerHost;
    private _state: EditorState = {...DEFAULT_EDITOR_STATE};

    /**
     * CRITICAL FIX: Value cache to prevent unnecessary Context consumer re-renders.
     * @lit/context uses `===` comparison, so creating new objects every time triggers
     * consumers even when the state hasn't changed. Cache the value object and only
     * recreate when state reference changes.
     */
    private _cachedValue?: EditorContextValue;
    private _cachedState?: EditorState;

    /** Cached actions object to prevent unnecessary re-renders */
    private _cachedActions?: EditorActions;

    constructor(host: ReactiveControllerHost) {
        this._host = host;
        host.addController(this);
    }

    /* ── Public Getters ── */

    get state(): EditorState {
        return this._state;
    }

    get value(): EditorContextValue {
        // Only create new value object if state reference changed
        if (this._cachedValue && this._cachedState === this._state) {
            return this._cachedValue;
        }
        this._cachedState = this._state;
        this._cachedValue = {
            state: this._state,
            actions: this.actions,
        };
        return this._cachedValue;
    }

    get actions(): EditorActions {
        if (this._cachedActions) {
            return this._cachedActions;
        }
        this._cachedActions = {
            setViewMode: (mode: EditorViewMode) => this._setViewMode(mode),
            setCanSave: (value: boolean) => this._setCanSave(value),
            setCanUndo: (value: boolean) => this._setCanUndo(value),
            setCanRedo: (value: boolean) => this._setCanRedo(value),
            reset: () => this._reset(),
        };
        return this._cachedActions;
    }

    /* ── Reactive Controller Lifecycle ── */

    hostConnected() {
        // No-op: state is initialized in constructor
    }

    hostDisconnected() {
        this._reset();
    }

    /* ── Actions ── */

    private _setViewMode(mode: EditorViewMode) {
        if (this._state.viewMode === mode) return;
        this._state = {...this._state, viewMode: mode};
        this._host.requestUpdate();
    }

    private _setCanSave(value: boolean) {
        if (this._state.canSave === value) return;
        this._state = {...this._state, canSave: value};
        this._host.requestUpdate();
    }

    private _setCanUndo(value: boolean) {
        if (this._state.canUndo === value) return;
        this._state = {...this._state, canUndo: value};
        this._host.requestUpdate();
    }

    private _setCanRedo(value: boolean) {
        if (this._state.canRedo === value) return;
        this._state = {...this._state, canRedo: value};
        this._host.requestUpdate();
    }

    private _reset() {
        this._state = {...DEFAULT_EDITOR_STATE};
        this._host.requestUpdate();
    }
}
