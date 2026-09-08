/**
 * File Tree Item Component
 *
 * 递归文件树节点组件，用于显示文件夹和文件。
 *
 * - 文件夹：显示 chevron + 文件夹图标 + 名称，可展开/折叠
 * - 文件：显示缩进 + 文件图标 + 名称
 * - 从 FileExplorerContext 读取展开/选中/加载状态
 * - 递归渲染子节点
 *
 * ARIA: role="treeitem"，由父级 Explorer 管理 tabindex（roving）与焦点。
 *
 * @element rtc-file-tree-item
 * @fires file-tree-item-toggle - 点击文件夹展开/折叠（detail: { path }）
 * @fires file-tree-item-select - 点击文件/文件夹选中（detail: { path }）
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

/**
 * Chevron 右箭头 SVG（内联，无依赖）
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
            console.warn('[rtc-file-tree-item] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** 文件树节点数据 */
    @property({type: Object})
    node: FileNode = {path: '/', name: 'root', type: 'folder'};

    /** 缩进层级（0 = 根） */
    @property({type: Number})
    depth = 0;

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

    /* ── Computed Properties ── */

    private get _isExpanded(): boolean {
        return this._explorerCtx.isExpanded(this.node.path);
    }

    /** 公开给父级 Explorer 用于键盘导航 composed walk */
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

    /** 公开给父级 Explorer 用于键盘导航 composed walk */
    get isFolder(): boolean {
        return this._isFolder;
    }

    /**
     * 聚焦内部 content div（由父级 Explorer 在键盘导航时调用）
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
        // 文件夹：点击行同时 toggle 展开/折叠（VS Code 行为）
        if (this._isFolder) {
            this._explorerCtx.actions.toggleNode(this.node.path);
            // 触发 toggle 事件，用于懒加载子节点
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
     * 根据文件扩展名返回对应图标
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
     * 渲染文件夹图标
     */
    private _renderFolderIcon() {
        return this._isExpanded ? folderOpenIcon : folderClosedIcon;
    }

    /**
     * 渲染 chevron（仅文件夹）
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
     * 渲染加载指示器
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
     * 返回图标 CSS 类名
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
