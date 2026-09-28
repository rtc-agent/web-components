import {createContext} from '@lit/context';
import type {EditorViewMode} from '../types/index.js';

/**
 * Editor Context — Editor state management.
 *
 * Manages editor state in a VS Code-style layout: toolbar availability, view mode,
 * open tabs, and current active file.
 *
 * Phase 2.5 implements only toolbar-related state; tab management is deferred to Phase 2.7.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-editor-toolbar>, <rtc-editor-area>
 */
export interface EditorState {
    /** Current view mode */
    viewMode: EditorViewMode;
    /** Whether the save button is enabled */
    canSave: boolean;
    /** Whether the undo button is enabled */
    canUndo: boolean;
    /** Whether the redo button is enabled */
    canRedo: boolean;
}

export interface EditorActions {
    /** Set the view mode */
    setViewMode(mode: EditorViewMode): void;
    /** Set save availability */
    setCanSave(value: boolean): void;
    /** Set undo availability */
    setCanUndo(value: boolean): void;
    /** Set redo availability */
    setCanRedo(value: boolean): void;
    /** Reset state */
    reset(): void;
}

export interface EditorContextValue {
    state: EditorState;
    actions: EditorActions;
}

export const EditorContext = createContext<EditorContextValue>(
    Symbol('editor-context')
);

export const DEFAULT_EDITOR_STATE: EditorState = {
    viewMode: 'split',
    canSave: false,
    canUndo: false,
    canRedo: false,
};
