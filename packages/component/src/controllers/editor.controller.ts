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
import type { ReactiveControllerHost } from 'lit';
import type { EditorViewMode } from '../types/index.js';
import {
  type EditorState,
  type EditorActions,
  DEFAULT_EDITOR_STATE,
} from '../contexts/editor.js';
import { CachedContextController } from '../core/cached-context.controller.js';

export class EditorController extends CachedContextController<
  EditorState,
  EditorActions
> {
  constructor(host: ReactiveControllerHost) {
    const initialState = { ...DEFAULT_EDITOR_STATE };
    const actions: EditorActions = {
      setViewMode: (mode: EditorViewMode) => this._setViewMode(mode),
      setCanSave: (value: boolean) => this._setCanSave(value),
      setCanUndo: (value: boolean) => this._setCanUndo(value),
      setCanRedo: (value: boolean) => this._setCanRedo(value),
      reset: () => this._reset(),
    };
    super(host, initialState, actions);
  }

  /* ── Reactive Controller Lifecycle ── */

  hostDisconnected() {
    this._reset();
  }

  /* ── Actions ── */

  private _setViewMode(mode: EditorViewMode) {
    if (this._state.viewMode === mode) return;
    this._updateState({ viewMode: mode });
    this.host.requestUpdate();
  }

  private _setCanSave(value: boolean) {
    if (this._state.canSave === value) return;
    this._updateState({ canSave: value });
    this.host.requestUpdate();
  }

  private _setCanUndo(value: boolean) {
    if (this._state.canUndo === value) return;
    this._updateState({ canUndo: value });
    this.host.requestUpdate();
  }

  private _setCanRedo(value: boolean) {
    if (this._state.canRedo === value) return;
    this._updateState({ canRedo: value });
    this.host.requestUpdate();
  }

  private _reset() {
    this._setState({ ...DEFAULT_EDITOR_STATE });
    this.host.requestUpdate();
  }
}
