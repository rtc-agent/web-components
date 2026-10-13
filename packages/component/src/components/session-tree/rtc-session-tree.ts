/**
 * Session Tree Container Component
 *
 * VS Code-style session tree sidebar.
 * Composes rtc-session-tree-item recursive leaf components to display the full session hierarchy tree.
 *
 * - Header: Title + action buttons (new session)
 * - Content: Recursively renders rtc-session-tree-item
 * - Empty State: Shows a prompt when there are no sessions
 *
 * Consumes tree data and expand/collapse actions via SessionTreeContext.
 *
 * @element rtc-session-tree
 * @fires rtc-session-tree-select - User clicks a session (detail: { sessionId })
 * @fires rtc-session-tree-toggle - User clicks expand/collapse (detail: { sessionId })
 * @fires rtc-session-tree-new - User clicks the new session button
 */
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import {
  localeContext,
  type LocaleContextValue,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import { styles } from './rtc-session-tree.styles.js';
import { tokens } from '../../styles/tokens.js';
import { lightTheme } from '../../styles/themes/light.js';
import { darkTheme } from '../../styles/themes/dark.js';
import { baseStyles } from '../../styles/base.js';
import {
  SessionTreeContext,
  type SessionTreeContextValue,
} from '../../contexts/session-tree.js';
import type { SessionTreeNode } from '../../types/index.js';
import { plusIcon, refreshIcon } from '../../icons/index.js';

// Sub-component (side-effect import)
import './rtc-session-tree-item.js';
import type { RtcSessionTreeItem } from './rtc-session-tree-item.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('SessionTree');

/** Performance metrics for session tree rendering */
export interface SessionTreeMetrics {
  /** Total number of sessions in the tree (including collapsed) */
  totalSessions: number;
  /** Number of sessions currently visible (after filtering/expansion) */
  visibleSessions: number;
  /** Number of expanded group nodes */
  expandedGroups: number;
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
@customElement('rtc-session-tree')
export class RtcSessionTree extends LitElement {
  static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

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

  /** Theme (inherited from parent) */
  @property({ type: String, reflect: true })
  theme: 'light' | 'dark' | 'system' = 'system';

  /* ── Context ── */

  @consume({ context: SessionTreeContext, subscribe: true })
  @property({ attribute: false })
  private _treeCtx: SessionTreeContextValue = {
    state: { rootNodes: [] },
    actions: {
      toggleExpand: () => {},
      expand: () => {},
      collapse: () => {},
      rebuildTree: () => {},
    },
  };

  /** Currently selected sessionId */
  @property({ type: String, attribute: 'selected-session-id' })
  selectedSessionId: string | null = null;

  /** SessionId with current keyboard focus (roving tabindex management) */
  @state()
  private _focusedSessionId: string | null = null;

  /** Virtual scroll state */
  @state()
  private _scrollTop = 0;

  /** RAF handle for scroll event throttling */
  private _scrollRAF: number | null = null;

  /** Container height for virtual scroll calculations */
  @state()
  private _containerHeight = 0;

  /** Cached flattened tree nodes (invalidated when tree structure changes) */
  private _cachedFlatNodes: Array<{ node: SessionTreeNode; depth: number }> | null = null;

  /** Flag to track if tree structure has changed */
  private _treeStructureChanged = true;

  /** Session ID to element map for O(1) lookup */
  private _sessionIdToElementMap: Map<string, RtcSessionTreeItem> = new Map();

  /* ── Virtual Scroll Helpers ── */

  /**
   * Flatten the tree structure into a list of visible nodes for virtual scrolling.
   * Respects the expand/collapse state of each node.
   * Results are cached and only recalculated when tree structure changes.
   */
  private _flattenTree(
    nodes: SessionTreeNode[],
    depth = 0,
  ): Array<{ node: SessionTreeNode; depth: number }> {
    // Return cached result if tree structure hasn't changed
    if (!this._treeStructureChanged && this._cachedFlatNodes) {
      return this._cachedFlatNodes;
    }

    const result: Array<{ node: SessionTreeNode; depth: number }> = [];
    const flattenRecursive = (
      nodeList: SessionTreeNode[],
      currentDepth: number,
    ) => {
      for (const node of nodeList) {
        result.push({ node, depth: currentDepth });
        if (node.isExpanded && node.children.length > 0) {
          flattenRecursive(node.children, currentDepth + 1);
        }
      }
    };
    flattenRecursive(nodes, depth);

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
   * Collect performance metrics for session tree rendering.
   * Dispatched via custom event for monitoring and debugging.
   */
  private _collectMetrics(renderTimeMs: number = 0): SessionTreeMetrics {
    const rootNodes = this._treeCtx?.state?.rootNodes ?? [];
    const flatNodes = this._flattenTree(rootNodes);

    // Count expanded groups
    let expandedGroups = 0;
    const countExpanded = (nodes: SessionTreeNode[]) => {
      for (const node of nodes) {
        if (node.isExpanded && node.children.length > 0) {
          expandedGroups++;
          countExpanded(node.children);
        }
      }
    };
    countExpanded(rootNodes);

    return {
      totalSessions: flatNodes.length,
      visibleSessions: flatNodes.length, // All flattened nodes are visible
      expandedGroups,
      renderTimeMs,
      renderedItems: this._sessionIdToElementMap.size,
      scrollTop: this._scrollTop,
      containerHeight: this._containerHeight,
    };
  }

  /* ── Event Handlers ── */

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

  private _handleSelect(e: CustomEvent) {
    const { sessionId } = e.detail;
    this._setFocusedSessionId(sessionId);
    this.dispatchEvent(
      new CustomEvent('rtc-session-tree-select', {
        bubbles: true,
        composed: true,
        detail: { sessionId },
      }),
    );
  }

  private _handleToggle(e: CustomEvent) {
    const { sessionId } = e.detail;
    this._setFocusedSessionId(sessionId);
    this._treeCtx.actions.toggleExpand(sessionId);
    // Invalidate flattened tree cache after toggle
    this._invalidateFlatTreeCache();
    this.dispatchEvent(
      new CustomEvent('rtc-session-tree-toggle', {
        bubbles: true,
        composed: true,
        detail: { sessionId },
      }),
    );
  }

  private _handleNewSession() {
    this.dispatchEvent(
      new CustomEvent('rtc-session-tree-new', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleRefresh() {
    // Session list is synced in real-time by UIUpdateBus (server changes auto-pushed), no manual refresh logic.
    // Keep the button but show a toast to avoid user confusion. Can be wired to force-fetch in the future if needed.
    this.dispatchEvent(
      new CustomEvent('rtc-toast-requested', {
        bubbles: true,
        composed: true,
        detail: {
          message: msg('会话列表已自动同步'),
          type: 'info',
        },
      }),
    );
  }

  private _handleItemRename(e: CustomEvent) {
    const { sessionId, title } = e.detail;
    // Forward upward as a unified rename confirmation event, handled by rtc-agent which calls SessionController directly
    this.dispatchEvent(
      new CustomEvent('rtc-session-rename-confirmed', {
        bubbles: true,
        composed: true,
        detail: { sessionId, title },
      }),
    );
  }

  private _handleItemDelete(e: CustomEvent) {
    const { sessionId } = e.detail;
    // Forward upward as a unified delete request event, handled by rtc-agent which calls SessionController.deleteSession
    this.dispatchEvent(
      new CustomEvent('rtc-session-delete-requested', {
        bubbles: true,
        composed: true,
        detail: { sessionId },
      }),
    );
  }

  /* ── Keyboard Navigation ──
   *
   * ARIA Treeview pattern: roving tabindex.
   * Arrow keys move focus within the visible item list, Enter/Space activates.
   *
   * NOTE: Keyboard navigation is based on the data model (flattened tree),
   * not the DOM. This is necessary because virtual scrolling only renders
   * visible items, so we cannot rely on DOM traversal to find all tree items.
   */

  /**
   * Get all visible tree nodes (based on data model, not DOM).
   * This is used for keyboard navigation with virtual scrolling.
   */
  private _getAllVisibleNodes(): Array<{
    node: SessionTreeNode;
    depth: number;
  }> {
    if (!this._treeCtx?.state?.rootNodes) return [];
    return this._flattenTree(this._treeCtx.state.rootNodes);
  }

  private _setFocusedSessionId(sessionId: string | null) {
    // Clear old focused item
    if (this._focusedSessionId) {
      const oldItem = this._findTreeItemBySessionId(this._focusedSessionId);
      if (oldItem) {
        const oldContent = oldItem.shadowRoot?.querySelector(
          '.tree-item-content',
        ) as HTMLElement | null;
        if (oldContent) oldContent.tabIndex = -1;
      }
    }
    this._focusedSessionId = sessionId;
    // Set new focused item
    if (sessionId) {
      const newItem = this._findTreeItemBySessionId(sessionId);
      if (newItem) {
        const newContent = newItem.shadowRoot?.querySelector(
          '.tree-item-content',
        ) as HTMLElement | null;
        if (newContent) {
          newContent.tabIndex = 0;
          newContent.focus();
          // Ensure the focused item is scrolled into view
          this._scrollToItem(sessionId);
        }
      }
    }
  }

  /**
   * Scroll the virtual scroll container to make the specified item visible.
   * This is necessary when keyboard navigation moves focus outside the current viewport.
   */
  private _scrollToItem(sessionId: string) {
    const allNodes = this._getAllVisibleNodes();
    const targetIndex = allNodes.findIndex(
      (n) => n.node.session.clientId === sessionId,
    );
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

  private _findTreeItemBySessionId(
    sessionId: string,
  ): RtcSessionTreeItem | null {
    // O(1) lookup from cache
    const cachedItem = this._sessionIdToElementMap.get(sessionId);
    if (cachedItem && cachedItem.isConnected) {
      return cachedItem;
    }

    // Linear scan of directly-rendered children (flat list from virtual scroll).
    // No recursive shadow DOM walk — only iterates items actually in the DOM.
    const content =
      this.shadowRoot?.querySelector('.virtual-scroll-content') ??
      this.shadowRoot?.querySelector('.sidebar-content');
    if (!content) return null;

    for (const child of Array.from(content.children)) {
      if (child.tagName === 'RTC-SESSION-TREE-ITEM') {
        const item = child as RtcSessionTreeItem;
        const id = item.node.session.clientId;
        // Populate cache for future O(1) lookups
        this._sessionIdToElementMap.set(id, item);
        if (id === sessionId) return item;
      }
    }
    return null;
  }

  private _ensureInitialFocus() {
    if (this._focusedSessionId) return;
    const allNodes = this._getAllVisibleNodes();
    if (allNodes.length === 0) return;
    const target =
      this.selectedSessionId &&
      allNodes.some((n) => n.node.session.clientId === this.selectedSessionId)
        ? this.selectedSessionId
        : allNodes[0].node.session.clientId;
    this._focusedSessionId = target;
    const item = this._findTreeItemBySessionId(target);
    if (item) {
      const content = item.shadowRoot?.querySelector(
        '.tree-item-content',
      ) as HTMLElement | null;
      if (content) content.tabIndex = 0;
    }
  }

  private _handleKeydown(e: KeyboardEvent) {
    const allNodes = this._getAllVisibleNodes();
    if (allNodes.length === 0) return;

    const currentId = this._focusedSessionId ?? this.selectedSessionId;
    const currentIndex = currentId
      ? allNodes.findIndex((n) => n.node.session.clientId === currentId)
      : -1;

    let handled = true;

    switch (e.key) {
      case 'ArrowDown': {
        const next = Math.min(currentIndex + 1, allNodes.length - 1);
        this._setFocusedSessionId(allNodes[next].node.session.clientId);
        break;
      }
      case 'ArrowUp': {
        const prev = Math.max(currentIndex - 1, 0);
        this._setFocusedSessionId(allNodes[prev].node.session.clientId);
        break;
      }
      case 'ArrowRight': {
        if (currentIndex >= 0) {
          const nodeData = allNodes[currentIndex];
          if (nodeData.node.children.length > 0 && !nodeData.node.isExpanded) {
            this._treeCtx.actions.expand(nodeData.node.session.clientId);
          }
        }
        break;
      }
      case 'ArrowLeft': {
        if (currentIndex >= 0) {
          const nodeData = allNodes[currentIndex];
          if (nodeData.node.children.length > 0 && nodeData.node.isExpanded) {
            this._treeCtx.actions.collapse(nodeData.node.session.clientId);
          }
        }
        break;
      }
      case 'Enter':
      case ' ': {
        if (currentIndex >= 0) {
          const nodeData = allNodes[currentIndex];
          const sessionId = nodeData.node.session.clientId;
          this.dispatchEvent(
            new CustomEvent('rtc-session-tree-select', {
              bubbles: true,
              composed: true,
              detail: { sessionId },
            }),
          );
        }
        break;
      }
      case 'Home': {
        this._setFocusedSessionId(allNodes[0].node.session.clientId);
        break;
      }
      case 'End': {
        this._setFocusedSessionId(
          allNodes[allNodes.length - 1].node.session.clientId,
        );
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

  /* ── Render ── */

  private _renderEmptyState() {
    return html`
            <div class="empty-state">
                <span class="empty-state-icon">${refreshIcon}</span>
                <span class="empty-state-text">${msg('暂无会话')}</span>
            </div>
        `;
  }

  private _renderTree() {
    // Defense-in-depth: guard against undefined context (should not happen with proper initialValue)
    if (!this._treeCtx?.state) {
      log.warn(
        '_renderTree: treeCtx or state is undefined, rendering empty state',
      );
      return this._renderEmptyState();
    }
    const { rootNodes } = this._treeCtx.state;
    if (rootNodes.length === 0) return this._renderEmptyState();

    // Flatten the tree for virtual scrolling
    const flatNodes = this._flattenTree(rootNodes);
    const totalItems = flatNodes.length;

    // Use default height if container height is not yet measured
    const effectiveHeight =
      this._containerHeight === 0
        ? DEFAULT_CONTAINER_HEIGHT
        : this._containerHeight;

    // If container height is at default, render all items (fallback for initial render)
    if (this._containerHeight === 0) {
      return flatNodes.map(
        ({ node, depth }) => html`
          <rtc-session-tree-item
            .node=${node}
            .depth=${depth}
            theme=${this.theme}
            selected-session-id=${this.selectedSessionId ?? ''}
            @rtc-session-tree-item-select=${this._handleSelect}
            @rtc-session-tree-item-toggle=${this._handleToggle}
            @rtc-session-tree-item-rename=${this._handleItemRename}
            @rtc-session-tree-item-delete=${this._handleItemDelete}
          ></rtc-session-tree-item>
        `,
      );
    }

    // Calculate visible range using effective height
    const { start, end, totalHeight } = this._getVisibleRange(
      totalItems,
      this._scrollTop,
      effectiveHeight,
    );

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
              <rtc-session-tree-item
                .node=${node}
                .depth=${depth}
                theme=${this.theme}
                selected-session-id=${this.selectedSessionId ?? ''}
                @rtc-session-tree-item-select=${this._handleSelect}
                @rtc-session-tree-item-toggle=${this._handleToggle}
                @rtc-session-tree-item-rename=${this._handleItemRename}
                @rtc-session-tree-item-delete=${this._handleItemDelete}
              ></rtc-session-tree-item>
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
                <span class="sidebar-title">${msg('会话')}</span>
                <div class="sidebar-actions">
                    <button
                        class="action-btn"
                        title=${msg('刷新')}
                        aria-label=${msg('刷新会话列表')}
                        @click=${this._handleRefresh}
                    >${refreshIcon}</button>
                    <button
                        class="action-btn"
                        title=${msg('新建会话')}
                        aria-label=${msg('新建会话')}
                        @click=${this._handleNewSession}
                    >${plusIcon}</button>
                </div>
            </div>
            <div
                class="sidebar-content"
                role="tree"
                aria-label=${msg('会话树')}
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

    // Invalidate flattened tree cache when tree context changes
    if (changed.has('_treeCtx')) {
      this._invalidateFlatTreeCache();
    }

    if (changed.has('_treeCtx') || changed.has('selectedSessionId')) {
      this._ensureInitialFocus();
    }

    // Collect and dispatch performance metrics after rendering
    const startTime = performance.now();
    requestAnimationFrame(() => {
      const renderTimeMs = performance.now() - startTime;
      const metrics = this._collectMetrics(renderTimeMs);
      this.dispatchEvent(
        new CustomEvent('rtc-session-tree-metrics', {
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
    // Cleanup session ID to element map
    this._sessionIdToElementMap.clear();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-session-tree': RtcSessionTree;
  }

  interface HTMLElementEventMap {
    'rtc-session-tree-select': CustomEvent<{ sessionId: string }>;
    'rtc-session-tree-toggle': CustomEvent<{ sessionId: string }>;
    'rtc-session-tree-new': CustomEvent<void>;
    'rtc-session-rename-confirmed': CustomEvent<{
      sessionId: string;
      title: string;
    }>;
    'rtc-session-delete-requested': CustomEvent<{ sessionId: string }>;
    'rtc-session-tree-metrics': CustomEvent<SessionTreeMetrics>;
  }
}
