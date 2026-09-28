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
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-session-tree.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {SessionTreeContext, type SessionTreeContextValue} from '../../contexts/session-tree.js';
import {plusIcon, refreshIcon} from '../../icons/index.js';

// Sub-component (side-effect import)
import './rtc-session-tree-item.js';
import type {RtcSessionTreeItem} from './rtc-session-tree-item.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('SessionTree');

@localized()
@customElement('rtc-session-tree')
export class RtcSessionTree extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

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

    /** Theme (inherited from parent) */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Context ── */

    @consume({context: SessionTreeContext, subscribe: true})
    @property({attribute: false})
    private _treeCtx: SessionTreeContextValue = {
        state: {rootNodes: []},
        actions: {
            toggleExpand: () => {},
            expand: () => {},
            collapse: () => {},
            rebuildTree: () => {},
        },
    };

    /** Currently selected sessionId */
    @property({type: String, attribute: 'selected-session-id'})
    selectedSessionId: string | null = null;

    /** SessionId with current keyboard focus (roving tabindex management) */
    @state()
    private _focusedSessionId: string | null = null;

    /* ── Event Handlers ── */

    private _handleSelect(e: CustomEvent) {
        const {sessionId} = e.detail;
        this._setFocusedSessionId(sessionId);
        this.dispatchEvent(
            new CustomEvent('rtc-session-tree-select', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    private _handleToggle(e: CustomEvent) {
        const {sessionId} = e.detail;
        this._setFocusedSessionId(sessionId);
        this._treeCtx.actions.toggleExpand(sessionId);
        this.dispatchEvent(
            new CustomEvent('rtc-session-tree-toggle', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    private _handleNewSession() {
        this.dispatchEvent(
            new CustomEvent('rtc-session-tree-new', {
                bubbles: true,
                composed: true,
            })
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
            })
        );
    }

    private _handleItemRename(e: CustomEvent) {
        const {sessionId, title} = e.detail;
        // Forward upward as a unified rename confirmation event, handled by rtc-agent which calls SessionController directly
        this.dispatchEvent(
            new CustomEvent('rtc-session-rename-confirmed', {
                bubbles: true,
                composed: true,
                detail: {sessionId, title},
            })
        );
    }

    private _handleItemDelete(e: CustomEvent) {
        const {sessionId} = e.detail;
        // Forward upward as a unified delete request event, handled by rtc-agent which calls SessionController.deleteSession
        this.dispatchEvent(
            new CustomEvent('rtc-session-delete-requested', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    /* ── Keyboard Navigation ──
     *
     * ARIA Treeview pattern: roving tabindex.
     * Arrow keys move focus within the visible item list, Enter/Space activates.
     */

    /**
     * Depth-first traversal of visible (expanded) tree nodes, returning a flat list.
     * Walks the composed tree to traverse recursive Shadow DOM.
     */
    private _getVisibleTreeItems(): RtcSessionTreeItem[] {
        const result: RtcSessionTreeItem[] = [];
        const walk = (parent: Element | ShadowRoot) => {
            for (const child of Array.from(parent.children)) {
                if (child.tagName === 'RTC-SESSION-TREE-ITEM') {
                    const item = child as RtcSessionTreeItem;
                    result.push(item);
                    // Only recurse into children for expanded nodes
                    if (item.node.children.length > 0 && item.node.isExpanded) {
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

    private _setFocusedSessionId(sessionId: string | null) {
        // Clear old focused item
        if (this._focusedSessionId) {
            const oldItem = this._findTreeItemBySessionId(this._focusedSessionId);
            if (oldItem) {
                const oldContent = oldItem.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
                if (oldContent) oldContent.tabIndex = -1;
            }
        }
        this._focusedSessionId = sessionId;
        // Set new focused item
        if (sessionId) {
            const newItem = this._findTreeItemBySessionId(sessionId);
            if (newItem) {
                const newContent = newItem.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
                if (newContent) {
                    newContent.tabIndex = 0;
                    newContent.focus();
                }
            }
        }
    }

    private _findTreeItemBySessionId(sessionId: string): RtcSessionTreeItem | null {
        for (const item of this._getVisibleTreeItems()) {
            if (item.node.session.clientId === sessionId) return item;
        }
        return null;
    }

    private _ensureInitialFocus() {
        if (this._focusedSessionId) return;
        const items = this._getVisibleTreeItems();
        if (items.length === 0) return;
        const target = this.selectedSessionId && this._findTreeItemBySessionId(this.selectedSessionId)
            ? this.selectedSessionId
            : items[0].node.session.clientId;
        this._focusedSessionId = target;
        const item = this._findTreeItemBySessionId(target);
        if (item) {
            const content = item.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
            if (content) content.tabIndex = 0;
        }
    }

    private _handleKeydown(e: KeyboardEvent) {
        const items = this._getVisibleTreeItems();
        if (items.length === 0) return;

        const currentId = this._focusedSessionId ?? this.selectedSessionId;
        const currentIndex = currentId
            ? items.findIndex(it => it.node.session.clientId === currentId)
            : -1;

        let handled = true;

        switch (e.key) {
            case 'ArrowDown': {
                const next = Math.min(currentIndex + 1, items.length - 1);
                this._setFocusedSessionId(items[next].node.session.clientId);
                break;
            }
            case 'ArrowUp': {
                const prev = Math.max(currentIndex - 1, 0);
                this._setFocusedSessionId(items[prev].node.session.clientId);
                break;
            }
            case 'ArrowRight': {
                if (currentIndex >= 0) {
                    const item = items[currentIndex];
                    if (item.node.children.length > 0 && !item.node.isExpanded) {
                        this._treeCtx.actions.expand(item.node.session.clientId);
                    }
                }
                break;
            }
            case 'ArrowLeft': {
                if (currentIndex >= 0) {
                    const item = items[currentIndex];
                    if (item.node.children.length > 0 && item.node.isExpanded) {
                        this._treeCtx.actions.collapse(item.node.session.clientId);
                    }
                }
                break;
            }
            case 'Enter':
            case ' ': {
                if (currentIndex >= 0) {
                    const item = items[currentIndex];
                    const sessionId = item.node.session.clientId;
                    this.dispatchEvent(
                        new CustomEvent('rtc-session-tree-select', {
                            bubbles: true,
                            composed: true,
                            detail: {sessionId},
                        })
                    );
                }
                break;
            }
            case 'Home': {
                this._setFocusedSessionId(items[0].node.session.clientId);
                break;
            }
            case 'End': {
                this._setFocusedSessionId(items[items.length - 1].node.session.clientId);
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
            log.warn('_renderTree: treeCtx or state is undefined, rendering empty state');
            return this._renderEmptyState();
        }
        const {rootNodes} = this._treeCtx.state;
        if (rootNodes.length === 0) return this._renderEmptyState();

        return rootNodes.map(
            node => html`
                <rtc-session-tree-item
                    .node=${node}
                    .depth=${0}
                    theme=${this.theme}
                    selected-session-id=${this.selectedSessionId ?? ''}
                    @rtc-session-tree-item-select=${this._handleSelect}
                    @rtc-session-tree-item-toggle=${this._handleToggle}
                    @rtc-session-tree-item-rename=${this._handleItemRename}
                    @rtc-session-tree-item-delete=${this._handleItemDelete}
                ></rtc-session-tree-item>
            `
        );
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
                @keydown=${this._handleKeydown}
            >
                ${this._renderTree()}
            </div>
        `;
    }

    updated(changed: Map<string, unknown>) {
        super.updated(changed);
        if (changed.has('_treeCtx') || changed.has('selectedSessionId')) {
            this._ensureInitialFocus();
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-session-tree': RtcSessionTree;
    }

    interface HTMLElementEventMap {
        'rtc-session-tree-select': CustomEvent<{sessionId: string}>;
        'rtc-session-tree-toggle': CustomEvent<{sessionId: string}>;
        'rtc-session-tree-new': CustomEvent<void>;
        'rtc-session-rename-confirmed': CustomEvent<{sessionId: string; title: string}>;
        'rtc-session-delete-requested': CustomEvent<{sessionId: string}>;
    }
}
