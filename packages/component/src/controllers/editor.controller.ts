/**
 * Editor Controller
 *
 * 管理编辑器状态：视图模式、工具栏按钮可用性。
 *
 * Phase 2.5 仅实现工具栏相关状态；标签页管理（openTabs / activeFile）
 * 留给 Phase 2.7。
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

    constructor(host: ReactiveControllerHost) {
        this._host = host;
        host.addController(this);
    }

    /* ── Public Getters ── */

    get state(): EditorState {
        return this._state;
    }

    get value(): EditorContextValue {
        return {
            state: this._state,
            actions: this.actions,
        };
    }

    get actions(): EditorActions {
        return {
            setViewMode: (mode: EditorViewMode) => this._setViewMode(mode),
            setCanSave: (value: boolean) => this._setCanSave(value),
            setCanUndo: (value: boolean) => this._setCanUndo(value),
            setCanRedo: (value: boolean) => this._setCanRedo(value),
            reset: () => this._reset(),
        };
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
