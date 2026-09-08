/**
 * Editor Tab Component
 *
 * VS Code 风格编辑器标签页。
 *
 * - 显示文件图标（按扩展名区分）+ 文件名 + 关闭按钮
 * - 活动状态：顶部 1px 主色指示条
 * - 脏状态：未保存时显示圆点，悬停时切换为关闭按钮
 * - 文件名超长省略号
 *
 * ARIA: roving tabindex — 活动标签 tabindex=0，其余 -1。
 * ←/→ 箭头键在标签间切换，Home/End 跳到首/末标签。
 *
 * @element rtc-editor-tab
 * @fires editor-tab-select - 点击标签切换 (detail: { filePath })
 * @fires editor-tab-close - 点击关闭按钮 (detail: { filePath })
 *
 * ## 样式
 * 使用项目 design tokens（--rtc-color-*），支持亮色/暗色主题。
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg, str} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-editor-tab.styles.js';
import {
    closeIcon,
    fileMarkdownIcon,
    fileScriptIcon,
    fileDefaultIcon,
} from '../../icons/index.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';

@localized()
@customElement('rtc-editor-tab')
export class RtcEditorTab extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── i18n ── */

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-editor-tab] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** 文件路径（唯一标识） */
    @property({type: String, attribute: 'file-path'})
    filePath = '';

    /** 文件名（显示用，不含路径） */
    @property({type: String, attribute: 'file-name'})
    fileName = '';

    /** 是否为活动标签 */
    @property({type: Boolean, reflect: true})
    active = false;

    /** 是否有未保存修改 */
    @property({type: Boolean, reflect: true})
    dirty = false;

    /** 主题（继承自父级） */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Event Handlers ── */

    /**
     * 点击标签 → 切换活动
     */
    private _handleSelect() {
        this.dispatchEvent(
            new CustomEvent('editor-tab-select', {
                bubbles: true,
                composed: true,
                detail: {filePath: this.filePath},
            })
        );
    }

    /**
     * 点击关闭按钮 → 关闭标签
     *
     * stopPropagation 防止冒泡到标签的 select 事件。
     */
    private _handleClose(e: Event) {
        e.stopPropagation();
        this.dispatchEvent(
            new CustomEvent('editor-tab-close', {
                bubbles: true,
                composed: true,
                detail: {filePath: this.filePath},
            })
        );
    }

    /**
     * 键盘事件
     *
     * - Enter/Space：选中当前标签
     * - ←/→：在兄弟标签间移动焦点（roving tabindex）
     * - Home/End：跳到首/末标签
     */
    private _handleKeydown(e: KeyboardEvent) {
        const siblings = this._getSiblingTabs();
        const idx = siblings.indexOf(this);

        let handled = true;

        switch (e.key) {
            case 'ArrowLeft': {
                if (siblings.length > 1) {
                    const prev = siblings[(idx - 1 + siblings.length) % siblings.length];
                    prev.focusTab();
                    prev._handleSelect();
                }
                break;
            }
            case 'ArrowRight': {
                if (siblings.length > 1) {
                    const next = siblings[(idx + 1) % siblings.length];
                    next.focusTab();
                    next._handleSelect();
                }
                break;
            }
            case 'Home': {
                if (siblings.length > 0) {
                    siblings[0].focusTab();
                    siblings[0]._handleSelect();
                }
                break;
            }
            case 'End': {
                if (siblings.length > 0) {
                    siblings[siblings.length - 1].focusTab();
                    siblings[siblings.length - 1]._handleSelect();
                }
                break;
            }
            case 'Enter':
            case ' ':
                this._handleSelect();
                break;
            default:
                handled = false;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    /**
     * 获取兄弟标签列表（在父容器的 light DOM 中）
     */
    private _getSiblingTabs(): RtcEditorTab[] {
        const parent = this.parentElement;
        if (!parent) return [this];
        return Array.from(parent.querySelectorAll(':scope > rtc-editor-tab')) as RtcEditorTab[];
    }

    /**
     * 聚焦此标签（由兄弟标签或父级在键盘导航时调用）
     */
    focusTab() {
        const el = this.shadowRoot?.querySelector('.tab') as HTMLElement | null;
        el?.focus();
    }

    /* ── Render Helpers ── */

    /**
     * 根据文件扩展名返回对应图标
     */
    private _getFileIcon() {
        const name = this.fileName.toLowerCase();
        if (name.endsWith('.md')) {
            return fileMarkdownIcon;
        }
        if (name.endsWith('.js') || name.endsWith('.ts')) {
            return fileScriptIcon;
        }
        return fileDefaultIcon;
    }

    /**
     * 返回图标 CSS 类名
     */
    private _getIconClass(): string {
        const name = this.fileName.toLowerCase();
        if (name.endsWith('.md')) {
            return 'file-md';
        }
        if (name.endsWith('.js') || name.endsWith('.ts')) {
            return 'file-js';
        }
        return 'file';
    }

    /* ── Main Render ── */

    render() {
        void this._localeCtx.locale;
        const tabClass = [
            'tab',
            this.active ? 'active' : '',
            this.dirty ? 'dirty' : '',
        ].filter(Boolean).join(' ');

        return html`
            <div
                class=${tabClass}
                role="tab"
                tabindex="${this.active ? 0 : -1}"
                aria-selected=${this.active}
                aria-label=${this.fileName}
                title=${this.filePath}
                @click=${this._handleSelect}
                @keydown=${this._handleKeydown}
            >
                <span class="icon ${this._getIconClass()}">
                    ${this._getFileIcon()}
                </span>

                <span class="name">${this.fileName}</span>

                ${this.dirty
                    ? html`<span class="dirty-dot" aria-label=${msg('未保存')}></span>`
                    : ''}

                <span
                    class="close-btn"
                    role="button"
                    tabindex="0"
                    aria-label=${msg(str`关闭 ${this.fileName}`)}
                    @click=${this._handleClose}
                    @keydown=${(e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            this._handleClose(e);
                        }
                    }}
                >${closeIcon}</span>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-editor-tab': RtcEditorTab;
    }

    interface HTMLElementEventMap {
        'editor-tab-select': CustomEvent<{filePath: string}>;
        'editor-tab-close': CustomEvent<{filePath: string}>;
    }
}
