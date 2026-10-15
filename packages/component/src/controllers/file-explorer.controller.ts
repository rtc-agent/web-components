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
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  DEFAULT_FILE_EXPLORER_STATE,
  type FileExplorerActions,
  type FileExplorerContextValue,
  type FileExplorerState,
} from '../contexts/file-explorer.js';
import type { FileNode } from '../types/index.js';

export class FileExplorerController implements ReactiveController {
  private _host: ReactiveControllerHost;
  private _state: FileExplorerState = { ...DEFAULT_FILE_EXPLORER_STATE };
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

  /**
   * CRITICAL FIX: Value cache to prevent unnecessary Context consumer re-renders.
   * @lit/context uses `===` comparison, so creating new objects every time triggers
   * consumers even when the state hasn't changed. Cache the value object and only
   * recreate when state reference changes.
   */
  private _cachedValue?: FileExplorerContextValue;
  private _cachedState?: FileExplorerState;
  private _cachedExpandedPaths?: Set<string>;
  private _cachedLoadingPaths?: Set<string>;

  get value(): FileExplorerContextValue {
    // Only create new value object if state or sets changed
    if (
      this._cachedValue &&
      this._cachedState === this._state &&
      this._cachedExpandedPaths === this._expandedPaths &&
      this._cachedLoadingPaths === this._loadingPaths
    ) {
      return this._cachedValue;
    }
    this._cachedState = this._state;
    this._cachedExpandedPaths = this._expandedPaths;
    this._cachedLoadingPaths = this._loadingPaths;
    this._cachedValue = {
      state: this._state,
      actions: this.actions,
      isExpanded: (path: string) => this._expandedPaths.has(path),
      isLoading: (path: string) => this._loadingPaths.has(path),
      isSelected: (path: string) => this._state.selectedPath === path,
    };
    return this._cachedValue;
  }

  get actions(): FileExplorerActions {
    return {
      setRoot: (root: FileNode) => this._setRoot(root),
      toggleNode: (path: string) => this._toggleNode(path),
      expandAll: () => this._expandAll(),
      collapseAll: () => this._collapseAll(),
      selectNode: (path: string) => this._selectNode(path),
      setLoading: (path: string, loading: boolean) =>
        this._setLoading(path, loading),
      updateChildren: (path: string, children: FileNode[]) =>
        this._updateChildren(path, children),
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
    this._state = { ...this._state, root };
    this._host.requestUpdate();
  }

  private _toggleNode(path: string) {
    const newExpanded = new Set(this._expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    this._expandedPaths = newExpanded;
    this._host.requestUpdate();
  }

  private _expandAll() {
    if (!this._state.root) return;
    const newExpanded = new Set(this._expandedPaths);
    this._collectFolderPaths(this._state.root, newExpanded);
    this._expandedPaths = newExpanded;
    this._host.requestUpdate();
  }

  private _collapseAll() {
    this._expandedPaths = new Set();
    this._host.requestUpdate();
  }

  private _selectNode(path: string) {
    this._state = { ...this._state, selectedPath: path };
    this._host.requestUpdate();
  }

  private _setLoading(path: string, loading: boolean) {
    const newLoading = new Set(this._loadingPaths);
    if (loading) {
      newLoading.add(path);
    } else {
      newLoading.delete(path);
    }
    this._loadingPaths = newLoading;
    this._host.requestUpdate();
  }

  private _updateChildren(path: string, children: FileNode[]) {
    if (!this._state.root) return;
    const newRoot = this._updateNodeChildren(this._state.root, path, children);
    if (newRoot) {
      this._state = { ...this._state, root: newRoot };
      this._host.requestUpdate();
    }
  }

  private _reset() {
    this._state = { ...DEFAULT_FILE_EXPLORER_STATE };
    this._expandedPaths = new Set();
    this._loadingPaths = new Set();
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
    children: FileNode[],
  ): FileNode | null {
    if (node.path === targetPath) {
      return { ...node, children };
    }
    if (node.type === 'folder' && node.children) {
      const newChildren = node.children.map((child) => {
        const updated = this._updateNodeChildren(child, targetPath, children);
        return updated || child;
      });
      // Check if any child nodes were updated
      const hasUpdate = newChildren.some(
        (child, i) => child !== node.children?.[i],
      );
      if (hasUpdate) {
        return { ...node, children: newChildren };
      }
    }
    return null;
  }
}
