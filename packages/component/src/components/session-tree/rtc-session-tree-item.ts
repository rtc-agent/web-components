/**
 * Session Tree Item — 单个会话树节点
 *
 * 递归渲染：如果 node 有 children 且 isExpanded，渲染子节点列表。
 * 根节点显示文件夹图标，叶子节点显示会话图标。
 *
 * 样式模式完全参考 rtc-file-tree-item.ts。
 *
 * @element rtc-session-tree-item
 * @fires rtc-session-tree-item-select - 点击会话（detail: { sessionId }）
 * @fires rtc-session-tree-item-toggle - 点击展开/折叠（detail: { sessionId }）
 */
import {LitElement, html, nothing, svg} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {styles} from './rtc-session-tree-item.styles.js';
import {
    folderOpenIcon,
    folderClosedIcon,
    chatIcon,
} from '../../icons/index.js';
import {formatRelativeTime} from '../../utils/relative-time.js';
import type {SessionTreeNode} from '../../types/index.js';

// 内联 chevron SVG（与 rtc-file-tree-item 保持一致）
const chevronSvg = svg`<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

@customElement('rtc-session-tree-item')
export class RtcSessionTreeItem extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    @property({type: Object})
    node!: SessionTreeNode;

    @property({type: Number})
    depth = 0;

    @property({type: String, attribute: 'selected-session-id'})
    selectedSessionId: string | null = null;

    /** 主题：light / dark / system */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    private _handleClick() {
        // 点击主体（包括文件夹和叶子）只选中，不展开/折叠
        this.dispatchEvent(
            new CustomEvent('rtc-session-tree-item-select', {
                bubbles: true,
                composed: true,
                detail: {sessionId: this.node.session.clientId},
            })
        );
    }

    private _handleToggle(e: Event) {
        e.stopPropagation();
        this.dispatchEvent(
            new CustomEvent('rtc-session-tree-item-toggle', {
                bubbles: true,
                composed: true,
                detail: {sessionId: this.node.session.clientId},
            })
        );
    }

    render() {
        const node = this.node;
        const hasChildren = node.children.length > 0;
        const isSelected = this.selectedSessionId === node.session.clientId;
        const isRoot = this.depth === 0;
        const paddingLeft = `${this.depth * 16 + 8}px`;

        return html`
            <div
                class=${classMap({
                    'tree-item-content': true,
                    'selected': isSelected,
                })}
                style="padding-left: ${paddingLeft}"
                role="treeitem"
                aria-expanded=${hasChildren ? node.isExpanded : nothing}
                aria-selected=${isSelected}
                tabindex="0"
                @click=${this._handleClick}
            >
                ${hasChildren
                    ? html`<span
                          class=${classMap({
                              'chevron': true,
                              'expanded': node.isExpanded,
                          })}
                          @click=${this._handleToggle}
                      >${chevronSvg}</span>`
                    : html`<span class="indent"></span>`
                }
                <span class=${classMap({
                    'icon': true,
                    'folder': isRoot && !node.isExpanded,
                    'folder-open': isRoot && node.isExpanded,
                    'session': !isRoot,
                })}>
                    ${isRoot
                        ? (node.isExpanded ? folderOpenIcon : folderClosedIcon)
                        : chatIcon}
                </span>
                ${!isRoot
                    ? html`<span
                          class=${classMap({
                              'status-dot': true,
                              'active': node.session.status === 'active',
                              'closed': node.session.status === 'closed',
                          })}
                          aria-hidden="true"
                      ></span>`
                    : nothing}
                <span class="label">${node.session.title || 'Untitled'}</span>
                ${node.session.updatedAt
                    ? html`<span class="timestamp">${formatRelativeTime(node.session.updatedAt)}</span>`
                    : nothing}
            </div>
            ${hasChildren && node.isExpanded
                ? html`
                    <div class="children" role="group">
                        ${node.children.map(
                            child => html`
                                <rtc-session-tree-item
                                    .node=${child}
                                    .depth=${this.depth + 1}
                                    .theme=${this.theme}
                                    selected-session-id=${this.selectedSessionId ?? ''}
                                    @rtc-session-tree-item-select=${(e: CustomEvent) =>
                                        this.dispatchEvent(
                                            new CustomEvent('rtc-session-tree-item-select', {
                                                bubbles: true,
                                                composed: true,
                                                detail: e.detail,
                                            })
                                        )}
                                    @rtc-session-tree-item-toggle=${(e: CustomEvent) =>
                                        this.dispatchEvent(
                                            new CustomEvent('rtc-session-tree-item-toggle', {
                                                bubbles: true,
                                                composed: true,
                                                detail: e.detail,
                                            })
                                        )}
                                ></rtc-session-tree-item>
                            `
                        )}
                    </div>
                  `
                : nothing}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-session-tree-item': RtcSessionTreeItem;
    }
}
