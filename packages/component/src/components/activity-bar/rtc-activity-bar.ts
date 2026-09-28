/**
 * RTC Activity Bar Component
 *
 * VS Code-style left activity bar, supporting switching between Explorer/Chat/Settings.
 *
 * @element rtc-activity-bar
 * @fires activity-change - Fired on activity switch (detail: { activity, toggleSidebar })
 *
 * ## Interaction logic
 * - Click current activity → toggle sidebar (dispatches activity-change event, toggleSidebar: true)
 * - Click different activity → switch activity and show sidebar (dispatches activity-change event, toggleSidebar: false)
 * - ↑/↓ arrow keys switch between icons (roving tabindex), Enter/Space to activate
 *
 * ## Styling
 * Uses project design tokens (--rtc-color-*), supports light/dark themes.
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {styles} from './rtc-activity-bar.styles.js';
import type {Activity} from '../../types/index.js';
import {
    filesIcon,
    chatIcon,
    gearIcon,
} from '../../icons/index.js';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('ActivityBar');

/** Focusable activity list (order: files → chat → settings) */
const ACTIVITY_LIST: Activity[] = ['files', 'chat', 'settings'];

@localized()
@customElement('rtc-activity-bar')
export class RtcActivityBar extends LitElement {
    static styles = styles;

    /** Current activity */
    @property({type: String, reflect: true})
    active: Activity = 'chat';

    /** Whether to show the Files button */
    @property({type: Boolean, attribute: 'show-files'})
    showFiles = true;

    /** Whether to show the Settings button */
    @property({type: Boolean, attribute: 'show-settings'})
    showSettings = true;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /**
     * Handle activity icon click
     *
     * Logic:
     * - Click current activity → toggleSidebar: true
     * - Click different activity → switch activity, toggleSidebar: false
     */
    private _handleClick(activity: Activity) {
        const isToggle = activity === this.active;
        this.dispatchEvent(
            new CustomEvent('activity-change', {
                bubbles: true,
                composed: true,
                detail: {
                    activity,
                    toggleSidebar: isToggle,
                },
            })
        );
    }

    /**
     * Keyboard event handling
     *
     * - ↑/↓: move focus between available activities (roving tabindex)
     * - Enter/Space: activate current activity
     * - Home/End: jump to first/last item
     */
    private _handleKeydown(e: KeyboardEvent, currentActivity: Activity) {
        const available = ACTIVITY_LIST;
        const idx = available.indexOf(currentActivity);

        let handled = true;

        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowRight': {
                const next = available[(idx + 1) % available.length];
                this._focusActivity(next);
                break;
            }
            case 'ArrowUp':
            case 'ArrowLeft': {
                const prev = available[(idx - 1 + available.length) % available.length];
                this._focusActivity(prev);
                break;
            }
            case 'Home': {
                this._focusActivity(available[0]);
                break;
            }
            case 'End': {
                this._focusActivity(available[available.length - 1]);
                break;
            }
            case 'Enter':
            case ' ':
                this._handleClick(currentActivity);
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
     * Move focus to a specific activity icon (roving tabindex)
     */
    private _focusActivity(activity: Activity) {
        const el = this.shadowRoot?.querySelector(`[data-activity="${activity}"]`) as HTMLElement | null;
        el?.focus();
    }

    /**
     * Compute roving tabindex: the currently active activity gets tabindex=0, others get -1
     */
    private _tabIndex(activity: Activity): number {
        return activity === this.active ? 0 : -1;
    }

    render() {
        // Reference locale to ensure re-render on locale change
        void this._localeCtx.locale;

        return html`
            <!-- Top activity -->
            <div
                class="activity-icon ${this.active === 'chat' ? 'active' : ''}"
                data-activity="chat"
                role="tab"
                tabindex="${this._tabIndex('chat')}"
                aria-label=${msg('聊天')}
                aria-selected="${this.active === 'chat'}"
                title=${msg('聊天')}
                @click=${() => this._handleClick('chat')}
                @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, 'chat')}
            >${chatIcon}</div>
            ${this.showFiles ? html`
            <div
                    class="activity-icon ${this.active === 'files' ? 'active' : ''}"
                    data-activity="files"
                    role="tab"
                    tabindex="${this._tabIndex('files')}"
                    aria-label=${msg('资源管理器')}
                    aria-selected="${this.active === 'files'}"
                    title=${msg('资源管理器')}
                    @click=${() => this._handleClick('files')}
                    @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, 'files')}
            >${filesIcon}</div>
            ` : nothing}

            <!-- Spacer pushes settings to the bottom -->
            <div class="activity-spacer"></div>

            <!-- Bottom activity -->
            ${this.showSettings ? html`
            <div
                class="activity-icon ${this.active === 'settings' ? 'active' : ''}"
                data-activity="settings"
                role="tab"
                tabindex="${this._tabIndex('settings')}"
                aria-label=${msg('设置')}
                aria-selected="${this.active === 'settings'}"
                title=${msg('设置')}
                @click=${() => this._handleClick('settings')}
                @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, 'settings')}
            >${gearIcon}</div>
            ` : nothing}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-activity-bar': RtcActivityBar;
    }

    interface HTMLElementEventMap {
        'activity-change': CustomEvent<{
            activity: Activity;
            toggleSidebar: boolean;
        }>;
    }
}
