/**
 * File Tree Item Component
 *
 * Recursive file tree node component for displaying folders and files.
 *
 * - Folders: display chevron + folder icon + name, expandable/collapsible
 * - Files: display indent + file icon + name
 * - Reads expand/select/loading state from FileExplorerContext
 * - Recursively renders child nodes
 *
 * ARIA: role="treeitem", parent Explorer manages tabindex (roving) and focus.
 *
 * @element rtc-file-tree-item
 * @fires file-tree-item-toggle - Clicked folder to expand/collapse (detail: { path })
 * @fires file-tree-item-select - Clicked file/folder to select (detail: { path })
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-file-tree-item.styles.js';
import {FileExplorerContext, type FileExplorerContextValue} from '../../contexts/file-explorer.js';
import type {FileNode} from '../../types/index.js';
import {
    folderClosedIcon,
    folderOpenIcon,
    fileMarkdownIcon,
    fileScriptIcon,
    fileDefaultIcon,
} from '../../icons/index.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('FileTreeItem');

/**
 * Chevron right arrow SVG (inline, no dependencies)
 */
const chevronRightSvg = html`
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d="M4.5 2l4 4-4 4V2z"/>
    </svg>
`;

@localized()
@customElement('rtc-file-tree-item')
export class RtcFileTreeItem extends LitElement {
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

    /** File tree node data */
    @property({type: Object})
    node: FileNode = {path: '/', name: 'root', type: 'folder'};

    /** Indentation level (0 = root) */
    @property({type: Number})
    depth = 0;

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

    /* ── Computed Properties ── */

    private get _isExpanded(): boolean {
        return this._explorerCtx.isExpanded(this.node.path);
    }

    /** Exposed to parent Explorer for keyboard navigation composed walk */
    get expanded(): boolean {
        return this._isExpanded;
    }

    private get _isLoading(): boolean {
        return this._explorerCtx.isLoading(this.node.path);
    }

    private get _isSelected(): boolean {
        return this._explorerCtx.isSelected(this.node.path);
    }

    private get _isFolder(): boolean {
        return this.node.type === 'folder';
    }

    /** Exposed to parent Explorer for keyboard navigation composed walk */
    get isFolder(): boolean {
        return this._isFolder;
    }

    /**
     * Focus the inner content div (called by parent Explorer during keyboard navigation)
     */
    focusContent() {
        const el = this.shadowRoot?.querySelector('.tree-item-content') as HTMLElement | null;
        el?.focus();
    }

    /* ── Event Handlers ── */

    private _handleToggle(e: Event) {
        e.stopPropagation();
        if (this._isFolder) {
            this._explorerCtx.actions.toggleNode(this.node.path);
            this.dispatchEvent(
                new CustomEvent('file-tree-item-toggle', {
                    bubbles: true,
                    composed: true,
                    detail: {path: this.node.path},
                })
            );
        }
    }

    private _handleSelect() {
        this._explorerCtx.actions.selectNode(this.node.path);
        // Folder: clicking the row also toggles expand/collapse (VS Code behavior)
        if (this._isFolder) {
            this._explorerCtx.actions.toggleNode(this.node.path);
            // Dispatch toggle event for lazy-loading child nodes
            this.dispatchEvent(
                new CustomEvent('file-tree-item-toggle', {
                    bubbles: true,
                    composed: true,
                    detail: {path: this.node.path},
                })
            );
        }
        this.dispatchEvent(
            new CustomEvent('file-tree-item-select', {
                bubbles: true,
                composed: true,
                detail: {path: this.node.path, type: this.node.type},
            })
        );
    }

    /* ── Render Helpers ── */

    /**
     * Returns the corresponding icon based on file extension
     */
    private _getFileIcon() {
        const name = this.node.name.toLowerCase();
        if (name.endsWith('.md')) {
            return fileMarkdownIcon;
        }
        if (name.endsWith('.js') || name.endsWith('.ts')) {
            return fileScriptIcon;
        }
        return fileDefaultIcon;
    }

    /**
     * Render folder icon
     */
    private _renderFolderIcon() {
        return this._isExpanded ? folderOpenIcon : folderClosedIcon;
    }

    /**
     * Render chevron (folders only)
     */
    private _renderChevron() {
        return html`
            <span
                class="chevron ${this._isExpanded ? 'expanded' : ''}"
                @click=${this._handleToggle}
            >
                ${chevronRightSvg}
            </span>
        `;
    }

    /**
     * Render loading indicator
     */
    private _renderSpinner() {
        if (!this._isLoading) return nothing;
        return html`<span class="spinner"></span>`;
    }

    /* ── Main Render ── */

    render() {
        void this._localeCtx.locale;
        const paddingLeft = `${this.depth * 16 + 8}px`;
        const ariaExpanded = this._isFolder ? String(this._isExpanded) : null;

        return html`
            <div class="tree-item">
                <div
                    class="tree-item-content ${this._isSelected ? 'selected' : ''}"
                    style="padding-left: ${paddingLeft}"
                    role="treeitem"
                    tabindex="-1"
                    aria-expanded=${ariaExpanded}
                    aria-selected=${this._isSelected ? 'true' : 'false'}
                    @click=${this._handleSelect}
                >
                    ${this._isFolder
                        ? this._renderChevron()
                        : html`<span class="indent"></span>`}

                    <span class="icon ${this._getIconClass()}">
                        ${this._isFolder ? this._renderFolderIcon() : this._getFileIcon()}
                    </span>

                    <span class="label">${this.node.name}</span>
                    ${this._renderSpinner()}
                </div>

                ${this._isFolder && this._isExpanded && this.node.children
                    ? html`
                        <div class="children" role="group">
                            ${this.node.children.map(
                                child => html`
                                    <rtc-file-tree-item
                                        .node=${child}
                                        .depth=${this.depth + 1}
                                        theme=${this.theme}
                                    ></rtc-file-tree-item>
                                `
                            )}
                        </div>
                    `
                    : nothing}
            </div>
        `;
    }

    /**
     * Returns icon CSS class name
     */
    private _getIconClass(): string {
        if (this._isFolder) {
            return this._isExpanded ? 'folder-open' : 'folder';
        }
        const name = this.node.name.toLowerCase();
        if (name.endsWith('.md')) {
            return 'file-md';
        }
        if (name.endsWith('.js') || name.endsWith('.ts')) {
            return 'file-js';
        }
        return 'file';
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-file-tree-item': RtcFileTreeItem;
    }
}
