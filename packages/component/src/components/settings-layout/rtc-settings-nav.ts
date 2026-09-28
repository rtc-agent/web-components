/**
 * RTC Settings Nav Component
 *
 * Left-column category navigation, supports keyboard navigation (Arrow Up/Down, Home/End, Enter/Space).
 * Uses roving tabindex pattern.
 *
 * @element rtc-settings-nav
 * @fires settings-nav-change - Fired when category changes (detail: { category })
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import type {TemplateResult} from 'lit';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-settings-nav.styles.js';
import {
    gearIcon,
    chatIcon,
    filesIcon,
    checklistIcon,
    codeIcon,
} from '../../icons/index.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('SettingsNav');

/** Settings category */
export type SettingsCategory = 'appearance' | 'chat' | 'files' | 'notifications' | 'account' | 'about';

/** Person icon (inline SVG) for the account category */
const personIcon = html`<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm.5 3H5a3 3 0 0 0-3 3v2h12v-2a3 3 0 0 0-3-3z"/></svg>`;

/** Category definition */
interface CategoryDef {
    id: SettingsCategory;
    label: string;
    icon: TemplateResult;
}

function getCategories(): CategoryDef[] {
    return [
        {id: 'appearance', label: msg('外观'), icon: gearIcon},
        {id: 'chat', label: msg('聊天'), icon: chatIcon},
        {id: 'files', label: msg('文件'), icon: filesIcon},
        {id: 'notifications', label: msg('通知'), icon: checklistIcon},
        {id: 'account', label: msg('账户'), icon: personIcon},
        {id: 'about', label: msg('关于'), icon: codeIcon},
    ];
}

@localized()
@customElement('rtc-settings-nav')
export class RtcSettingsNav extends LitElement {
    static styles = styles;

    /** delegatesFocus: true — Supports keyboard focus delegation */
    static shadowRootOptions = {
        ...LitElement.shadowRootOptions,
        delegatesFocus: true,
    };

    /** Currently selected category */
    @property({type: String, reflect: true})
    active: SettingsCategory = 'appearance';

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /** Handle category click */
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
     * Keyboard event handler
     *
     * - Arrow Up/Down: move focus between categories (roving tabindex)
     * - Home/End: jump to first/last item
     * - Enter/Space: activate current category
     */
    private _handleKeydown(e: KeyboardEvent, current: SettingsCategory) {
        const items = getCategories();
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

    /** Move focus to specified category */
    private _focusCategory(category: SettingsCategory) {
        const el = this.shadowRoot?.querySelector(
            `[data-category="${category}"]`
        ) as HTMLElement | null;
        el?.focus();
    }

    /** Calculate roving tabindex */
    private _tabIndex(category: SettingsCategory): number {
        return category === this.active ? 0 : -1;
    }

    /**
     * Lit lifecycle: called after properties are updated.
     *
     * When `active` is modified externally (e.g., dev tools, parent component setting property),
     * proactively dispatches event to notify parent component to sync state, ensuring the
     * tabpanel's aria-labelledby always points to the correct panel title.
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
        void this._localeCtx.locale;
        return html`
            <div role="tablist" aria-orientation="vertical" aria-label="${msg('设置分类')}">
                ${getCategories().map(
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
