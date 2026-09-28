/**
 * File Explorer Component
 *
 * VS Code-style file browser sidebar.
 * Composes rtc-file-tree-item recursive leaf components to display the full file tree.
 *
 * - Header: title + action buttons (new file, refresh)
 * - Content: recursively renders rtc-file-tree-item
 * - Empty State: shows prompt when no files
 *
 * @element rtc-file-explorer
 * @fires file-select - User clicks a file (detail: { path })
 * @fires folder-toggle - User clicks a folder (detail: { path })
 * @fires refresh-requested - User clicks the refresh button
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-file-explorer.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {FileExplorerContext, type FileExplorerContextValue} from '../../contexts/file-explorer.js';
import type {FileNode} from '../../types/index.js';
import {refreshIcon} from '../../icons/index.js';

// Sub-components (side-effect imports)
import './rtc-file-tree-item.js';
import type {RtcFileTreeItem} from './rtc-file-tree-item.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('FileExplorer');

@localized()
@customElement('rtc-file-explorer')
export class RtcFileExplorer extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── i18n ── */

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** File tree root node (injected by external Controller) */
    @property({type: Object})
    root: FileNode | null = null;

    /** Theme (inherited from parent) */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Context ── */

    @consume({context: FileExplorerContext, subscribe: true})
    @property({attribute: false})
    private _explorerCtx: FileExplorerContextValue = {
        state: {root: null, selectedPath: null},
        actions: {
            setRoot: () => {},
            toggleNode: () => {},
            expandAll: () => {},
            collapseAll: () => {},
            selectNode: () => {},
            setLoading: () => {},
            updateChildren: () => {},
            reset: () => {},
        },
        isExpanded: () => false,
        isLoading: () => false,
        isSelected: () => false,
    };

    /** Current keyboard focus path (roving tabindex management) */
    @state()
    private _focusedPath: string | null = null;

    /* ── Event Handlers ── */

    /**
     * Forward the file-tree-item-select event from child components
     * Also sync keyboard focus to the clicked item
     */
    private _handleFileSelect(e: CustomEvent) {
        const {path, type} = e.detail;
        this._setFocusedPath(path);
        // Only trigger file-select for files; folders handle toggle within tree-item itself
        if (type === 'file') {
            this.dispatchEvent(
                new CustomEvent('file-select', {
                    bubbles: true,
                    composed: true,
                    detail: {path},
                })
            );
        }
    }

    /**
     * Forward the file-tree-item-toggle event from child components
     * Also sync keyboard focus to the clicked folder
     */
    private _handleFolderToggle(e: CustomEvent) {
        this._setFocusedPath(e.detail.path);
        this.dispatchEvent(
            new CustomEvent('folder-toggle', {
                bubbles: true,
                composed: true,
                detail: {path: e.detail.path},
            })
        );
    }

    /**
     * Refresh button
     */
    private _handleRefresh() {
        this.dispatchEvent(
            new CustomEvent('refresh-requested', {
                bubbles: true,
                composed: true,
            })
        );
    }

    /* ── Keyboard navigation ──
     *
     * ARIA Treeview pattern: roving tabindex.
     * Only the current focus item has tabindex=0, all others have tabindex=-1.
     * Arrow keys move focus within the visible item list, Enter/Space activates.
     */

    /**
     * Depth-first traversal of visible (expanded) tree nodes, returns a flat list.
     * Traverses recursive Shadow DOM via composed tree walk.
     *
     * TODO(perf): Currently traverses the entire tree on every keypress, O(n). For large file trees (>500 nodes),
     * a flat visible path list should be maintained in the controller (incrementally updated on expand/collapse/select),
     * and this method would just read that list in O(1). The project has imported @lit-labs/virtualizer,
     * and in the future tree rendering can be switched to virtual scrolling to support thousands of nodes.
     */
    private _getVisibleTreeItems(): RtcFileTreeItem[] {
        const result: RtcFileTreeItem[] = [];
        const walk = (parent: Element | ShadowRoot) => {
            for (const child of Array.from(parent.children)) {
                if (child.tagName === 'RTC-FILE-TREE-ITEM') {
                    const item = child as RtcFileTreeItem;
                    result.push(item);
                    // Only recurse into children for expanded folders
                    if (item.isFolder && item.expanded) {
                        const childrenContainer =
                            item.shadowRoot?.querySelector('.children');
                        if (childrenContainer) walk(childrenContainer);
                    }
                }
            }
        };
        const content = this.shadowRoot?.querySelector('.sidebar-content');
        if (content) walk(content);
        return result;
    }

    /**
     * Set keyboard focus to the specified path (roving tabindex).
     * Also syncs selection state to context (selection !== focus, but click/Enter syncs).
     */
    private _setFocusedPath(path: string | null, select = false) {
        // Clear tabindex of old focus item
        if (this._focusedPath) {
            const oldItem = this._findTreeItemByPath(this._focusedPath);
            if (oldItem) {
                const oldContent = oldItem.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
                if (oldContent) oldContent.tabIndex = -1;
            }
        }
        this._focusedPath = path;
        // Set tabindex of new focus item and focus it
        if (path) {
            const newItem = this._findTreeItemByPath(path);
            if (newItem) {
                const newContent = newItem.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
                if (newContent) {
                    newContent.tabIndex = 0;
                    newContent.focus();
                }
                if (select) {
                    this._explorerCtx.actions.selectNode(path);
                }
            }
        }
    }

    /**
     * Find tree node by path via composed walk
     */
    private _findTreeItemByPath(path: string): RtcFileTreeItem | null {
        for (const item of this._getVisibleTreeItems()) {
            if (item.node.path === path) return item;
        }
        return null;
    }

    /**
     * Ensure initial focus exists (after tree loads, focus defaults to first item or selected item)
     */
    private _ensureInitialFocus() {
        if (this._focusedPath) return;
        const items = this._getVisibleTreeItems();
        if (items.length === 0) return;
        // Prefer focusing selected item, otherwise first item
        const selectedPath = this._explorerCtx.state.selectedPath;
        const target = selectedPath && this._findTreeItemByPath(selectedPath)
            ? selectedPath
            : items[0].node.path;
        this._focusedPath = target;
        const item = this._findTreeItemByPath(target);
        if (item) {
            const content = item.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
            if (content) content.tabIndex = 0;
        }
    }

    /**
     * Global keyboard event handler (bound to .sidebar-content)
     */
    private _handleKeydown(e: KeyboardEvent) {
        const items = this._getVisibleTreeItems();
        if (items.length === 0) return;

        const currentPath = this._focusedPath ?? this._explorerCtx.state.selectedPath;
        const currentIndex = currentPath
            ? items.findIndex(it => it.node.path === currentPath)
            : -1;

        let handled = true;

        switch (e.key) {
            case 'ArrowDown': {
                // Next item
                const next = Math.min(currentIndex + 1, items.length - 1);
                this._setFocusedPath(items[next].node.path);
                break;
            }
            case 'ArrowUp': {
                // Previous item
                const prev = Math.max(currentIndex - 1, 0);
                this._setFocusedPath(items[prev].node.path);
                break;
            }
            case 'ArrowRight': {
                // Folder: expand; File: no action
                if (currentIndex >= 0) {
                    const item = items[currentIndex];
                    if (item.isFolder && !item.expanded) {
                        this._explorerCtx.actions.toggleNode(item.node.path);
                        this.dispatchEvent(
                            new CustomEvent('folder-toggle', {
                                bubbles: true,
                                composed: true,
                                detail: {path: item.node.path},
                            })
                        );
                    }
                }
                break;
            }
            case 'ArrowLeft': {
                // Folder expanded → collapse; collapsed/file → jump to parent node
                if (currentIndex >= 0) {
                    const item = items[currentIndex];
                    if (item.isFolder && item.expanded) {
                        this._explorerCtx.actions.toggleNode(item.node.path);
                        this.dispatchEvent(
                            new CustomEvent('folder-toggle', {
                                bubbles: true,
                                composed: true,
                                detail: {path: item.node.path},
                            })
                        );
                    } else {
                        // Jump to parent folder
                        const parentPath = this._getParentPath(item.node.path);
                        if (parentPath !== null) {
                            this._setFocusedPath(parentPath);
                        }
                    }
                }
                break;
            }
            case 'Enter':
            case ' ': {
                // Activate current item: folder toggle, file select to open
                if (currentIndex >= 0) {
                    const item = items[currentIndex];
                    if (item.isFolder) {
                        this._explorerCtx.actions.toggleNode(item.node.path);
                        this._explorerCtx.actions.selectNode(item.node.path);
                        this.dispatchEvent(
                            new CustomEvent('folder-toggle', {
                                bubbles: true,
                                composed: true,
                                detail: {path: item.node.path},
                            })
                        );
                    } else {
                        this._explorerCtx.actions.selectNode(item.node.path);
                        this.dispatchEvent(
                            new CustomEvent('file-select', {
                                bubbles: true,
                                composed: true,
                                detail: {path: item.node.path},
                            })
                        );
                    }
                }
                break;
            }
            case 'Home': {
                this._setFocusedPath(items[0].node.path);
                break;
            }
            case 'End': {
                this._setFocusedPath(items[items.length - 1].node.path);
                break;
            }
            default:
                handled = false;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    /**
     * Get parent path (/a/b/c → /a/b, /a → /)
     */
    private _getParentPath(path: string): string | null {
        if (path === '/' || path === '') return null;
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash <= 0) return '/';
        return path.substring(0, lastSlash);
    }

    /* ── Render ── */

    private _renderEmptyState() {
        return html`
            <div class="empty-state">
                <span class="empty-state-icon">${refreshIcon}</span>
                <span class="empty-state-text">${msg('文件列表为空')}<br>${msg('点击刷新按钮加载')}</span>
            </div>
        `;
    }

    private _renderTree() {
        const effectiveRoot = this.root ?? this._explorerCtx.state.root;
        if (!effectiveRoot) return this._renderEmptyState();

        const children = effectiveRoot.children;
        if (!children || children.length === 0) {
            return this._renderEmptyState();
        }

        return children.map(
            child => html`
                <rtc-file-tree-item
                    .node=${child}
                    .depth=${0}
                    theme=${this.theme}
                    @file-tree-item-select=${this._handleFileSelect}
                    @file-tree-item-toggle=${this._handleFolderToggle}
                ></rtc-file-tree-item>
            `
        );
    }

    render() {
        void this._localeCtx.locale;
        return html`
            <div class="sidebar-header">
                <span class="sidebar-title">${msg('资源管理器')}</span>
                <div class="sidebar-actions">
                    <button
                        class="action-btn"
                        title=${msg('刷新')}
                        aria-label=${msg('刷新')}
                        @click=${this._handleRefresh}
                    >${refreshIcon}</button>
                </div>
            </div>
            <div
                class="sidebar-content"
                role="tree"
                aria-label=${msg('文件树')}
                @keydown=${this._handleKeydown}
            >
                ${this._renderTree()}
            </div>
        `;
    }

    updated(changed: Map<string, unknown>) {
        super.updated(changed);
        // After tree loads/changes, ensure initial focus exists
        if (changed.has('root') || changed.has('_explorerCtx')) {
            this._ensureInitialFocus();
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-file-explorer': RtcFileExplorer;
    }

    interface HTMLElementEventMap {
        'file-select': CustomEvent<{path: string}>;
        'folder-toggle': CustomEvent<{path: string}>;
        'refresh-requested': CustomEvent<void>;
        'new-file-requested': CustomEvent<void>;
    }
}
