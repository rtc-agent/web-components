/**
 * File Explorer Component
 *
 * VS Code 风格的文件浏览器侧边栏。
 * 组合 rtc-file-tree-item 递归叶子组件，显示完整的文件树。
 *
 * - Header：标题 + 操作按钮（新建文件、刷新）
 * - Content：递归渲染 rtc-file-tree-item
 * - Empty State：无文件时显示提示
 *
 * @element rtc-file-explorer
 * @fires file-select - 用户点击文件 (detail: { path })
 * @fires folder-toggle - 用户点击文件夹 (detail: { path })
 * @fires refresh-requested - 用户点击刷新按钮
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {styles} from './rtc-file-explorer.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {FileExplorerContext, type FileExplorerContextValue} from '../../contexts/file-explorer.js';
import type {FileNode} from '../../types/index.js';
import {refreshIcon} from '../../icons/index.js';

// 子组件（副作用导入）
import './rtc-file-tree-item.js';
import type {RtcFileTreeItem} from './rtc-file-tree-item.js';

@customElement('rtc-file-explorer')
export class RtcFileExplorer extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Properties ── */

    /** 文件树根节点（由外部 Controller 注入） */
    @property({type: Object})
    root: FileNode | null = null;

    /** 主题（继承自父级） */
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

    /** 当前键盘焦点所在的路径（roving tabindex 管理） */
    @state()
    private _focusedPath: string | null = null;

    /* ── Event Handlers ── */

    /**
     * 转发子组件的 file-tree-item-select 事件
     * 同时同步键盘焦点到被点击的项
     */
    private _handleFileSelect(e: CustomEvent) {
        const {path, type} = e.detail;
        this._setFocusedPath(path);
        // 仅文件触发 file-select；文件夹由 tree-item 自己处理 toggle
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
     * 转发子组件的 file-tree-item-toggle 事件
     * 同时同步键盘焦点到被点击的文件夹
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
     * 刷新按钮
     */
    private _handleRefresh() {
        this.dispatchEvent(
            new CustomEvent('refresh-requested', {
                bubbles: true,
                composed: true,
            })
        );
    }

    /* ── 键盘导航 ──
     *
     * ARIA Treeview 模式：roving tabindex。
     * 只有当前焦点项 tabindex=0，其余 tabindex=-1。
     * 方向键在可见项列表中移动焦点，Enter/Space 激活。
     */

    /**
     * 深度优先遍历可见（展开的）树节点，返回扁平列表。
     * 通过 composed tree walk 穿越递归 Shadow DOM。
     *
     * TODO(perf): 当前每次按键都遍历整棵树，O(n)。对于大文件树（>500 节点），
     * 应在 controller 中维护一个扁平可见路径列表（expand/collapse/select 时增量更新），
     * 此处直接读取该列表即可 O(1)。项目已引入 @lit-labs/virtualizer，
     * 未来可将树渲染切换为虚拟滚动以支撑上千节点的场景。
     */
    private _getVisibleTreeItems(): RtcFileTreeItem[] {
        const result: RtcFileTreeItem[] = [];
        const walk = (parent: Element | ShadowRoot) => {
            for (const child of Array.from(parent.children)) {
                if (child.tagName === 'RTC-FILE-TREE-ITEM') {
                    const item = child as RtcFileTreeItem;
                    result.push(item);
                    // 仅展开的文件夹才递归子节点
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
     * 设置键盘焦点到指定 path（roving tabindex）。
     * 同时将选中状态同步到 context（选中 ≠ 焦点，但点击/Enter 会同步）。
     */
    private _setFocusedPath(path: string | null, select = false) {
        // 清除旧焦点项的 tabindex
        if (this._focusedPath) {
            const oldItem = this._findTreeItemByPath(this._focusedPath);
            if (oldItem) {
                const oldContent = oldItem.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
                if (oldContent) oldContent.tabIndex = -1;
            }
        }
        this._focusedPath = path;
        // 设置新焦点项的 tabindex 并聚焦
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
     * 通过 composed walk 查找指定 path 的树节点
     */
    private _findTreeItemByPath(path: string): RtcFileTreeItem | null {
        for (const item of this._getVisibleTreeItems()) {
            if (item.node.path === path) return item;
        }
        return null;
    }

    /**
     * 确保初始焦点存在（树加载后，焦点默认为第一项或选中项）
     */
    private _ensureInitialFocus() {
        if (this._focusedPath) return;
        const items = this._getVisibleTreeItems();
        if (items.length === 0) return;
        // 优先聚焦选中项，否则第一项
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
     * 全局键盘事件处理（绑定在 .sidebar-content 上）
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
                // 下一项
                const next = Math.min(currentIndex + 1, items.length - 1);
                this._setFocusedPath(items[next].node.path);
                break;
            }
            case 'ArrowUp': {
                // 上一项
                const prev = Math.max(currentIndex - 1, 0);
                this._setFocusedPath(items[prev].node.path);
                break;
            }
            case 'ArrowRight': {
                // 文件夹：展开；文件：无操作
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
                // 文件夹已展开 → 折叠；已折叠/文件 → 跳到父节点
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
                        // 跳到父文件夹
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
                // 激活当前项：文件夹 toggle，文件选中打开
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
     * 获取父路径（/a/b/c → /a/b，/a → /）
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
                <span class="empty-state-text">文件列表为空<br>点击刷新按钮加载</span>
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
        return html`
            <div class="sidebar-header">
                <span class="sidebar-title">资源管理器</span>
                <div class="sidebar-actions">
                    <button
                        class="action-btn"
                        title="刷新"
                        aria-label="刷新"
                        @click=${this._handleRefresh}
                    >${refreshIcon}</button>
                </div>
            </div>
            <div
                class="sidebar-content"
                role="tree"
                aria-label="文件树"
                @keydown=${this._handleKeydown}
            >
                ${this._renderTree()}
            </div>
        `;
    }

    updated(changed: Map<string, unknown>) {
        super.updated(changed);
        // 树加载/变更后，确保有初始焦点
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
