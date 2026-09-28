/**
 * Session Tree Item — a single session tree node
 *
 * Recursive rendering: if node has children and isExpanded, renders child node list.
 * Root nodes display a folder icon, leaf nodes display a session icon.
 *
 * Style patterns fully reference rtc-file-tree-item.ts.
 *
 * @element rtc-session-tree-item
 * @fires rtc-session-tree-item-select - Clicked on session (detail: { sessionId })
 * @fires rtc-session-tree-item-toggle - Clicked expand/collapse (detail: { sessionId })
 * @fires rtc-session-tree-item-rename - Confirmed rename (detail: { sessionId, title })
 * @fires rtc-session-tree-item-delete - Clicked delete (detail: { sessionId })
 */
import {LitElement, html, nothing, svg} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {styles} from './rtc-session-tree-item.styles.js';
import {
    folderOpenIcon,
    folderClosedIcon,
    chatIcon,
    editIcon,
    deleteIcon,
    checkIcon,
    closeIcon,
} from '../../icons/index.js';
import {formatRelativeTime} from '../../utils/relative-time.js';
import type {SessionTreeNode} from '../../types/index.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('SessionTreeItem');

// Inline chevron SVG (consistent with rtc-file-tree-item)
const chevronSvg = svg`<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

@localized()
@customElement('rtc-session-tree-item')
export class RtcSessionTreeItem extends LitElement {
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

    @property({type: Object})
    node!: SessionTreeNode;

    @property({type: Number})
    depth = 0;

    @property({type: String, attribute: 'selected-session-id'})
    selectedSessionId: string | null = null;

    /** Theme: light / dark / system */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /** Inline rename mode */
    @state()
    private _isRenaming = false;

    @state()
    private _renameValue = '';

    private _handleClick() {
        // Don't respond to main click in rename mode
        if (this._isRenaming) return;
        // Clicking on main area (including folders and leaves) only selects, doesn't expand/collapse
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

    private _handleRenameClick(e: Event) {
        e.stopPropagation();
        this._renameValue = this.node.session.title || '';
        this._isRenaming = true;
        // Focus input on next frame
        requestAnimationFrame(() => {
            const input = this.shadowRoot?.querySelector('.rename-input') as HTMLInputElement | null;
            input?.focus();
            input?.select();
        });
    }

    private _handleRenameConfirm(e: Event) {
        e.stopPropagation();
        const title = this._renameValue.trim();
        if (!title) {
            // Cancel instead of confirming when title is empty
            this._handleRenameCancel(e);
            return;
        }
        this._isRenaming = false;
        this.dispatchEvent(
            new CustomEvent('rtc-session-tree-item-rename', {
                bubbles: true,
                composed: true,
                detail: {sessionId: this.node.session.clientId, title},
            })
        );
    }

    private _handleRenameCancel(e?: Event) {
        e?.stopPropagation();
        this._isRenaming = false;
        this._renameValue = '';
    }

    private _handleRenameKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this._handleRenameConfirm(e);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this._handleRenameCancel(e);
        }
    }

    private _handleDeleteClick(e: Event) {
        e.stopPropagation();
        this.dispatchEvent(
            new CustomEvent('rtc-session-tree-item-delete', {
                bubbles: true,
                composed: true,
                detail: {sessionId: this.node.session.clientId},
            })
        );
    }

    render() {
        void this._localeCtx.locale;
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
                    'renaming': this._isRenaming,
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
                ${this._isRenaming
                    ? html`
                        <input
                            class="rename-input"
                            type="text"
                            .value=${this._renameValue}
                            @input=${(e: Event) => { this._renameValue = (e.target as HTMLInputElement).value; }}
                            @keydown=${this._handleRenameKeydown}
                            @click=${(e: Event) => e.stopPropagation()}
                        />
                        <span class="rename-actions">
                            <button
                                class="rename-btn rename-btn--confirm"
                                title=${msg('确认')}
                                aria-label=${msg('确认重命名')}
                                @click=${this._handleRenameConfirm}
                            >${checkIcon}</button>
                            <button
                                class="rename-btn rename-btn--cancel"
                                title=${msg('取消')}
                                aria-label=${msg('取消重命名')}
                                @click=${this._handleRenameCancel}
                            >${closeIcon}</button>
                        </span>
                    `
                    : html`
                        <span class="label">${node.session.title || msg('未命名')}</span>
                        ${node.session.updatedAt
                            ? html`<span class="timestamp">${formatRelativeTime(node.session.updatedAt, this._localeCtx.locale)}</span>`
                            : nothing}
                        <span class="actions">
                            <button
                                class="action-btn"
                                title=${msg('重命名')}
                                aria-label=${msg('重命名')}
                                @click=${this._handleRenameClick}
                            >${editIcon}</button>
                            <button
                                class="action-btn action-btn--danger"
                                title=${msg('删除')}
                                aria-label=${msg('删除')}
                                @click=${this._handleDeleteClick}
                            >${deleteIcon}</button>
                        </span>
                    `
                }
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
                                    @rtc-session-tree-item-rename=${(e: CustomEvent) =>
                                        this.dispatchEvent(
                                            new CustomEvent('rtc-session-tree-item-rename', {
                                                bubbles: true,
                                                composed: true,
                                                detail: e.detail,
                                            })
                                        )}
                                    @rtc-session-tree-item-delete=${(e: CustomEvent) =>
                                        this.dispatchEvent(
                                            new CustomEvent('rtc-session-tree-item-delete', {
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
