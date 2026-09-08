/**
 * RTC Settings Nav Component
 *
 * 左栏分类导航，支持键盘导航（Arrow Up/Down, Home/End, Enter/Space）。
 * 使用 roving tabindex 模式。
 *
 * @element rtc-settings-nav
 * @fires settings-nav-change - 分类切换时触发 (detail: { category })
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import type {TemplateResult} from 'lit';
import {styles} from './rtc-settings-nav.styles.js';
import {
    gearIcon,
    chatIcon,
    filesIcon,
    checklistIcon,
    codeIcon,
} from '../../icons/index.js';

/** 设置分类 */
export type SettingsCategory = 'appearance' | 'chat' | 'files' | 'notifications' | 'account' | 'about';

/** Person icon (inline SVG) for the account category */
const personIcon = html`<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm.5 3H5a3 3 0 0 0-3 3v2h12v-2a3 3 0 0 0-3-3z"/></svg>`;

/** 分类定义 */
interface CategoryDef {
    id: SettingsCategory;
    label: string;
    icon: TemplateResult;
}

const CATEGORIES: CategoryDef[] = [
    {id: 'appearance', label: '外观', icon: gearIcon},
    {id: 'chat', label: '聊天', icon: chatIcon},
    {id: 'files', label: '文件', icon: filesIcon},
    {id: 'notifications', label: '通知', icon: checklistIcon},
    {id: 'account', label: '账户', icon: personIcon},
    {id: 'about', label: '关于', icon: codeIcon},
];

@customElement('rtc-settings-nav')
export class RtcSettingsNav extends LitElement {
    static styles = styles;

    /** delegatesFocus: true — 支持键盘焦点委托 */
    static shadowRootOptions = {
        ...LitElement.shadowRootOptions,
        delegatesFocus: true,
    };

    /** 当前选中的分类 */
    @property({type: String, reflect: true})
    active: SettingsCategory = 'appearance';

    /** 处理分类点击 */
    private _handleClick(category: SettingsCategory) {
        if (category === this.active) return;
        this.dispatchEvent(
            new CustomEvent('settings-nav-change', {
                bubbles: true,
                composed: true,
                detail: {category},
            })
        );
    }

    /**
     * 键盘事件处理
     *
     * - ↑/↓：在分类间移动焦点（roving tabindex）
     * - Home/End：跳到首/末项
     * - Enter/Space：激活当前分类
     */
    private _handleKeydown(e: KeyboardEvent, current: SettingsCategory) {
        const items = CATEGORIES;
        const idx = items.findIndex((c) => c.id === current);
        let handled = true;

        switch (e.key) {
            case 'ArrowDown': {
                const next = items[(idx + 1) % items.length];
                this._focusCategory(next.id);
                break;
            }
            case 'ArrowUp': {
                const prev = items[(idx - 1 + items.length) % items.length];
                this._focusCategory(prev.id);
                break;
            }
            case 'Home': {
                this._focusCategory(items[0].id);
                break;
            }
            case 'End': {
                this._focusCategory(items[items.length - 1].id);
                break;
            }
            case 'Enter':
            case ' ':
                this._handleClick(current);
                break;
            default:
                handled = false;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    /** 将焦点移到指定分类 */
    private _focusCategory(category: SettingsCategory) {
        const el = this.shadowRoot?.querySelector(
            `[data-category="${category}"]`
        ) as HTMLElement | null;
        el?.focus();
    }

    /** 计算 roving tabindex */
    private _tabIndex(category: SettingsCategory): number {
        return category === this.active ? 0 : -1;
    }

    /**
     * Lit lifecycle: 属性更新后调用。
     *
     * 当 `active` 被外部直接修改时（如调试工具、父组件设置属性），
     * 主动派发事件通知父组件同步状态，确保 tabpanel 的 aria-labelledby
     * 始终指向正确的面板标题。
     */
    updated(changedProperties: Map<string, unknown>) {
        if (changedProperties.has('active')) {
            this.dispatchEvent(
                new CustomEvent('settings-nav-change', {
                    bubbles: true,
                    composed: true,
                    detail: {category: this.active},
                })
            );
        }
    }

    render() {
        return html`
            <div role="tablist" aria-orientation="vertical" aria-label="设置分类">
                ${CATEGORIES.map(
                    (cat) => html`
                        <button
                            class="nav-item"
                            data-category=${cat.id}
                            role="tab"
                            tabindex=${this._tabIndex(cat.id)}
                            aria-selected=${cat.id === this.active}
                            @click=${() => this._handleClick(cat.id)}
                            @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, cat.id)}
                        >
                            <span class="nav-icon">${cat.icon}</span>
                            <span class="nav-label">${cat.label}</span>
                        </button>
                    `
                )}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-settings-nav': RtcSettingsNav;
    }

    interface HTMLElementEventMap {
        'settings-nav-change': CustomEvent<{category: SettingsCategory}>;
    }
}
