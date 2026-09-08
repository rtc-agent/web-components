/**
 * Session Tree 容器组件
 *
 * VS Code 风格会话树侧边栏。
 * 组合 rtc-session-tree-item 递归叶子组件，显示完整的会话层级树。
 *
 * - Header：标题 + 操作按钮（新建会话）
 * - Content：递归渲染 rtc-session-tree-item
 * - Empty State：无会话时显示提示
 *
 * 通过 SessionTreeContext 消费树数据和展开/折叠操作。
 *
 * @element rtc-session-tree
 * @fires rtc-session-tree-select - 用户点击会话 (detail: { sessionId })
 * @fires rtc-session-tree-toggle - 用户点击展开/折叠 (detail: { sessionId })
 * @fires rtc-session-tree-new - 用户点击新建按钮
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
import {plusIcon, refreshIcon, deleteIcon} from '../../icons/index.js';

// 子组件（副作用导入）
import './rtc-session-tree-item.js';
import type {RtcSessionTreeItem} from './rtc-session-tree-item.js';

@localized()
@customElement('rtc-session-tree')
export class RtcSessionTree extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[RtcSessionTree] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** 主题（继承自父级） */
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

    /** 当前选中的 sessionId */
    @property({type: String, attribute: 'selected-session-id'})
    selectedSessionId: string | null = null;

    /** 当前键盘焦点所在的 sessionId（roving tabindex 管理） */
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
        // Session 列表由 UIUpdateBus 实时同步（服务端变更自动推送），无手动刷新逻辑。
        // 保留按钮但给出提示，避免用户困惑。未来若需要强制拉取可在此处接入。
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

    private _handleDelete() {
        if (!this.selectedSessionId) {
            console.warn('[rtc-session-tree] delete clicked but no session selected');
            return;
        }
        console.log('[rtc-session-tree] delete requested for session:', this.selectedSessionId);
        // 向上冒泡，由 rtc-agent 根组件监听后调用 SessionController.deleteSession
        this.dispatchEvent(
            new CustomEvent('rtc-session-delete-requested', {
                bubbles: true,
                composed: true,
                detail: {sessionId: this.selectedSessionId},
            })
        );
    }

    /* ── 键盘导航 ──
     *
     * ARIA Treeview 模式：roving tabindex。
     * 方向键在可见项列表中移动焦点，Enter/Space 激活。
     */

    /**
     * 深度优先遍历可见（展开的）树节点，返回扁平列表。
     * 通过 composed tree walk 穿越递归 Shadow DOM。
     */
    private _getVisibleTreeItems(): RtcSessionTreeItem[] {
        const result: RtcSessionTreeItem[] = [];
        const walk = (parent: Element | ShadowRoot) => {
            for (const child of Array.from(parent.children)) {
                if (child.tagName === 'RTC-SESSION-TREE-ITEM') {
                    const item = child as RtcSessionTreeItem;
                    result.push(item);
                    // 仅展开的节点才递归子节点
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
        // 清除旧焦点项
        if (this._focusedSessionId) {
            const oldItem = this._findTreeItemBySessionId(this._focusedSessionId);
            if (oldItem) {
                const oldContent = oldItem.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
                if (oldContent) oldContent.tabIndex = -1;
            }
        }
        this._focusedSessionId = sessionId;
        // 设置新焦点项
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
                    <button
                        class="action-btn action-btn--danger"
                        title=${msg('删除当前会话')}
                        aria-label=${msg('删除当前会话')}
                        ?disabled=${!this.selectedSessionId}
                        @click=${this._handleDelete}
                    >${deleteIcon}</button>
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
    }
}
