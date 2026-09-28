/**
 * Editor Tab Component
 *
 * VS Code-style editor tab.
 *
 * - Shows file icon (by extension) + file name + close button
 * - Active state: 1px accent indicator bar at the top
 * - Dirty state: shows a dot when unsaved, switches to close button on hover
 * - Long file names truncated with ellipsis
 *
 * ARIA: roving tabindex — active tab has tabindex=0, others -1.
 * Arrow Left/Right moves focus between tabs, Home/End jumps to first/last tab.
 *
 * @element rtc-editor-tab
 * @fires editor-tab-select - Fired when tab is clicked to switch (detail: { filePath })
 * @fires editor-tab-close - Fired when close button is clicked (detail: { filePath })
 *
 * ## Styles
 * Uses project design tokens (--rtc-color-*), supports light/dark themes.
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
import { createLogger } from '@rtc-agent/client';

const log = createLogger('EditorTab');

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
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** File path (unique identifier) */
    @property({type: String, attribute: 'file-path'})
    filePath = '';

    /** File name (for display, without path) */
    @property({type: String, attribute: 'file-name'})
    fileName = '';

    /** Whether this is the active tab */
    @property({type: Boolean, reflect: true})
    active = false;

    /** Whether there are unsaved changes */
    @property({type: Boolean, reflect: true})
    dirty = false;

    /** Theme (inherited from parent) */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Event Handlers ── */

    /**
     * Click tab -> toggle active state
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
     * Click close button -> close tab
     *
     * stopPropagation prevents bubbling to the tab's select event.
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
     * Keyboard event handler
     *
     * - Enter/Space: select current tab
     * - Arrow Left/Right: move focus between sibling tabs (roving tabindex)
     * - Home/End: jump to first/last tab
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
     * Get list of sibling tabs (in parent container's light DOM)
     */
    private _getSiblingTabs(): RtcEditorTab[] {
        const parent = this.parentElement;
        if (!parent) return [this];
        return Array.from(parent.querySelectorAll(':scope > rtc-editor-tab')) as RtcEditorTab[];
    }

    /**
     * Focus this tab (called by sibling tabs or parent during keyboard navigation)
     */
    focusTab() {
        const el = this.shadowRoot?.querySelector('.tab') as HTMLElement | null;
        el?.focus();
    }

    /* ── Render Helpers ── */

    /**
     * Returns the appropriate icon based on file extension
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
     * Returns the icon CSS class name
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
