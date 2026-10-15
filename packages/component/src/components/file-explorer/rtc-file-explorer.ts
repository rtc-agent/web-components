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
 * PERFORMANCE: Virtual scrolling is implemented to handle large file trees efficiently.
 * - Only visible items (+ overscan buffer) are rendered in the DOM
 * - Tree nodes are flattened into a list for O(1) virtual scroll calculations
 * - Scroll events are throttled via requestAnimationFrame to prevent excessive re-renders
 * - Container resize is monitored via ResizeObserver for accurate viewport calculations
 * - Flattened tree results are cached and only recalculated when structure changes
 *
 * @element rtc-file-explorer
 * @fires file-select - User clicks a file (detail: { path })
 * @fires folder-toggle - User clicks a folder (detail: { path })
 * @fires refresh-requested - User clicks the refresh button
 */

import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  FileExplorerContext,
  type FileExplorerContextValue,
} from '../../contexts/file-explorer.js';
import {
  type LocaleContextValue,
  localeContext,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import { refreshIcon } from '../../icons/index.js';
import { baseStyles } from '../../styles/base.js';
import { darkTheme } from '../../styles/themes/dark.js';
import { lightTheme } from '../../styles/themes/light.js';
import { tokens } from '../../styles/tokens.js';
import type { FileNode } from '../../types/index.js';
import { styles } from './rtc-file-explorer.styles.js';

// Sub-components (side-effect imports)
import './rtc-file-tree-item.js';
import { createLogger } from '@rtc-agent/protocol';
import type { RtcFileTreeItem } from './rtc-file-tree-item.js';

const log = createLogger('FileExplorer');

/** Performance metrics for file explorer rendering */
export interface FileExplorerMetrics {
  /** Total number of files in the tree (including collapsed) */
  totalFiles: number;
  /** Number of files currently visible (after filtering/expansion) */
  visibleFiles: number;
  /** Number of expanded folder nodes */
  expandedFolders: number;
  /** Time taken to render the tree (milliseconds) */
  renderTimeMs: number;
  /** Number of items currently rendered in DOM (virtual scroll) */
  renderedItems: number;
  /** Scroll position (pixels from top) */
  scrollTop: number;
  /** Container height (pixels) */
  containerHeight: number;
}

/* ── Virtual Scroll Configuration ── */

/** Height of each tree item in pixels */
const ITEM_HEIGHT = 28;

/** Number of items to render above and below the visible area */
const OVERSCAN_COUNT = 5;

/** Default container height when actual height is not yet measured (px) */
const DEFAULT_CONTAINER_HEIGHT = 500;

@localized()
@customElement('rtc-file-explorer')
export class RtcFileExplorer extends LitElement {
  static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

  /* ── i18n ── */

  @consume({ context: localeContext, subscribe: true })
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
  @property({ type: Object })
  root: FileNode | null = null;

  /** Theme (inherited from parent) */
  @property({ type: String, reflect: true })
  theme: 'light' | 'dark' | 'system' = 'system';

  /* ── Context ── */

  @consume({ context: FileExplorerContext, subscribe: true })
  @property({ attribute: false })
  private _explorerCtx: FileExplorerContextValue = {
    state: { root: null, selectedPath: null },
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

  /** Virtual scroll state */
  @state()
  private _scrollTop = 0;

  /** RAF handle for scroll event throttling */
  private _scrollRAF: number | null = null;

  /** Container height for virtual scroll calculations */
  @state()
  private _containerHeight = 0;

  /** Cached flattened tree nodes (invalidated when tree structure changes) */
  private _cachedFlatNodes: Array<{ node: FileNode; depth: number }> | null =
    null;

  /** Flag to track if tree structure has changed */
  private _treeStructureChanged = true;

  /** Path to element map for O(1) lookup */
  private _pathToElementMap: Map<string, RtcFileTreeItem> = new Map();

  /* ── Event Handlers ── */

  /**
   * Flatten the tree structure into a list of visible nodes for virtual scrolling.
   * Respects the expand/collapse state of each node.
   * Results are cached and only recalculated when tree structure changes.
   *
   * PERFORMANCE OPTIMIZATION: Uses iterative depth-first traversal with explicit stack
   * instead of recursion. This prevents stack overflow for deeply nested trees
   * (e.g., 1000+ levels deep) and reduces function call overhead.
   */
  private _flattenTree(
    nodes: FileNode[],
    depth = 0,
  ): Array<{ node: FileNode; depth: number }> {
    // Return cached result if tree structure hasn't changed
    if (!this._treeStructureChanged && this._cachedFlatNodes) {
      return this._cachedFlatNodes;
    }

    const result: Array<{ node: FileNode; depth: number }> = [];

    // Iterative depth-first traversal using explicit stack
    // Stack entries contain the node list to process and the current depth
    const stack: Array<{ nodes: FileNode[]; depth: number }> = [
      { nodes, depth },
    ];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const { nodes: currentNodes, depth: currentDepth } = current;

      // Process nodes in reverse order so that when pushed to stack,
      // they are popped in original order (LIFO - Last In First Out)
      for (let i = currentNodes.length - 1; i >= 0; i--) {
        const node = currentNodes[i];
        result.push({ node, depth: currentDepth });

        // Only push children if folder is expanded and has children loaded
        if (
          node.type === 'folder' &&
          node.isExpanded &&
          node.children &&
          node.children.length > 0
        ) {
          stack.push({ nodes: node.children, depth: currentDepth + 1 });
        }
      }
    }

    // Cache the result
    this._cachedFlatNodes = result;
    this._treeStructureChanged = false;

    return result;
  }

  /**
   * Invalidate the flattened tree cache.
   * Called when tree structure changes (expand/collapse, add/remove nodes).
   */
  private _invalidateFlatTreeCache(): void {
    this._treeStructureChanged = true;
  }

  /**
   * Calculate the virtual scroll window: which items to render based on scroll position.
   * Returns the slice of items that should be rendered (visible + overscan).
   */
  private _getVisibleRange(
    totalItems: number,
    scrollTop: number,
    containerHeight: number,
  ): { start: number; end: number; totalHeight: number } {
    const totalHeight = totalItems * ITEM_HEIGHT;

    // Calculate visible range
    const visibleStart = Math.floor(scrollTop / ITEM_HEIGHT);
    const visibleEnd = Math.min(
      Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT),
      totalItems,
    );

    // Add overscan for smooth scrolling
    const start = Math.max(0, visibleStart - OVERSCAN_COUNT);
    const end = Math.min(totalItems, visibleEnd + OVERSCAN_COUNT);

    return { start, end, totalHeight };
  }

  /**
   * Collect performance metrics for file explorer rendering.
   * Dispatched via custom event for monitoring and debugging.
   */
  private _collectMetrics(renderTimeMs: number = 0): FileExplorerMetrics {
    const effectiveRoot = this.root ?? this._explorerCtx.state.root;
    const flatNodes = effectiveRoot?.children
      ? this._flattenTree(effectiveRoot.children)
      : [];

    // Count expanded folders
    let expandedFolders = 0;
    const countExpanded = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (
          node.type === 'folder' &&
          node.isExpanded &&
          node.children &&
          node.children.length > 0
        ) {
          expandedFolders++;
          countExpanded(node.children);
        }
      }
    };
    if (effectiveRoot?.children) {
      countExpanded(effectiveRoot.children);
    }

    return {
      totalFiles: flatNodes.length,
      visibleFiles: flatNodes.length, // All flattened nodes are visible
      expandedFolders,
      renderTimeMs,
      renderedItems: this._pathToElementMap.size,
      scrollTop: this._scrollTop,
      containerHeight: this._containerHeight,
    };
  }

  /** Handle scroll events for virtual scrolling */
  private _handleScroll(e: Event) {
    const target = e.target as HTMLElement;
    const newScrollTop = target.scrollTop;

    // PERFORMANCE: Use requestAnimationFrame to throttle scroll updates.
    // This reduces unnecessary re-renders during rapid scroll events.
    // The actual state update happens on the next animation frame.
    if (this._scrollRAF !== null) {
      cancelAnimationFrame(this._scrollRAF);
    }

    this._scrollRAF = requestAnimationFrame(() => {
      this._scrollRAF = null;
      // Only update if scroll position actually changed (avoid unnecessary re-renders)
      if (Math.abs(newScrollTop - this._scrollTop) > 1) {
        this._scrollTop = newScrollTop;
        log.debug('Virtual scroll: scrollTop =', newScrollTop);
      }
    });
  }

  /** Handle container resize to update virtual scroll calculations */
  private _resizeObserver?: ResizeObserver;

  private _setupResizeObserver(element: HTMLElement) {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        // Only update if height actually changed (avoid unnecessary re-renders)
        if (Math.abs(newHeight - this._containerHeight) > 1) {
          this._containerHeight = newHeight;
          log.debug('Virtual scroll: containerHeight =', newHeight);
        }
      }
    });
    this._resizeObserver.observe(element);
  }

  /**
   * Forward the file-tree-item-select event from child components
   * Also sync keyboard focus to the clicked item
   */
  private _handleFileSelect(e: CustomEvent) {
    const { path, type } = e.detail;
    this._setFocusedPath(path);
    // Only trigger file-select for files; folders handle toggle within tree-item itself
    if (type === 'file') {
      this.dispatchEvent(
        new CustomEvent('file-select', {
          bubbles: true,
          composed: true,
          detail: { path },
        }),
      );
    }
  }

  /**
   * Forward the file-tree-item-toggle event from child components
   * Also sync keyboard focus to the clicked folder
   */
  private _handleFolderToggle(e: CustomEvent) {
    this._setFocusedPath(e.detail.path);
    // Invalidate flattened tree cache after toggle
    this._invalidateFlatTreeCache();
    this.dispatchEvent(
      new CustomEvent('folder-toggle', {
        bubbles: true,
        composed: true,
        detail: { path: e.detail.path },
      }),
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
      }),
    );
  }

  /* ── Keyboard navigation ──
   *
   * ARIA Treeview pattern: roving tabindex.
   * Only the current focus item has tabindex=0, all others have tabindex=-1.
   * Arrow keys move focus within the visible item list, Enter/Space activates.
   */

  /**
   * Get all visible tree nodes (based on data model, not DOM).
   * This is used for keyboard navigation with virtual scrolling.
   */
  private _getAllVisibleNodes(): Array<{
    node: FileNode;
    depth: number;
  }> {
    const effectiveRoot = this.root ?? this._explorerCtx.state.root;
    if (!effectiveRoot?.children) return [];
    return this._flattenTree(effectiveRoot.children);
  }

  /**
   * Find tree node by path via flat iteration of rendered items.
   * Uses the virtual scroll container's direct children — no recursive shadow DOM walk.
   */
  private _findTreeItemByPath(path: string): RtcFileTreeItem | null {
    // Try O(1) lookup from cache
    const cachedItem = this._pathToElementMap.get(path);
    if (cachedItem?.isConnected) {
      return cachedItem;
    }

    // Linear scan of directly-rendered children (flat list from virtual scroll)
    const content =
      this.shadowRoot?.querySelector('.virtual-scroll-content') ??
      this.shadowRoot?.querySelector('.sidebar-content');
    if (!content) return null;

    for (const child of Array.from(content.children)) {
      if (child.tagName === 'RTC-FILE-TREE-ITEM') {
        const item = child as RtcFileTreeItem;
        const itemPath = item.node.path;
        // Populate cache for future O(1) lookups
        this._pathToElementMap.set(itemPath, item);
        if (itemPath === path) return item;
      }
    }
    return null;
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
        const oldContent = oldItem.shadowRoot?.querySelector(
          '.tree-item-content',
        ) as HTMLElement | null;
        if (oldContent) oldContent.tabIndex = -1;
      }
    }
    this._focusedPath = path;
    // Set tabindex of new focus item and focus it
    if (path) {
      const newItem = this._findTreeItemByPath(path);
      if (newItem) {
        const newContent = newItem.shadowRoot?.querySelector(
          '.tree-item-content',
        ) as HTMLElement | null;
        if (newContent) {
          newContent.tabIndex = 0;
          newContent.focus();
          // Ensure the focused item is scrolled into view
          this._scrollToItem(path);
        }
        if (select) {
          this._explorerCtx.actions.selectNode(path);
        }
      }
    }
  }

  /**
   * Scroll the virtual scroll container to make the specified item visible.
   * This is necessary when keyboard navigation moves focus outside the current viewport.
   */
  private _scrollToItem(path: string) {
    const allNodes = this._getAllVisibleNodes();
    const targetIndex = allNodes.findIndex((n) => n.node.path === path);
    if (targetIndex === -1) return;

    const content = this.shadowRoot?.querySelector('.sidebar-content');
    if (!content) return;

    const itemTop = targetIndex * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    const viewportTop = content.scrollTop;
    const viewportBottom = viewportTop + content.clientHeight;

    // If item is already fully visible, no need to scroll
    if (itemTop >= viewportTop && itemBottom <= viewportBottom) {
      return;
    }

    // Scroll to bring the item into view
    if (itemTop < viewportTop) {
      // Item is above viewport, scroll up
      content.scrollTop = itemTop;
    } else {
      // Item is below viewport, scroll down
      content.scrollTop = itemBottom - content.clientHeight;
    }
  }

  /**
   * Ensure initial focus exists (after tree loads, focus defaults to first item or selected item)
   */
  private _ensureInitialFocus() {
    if (this._focusedPath) return;
    const allNodes = this._getAllVisibleNodes();
    if (allNodes.length === 0) return;
    // Prefer focusing selected item, otherwise first item
    const selectedPath = this._explorerCtx.state.selectedPath;
    const target =
      selectedPath && allNodes.some((n) => n.node.path === selectedPath)
        ? selectedPath
        : allNodes[0].node.path;
    this._focusedPath = target;
    const item = this._findTreeItemByPath(target);
    if (item) {
      const content = item.shadowRoot?.querySelector(
        '.tree-item-content',
      ) as HTMLElement | null;
      if (content) content.tabIndex = 0;
    }
  }

  /**
   * Global keyboard event handler (bound to .sidebar-content)
   */
  private _handleKeydown(e: KeyboardEvent) {
    const allNodes = this._getAllVisibleNodes();
    if (allNodes.length === 0) return;

    const currentPath =
      this._focusedPath ?? this._explorerCtx.state.selectedPath;
    const currentIndex = currentPath
      ? allNodes.findIndex((n) => n.node.path === currentPath)
      : -1;

    let handled = true;

    switch (e.key) {
      case 'ArrowDown': {
        // Next item
        const next = Math.min(currentIndex + 1, allNodes.length - 1);
        this._setFocusedPath(allNodes[next].node.path);
        break;
      }
      case 'ArrowUp': {
        // Previous item
        const prev = Math.max(currentIndex - 1, 0);
        this._setFocusedPath(allNodes[prev].node.path);
        break;
      }
      case 'ArrowRight': {
        // Folder: expand; File: no action
        if (currentIndex >= 0) {
          const nodeData = allNodes[currentIndex];
          if (nodeData.node.type === 'folder' && !nodeData.node.isExpanded) {
            this._explorerCtx.actions.toggleNode(nodeData.node.path);
            this._invalidateFlatTreeCache();
            this.dispatchEvent(
              new CustomEvent('folder-toggle', {
                bubbles: true,
                composed: true,
                detail: { path: nodeData.node.path },
              }),
            );
          }
        }
        break;
      }
      case 'ArrowLeft': {
        // Folder expanded → collapse; collapsed/file → jump to parent node
        if (currentIndex >= 0) {
          const nodeData = allNodes[currentIndex];
          if (nodeData.node.type === 'folder' && nodeData.node.isExpanded) {
            this._explorerCtx.actions.toggleNode(nodeData.node.path);
            this._invalidateFlatTreeCache();
            this.dispatchEvent(
              new CustomEvent('folder-toggle', {
                bubbles: true,
                composed: true,
                detail: { path: nodeData.node.path },
              }),
            );
          } else {
            // Jump to parent folder
            const parentPath = this._getParentPath(nodeData.node.path);
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
          const nodeData = allNodes[currentIndex];
          if (nodeData.node.type === 'folder') {
            this._explorerCtx.actions.toggleNode(nodeData.node.path);
            this._explorerCtx.actions.selectNode(nodeData.node.path);
            this._invalidateFlatTreeCache();
            this.dispatchEvent(
              new CustomEvent('folder-toggle', {
                bubbles: true,
                composed: true,
                detail: { path: nodeData.node.path },
              }),
            );
          } else {
            this._explorerCtx.actions.selectNode(nodeData.node.path);
            this.dispatchEvent(
              new CustomEvent('file-select', {
                bubbles: true,
                composed: true,
                detail: { path: nodeData.node.path },
              }),
            );
          }
        }
        break;
      }
      case 'Home': {
        this._setFocusedPath(allNodes[0].node.path);
        break;
      }
      case 'End': {
        this._setFocusedPath(allNodes[allNodes.length - 1].node.path);
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

    // Flatten the tree for virtual scrolling
    const flatNodes = this._flattenTree(children);
    const totalItems = flatNodes.length;

    // P2-2 FIX: Always use virtual scrolling, even for initial render
    // Use DEFAULT_CONTAINER_HEIGHT when container height is not yet measured
    // This prevents rendering all nodes (which can be 1000+) on first render
    const effectiveHeight =
      this._containerHeight === 0
        ? DEFAULT_CONTAINER_HEIGHT
        : this._containerHeight;

    // Calculate visible range using effective height
    const { start, end, totalHeight } = this._getVisibleRange(
      totalItems,
      this._scrollTop,
      effectiveHeight,
    );

    // Log warning if rendering all items (no virtual scrolling)
    if (totalItems > 100 && start === 0 && end === totalItems) {
      log.warn(
        `FileExplorer: rendering all ${totalItems} items without virtual scrolling. ` +
          `This may cause performance issues. Container height: ${this._containerHeight}px`,
      );
    }

    // Slice the visible items
    const visibleItems = flatNodes.slice(start, end);

    // Calculate offsets for absolute positioning
    const offsetY = start * ITEM_HEIGHT;

    return html`
      <div
        class="virtual-scroll-container"
        style="height: ${totalHeight}px; position: relative;"
      >
        <div
          class="virtual-scroll-content"
          style="transform: translateY(${offsetY}px);"
        >
          ${visibleItems.map(
            ({ node, depth }) => html`
              <rtc-file-tree-item
                .node=${node}
                .depth=${depth}
                theme=${this.theme}
                @file-tree-item-select=${this._handleFileSelect}
                @file-tree-item-toggle=${this._handleFolderToggle}
              ></rtc-file-tree-item>
            `,
          )}
        </div>
      </div>
    `;
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
                @scroll=${this._handleScroll}
                @keydown=${this._handleKeydown}
            >
                ${this._renderTree()}
            </div>
        `;
  }

  updated(changed: Map<string, unknown>) {
    super.updated(changed);

    // Setup ResizeObserver on the sidebar-content element
    const content = this.shadowRoot?.querySelector('.sidebar-content');
    if (content && !this._resizeObserver) {
      this._setupResizeObserver(content as HTMLElement);
    }

    // Invalidate flattened tree cache when file tree changes
    if (changed.has('root') || changed.has('_explorerCtx')) {
      this._invalidateFlatTreeCache();
    }

    // After tree loads/changes, ensure initial focus exists
    if (changed.has('root') || changed.has('_explorerCtx')) {
      this._ensureInitialFocus();
    }

    // Collect and dispatch performance metrics after rendering
    const startTime = performance.now();
    requestAnimationFrame(() => {
      const renderTimeMs = performance.now() - startTime;
      const metrics = this._collectMetrics(renderTimeMs);
      this.dispatchEvent(
        new CustomEvent('rtc-file-explorer-metrics', {
          bubbles: true,
          composed: true,
          detail: metrics,
        }),
      );
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Cleanup ResizeObserver to prevent memory leaks
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = undefined;
    }
    // Cleanup scroll RAF to prevent memory leaks
    if (this._scrollRAF !== null) {
      cancelAnimationFrame(this._scrollRAF);
      this._scrollRAF = null;
    }
    // Cleanup path to element map
    this._pathToElementMap.clear();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-file-explorer': RtcFileExplorer;
  }

  interface HTMLElementEventMap {
    'file-select': CustomEvent<{ path: string }>;
    'folder-toggle': CustomEvent<{ path: string }>;
    'refresh-requested': CustomEvent<void>;
    'new-file-requested': CustomEvent<void>;
    'rtc-file-explorer-metrics': CustomEvent<FileExplorerMetrics>;
  }
}
