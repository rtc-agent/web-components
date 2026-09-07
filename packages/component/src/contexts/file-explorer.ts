import {createContext} from '@lit/context';
import type {FileNode} from '../types/index.js';

/**
 * File Explorer Context — 文件树状态管理。
 *
 * 管理 VS Code 风格布局中的文件浏览器状态：展开/折叠、选中、加载状态。
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-file-tree-item>, <rtc-file-explorer>
 */
export interface FileExplorerState {
    /** 文件树根节点 */
    root: FileNode | null;
    /** 当前选中路径 */
    selectedPath: string | null;
}

export interface FileExplorerActions {
    /** 设置根节点（从 VFS 加载后调用） */
    setRoot(root: FileNode): void;
    /** Toggle 节点展开/折叠 */
    toggleNode(path: string): void;
    /** 展开所有节点 */
    expandAll(): void;
    /** 折叠所有节点 */
    collapseAll(): void;
    /** 选中节点 */
    selectNode(path: string): void;
    /** 设置节点加载状态 */
    setLoading(path: string, loading: boolean): void;
    /** 更新节点子项（懒加载后调用） */
    updateChildren(path: string, children: FileNode[]): void;
    /** 重置状态 */
    reset(): void;
}

export interface FileExplorerContextValue {
    state: FileExplorerState;
    actions: FileExplorerActions;
    /** 查询节点是否展开 */
    isExpanded(path: string): boolean;
    /** 查询节点是否正在加载 */
    isLoading(path: string): boolean;
    /** 查询节点是否选中 */
    isSelected(path: string): boolean;
}

export const FileExplorerContext = createContext<FileExplorerContextValue>(
    Symbol('file-explorer-context')
);

export const DEFAULT_FILE_EXPLORER_STATE: FileExplorerState = {
    root: null,
    selectedPath: null,
};
