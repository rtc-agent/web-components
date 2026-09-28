import {createContext} from '@lit/context';
import type {FileNode} from '../types/index.js';

/**
 * File Explorer Context — File tree state management.
 *
 * Manages file browser state in a VS Code-style layout: expand/collapse, selection, loading state.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-file-tree-item>, <rtc-file-explorer>
 */
export interface FileExplorerState {
    /** File tree root node */
    root: FileNode | null;
    /** Currently selected path */
    selectedPath: string | null;
}

export interface FileExplorerActions {
    /** Set the root node (called after loading from VFS) */
    setRoot(root: FileNode): void;
    /** Toggle node expand/collapse */
    toggleNode(path: string): void;
    /** Expand all nodes */
    expandAll(): void;
    /** Collapse all nodes */
    collapseAll(): void;
    /** Select a node */
    selectNode(path: string): void;
    /** Set node loading state */
    setLoading(path: string, loading: boolean): void;
    /** Update node children (called after lazy loading) */
    updateChildren(path: string, children: FileNode[]): void;
    /** Reset state */
    reset(): void;
}

export interface FileExplorerContextValue {
    state: FileExplorerState;
    actions: FileExplorerActions;
    /** Query whether a node is expanded */
    isExpanded(path: string): boolean;
    /** Query whether a node is loading */
    isLoading(path: string): boolean;
    /** Query whether a node is selected */
    isSelected(path: string): boolean;
}

export const FileExplorerContext = createContext<FileExplorerContextValue>(
    Symbol('file-explorer-context')
);

export const DEFAULT_FILE_EXPLORER_STATE: FileExplorerState = {
    root: null,
    selectedPath: null,
};
