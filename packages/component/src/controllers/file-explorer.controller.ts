/**
 * File Explorer Controller
 *
 * Manages file tree state: expand/collapse, selection, loading state.
 *
 * State is stored inside the Controller (expandedPaths, loadingPaths),
 * rather than on FileNode objects, for easier batch operations (expandAll/collapseAll).
 *
 * Provided by: <rtc-agent> (root)
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {FileNode} from '../types/index.js';
import {
    type FileExplorerState,
    type FileExplorerActions,
    type FileExplorerContextValue,
    DEFAULT_FILE_EXPLORER_STATE,
} from '../contexts/file-explorer.js';

export class FileExplorerController implements ReactiveController {
    private _host: ReactiveControllerHost;
    private _state: FileExplorerState = {...DEFAULT_FILE_EXPLORER_STATE};
    private _expandedPaths = new Set<string>();
    private _loadingPaths = new Set<string>();

    constructor(host: ReactiveControllerHost) {
        this._host = host;
        host.addController(this);
    }

    /* ── Public Getters ── */

    get state(): FileExplorerState {
        return this._state;
    }

    get value(): FileExplorerContextValue {
        return {
            state: this._state,
            actions: this.actions,
            isExpanded: (path: string) => this._expandedPaths.has(path),
            isLoading: (path: string) => this._loadingPaths.has(path),
            isSelected: (path: string) => this._state.selectedPath === path,
        };
    }

    get actions(): FileExplorerActions {
        return {
            setRoot: (root: FileNode) => this._setRoot(root),
            toggleNode: (path: string) => this._toggleNode(path),
            expandAll: () => this._expandAll(),
            collapseAll: () => this._collapseAll(),
            selectNode: (path: string) => this._selectNode(path),
            setLoading: (path: string, loading: boolean) => this._setLoading(path, loading),
            updateChildren: (path: string, children: FileNode[]) => this._updateChildren(path, children),
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

    private _setRoot(root: FileNode) {
        this._state = {...this._state, root};
        this._host.requestUpdate();
    }

    private _toggleNode(path: string) {
        if (this._expandedPaths.has(path)) {
            this._expandedPaths.delete(path);
        } else {
            this._expandedPaths.add(path);
        }
        this._host.requestUpdate();
    }

    private _expandAll() {
        if (!this._state.root) return;
        this._collectFolderPaths(this._state.root, this._expandedPaths);
        this._host.requestUpdate();
    }

    private _collapseAll() {
        this._expandedPaths.clear();
        this._host.requestUpdate();
    }

    private _selectNode(path: string) {
        this._state = {...this._state, selectedPath: path};
        this._host.requestUpdate();
    }

    private _setLoading(path: string, loading: boolean) {
        if (loading) {
            this._loadingPaths.add(path);
        } else {
            this._loadingPaths.delete(path);
        }
        this._host.requestUpdate();
    }

    private _updateChildren(path: string, children: FileNode[]) {
        if (!this._state.root) return;
        const newRoot = this._updateNodeChildren(this._state.root, path, children);
        if (newRoot) {
            this._state = {...this._state, root: newRoot};
            this._host.requestUpdate();
        }
    }

    private _reset() {
        this._state = {...DEFAULT_FILE_EXPLORER_STATE};
        this._expandedPaths.clear();
        this._loadingPaths.clear();
        this._host.requestUpdate();
    }

    /* ── Helper Methods ── */

    /**
     * Recursively collect all folder paths
     */
    private _collectFolderPaths(node: FileNode, paths: Set<string>) {
        if (node.type === 'folder') {
            paths.add(node.path);
            if (node.children) {
                for (const child of node.children) {
                    this._collectFolderPaths(child, paths);
                }
            }
        }
    }

    /**
     * Recursively update children of the node at the given path
     * Returns new root node (immutable update)
     */
    private _updateNodeChildren(
        node: FileNode,
        targetPath: string,
        children: FileNode[]
    ): FileNode | null {
        if (node.path === targetPath) {
            return {...node, children};
        }
        if (node.type === 'folder' && node.children) {
            const newChildren = node.children.map(child => {
                const updated = this._updateNodeChildren(child, targetPath, children);
                return updated || child;
            });
            // Check if any child nodes were updated
            const hasUpdate = newChildren.some((child, i) => child !== node.children![i]);
            if (hasUpdate) {
                return {...node, children: newChildren};
            }
        }
        return null;
    }
}
