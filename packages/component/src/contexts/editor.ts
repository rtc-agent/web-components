import {createContext} from '@lit/context';
import type {EditorViewMode} from '../types/index.js';

/**
 * Editor Context — 编辑器状态管理。
 *
 * 管理 VS Code 风格布局中的编辑器状态：工具栏可用性、视图模式、
 * 打开的标签页、当前活动文件。
 *
 * Phase 2.5 仅实现工具栏相关状态；标签页管理留给 Phase 2.7。
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-editor-toolbar>, <rtc-editor-area>
 */
export interface EditorState {
    /** 当前视图模式 */
    viewMode: EditorViewMode;
    /** 保存按钮是否可用 */
    canSave: boolean;
    /** 撤销按钮是否可用 */
    canUndo: boolean;
    /** 重做按钮是否可用 */
    canRedo: boolean;
}

export interface EditorActions {
    /** 设置视图模式 */
    setViewMode(mode: EditorViewMode): void;
    /** 设置保存可用性 */
    setCanSave(value: boolean): void;
    /** 设置撤销可用性 */
    setCanUndo(value: boolean): void;
    /** 设置重做可用性 */
    setCanRedo(value: boolean): void;
    /** 重置状态 */
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
