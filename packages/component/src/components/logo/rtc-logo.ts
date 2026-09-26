/**
 * RTC Logo Component
 *
 * Theme-aware logo that supports custom branding via LogoContext.
 *
 * When a custom logo is provided (via `<rtc-agent>.logo` or `logoContext`),
 * it renders the custom SVG/HTML. Otherwise, it falls back to the default
 * RTC Agent logo (light/dark variant based on `theme`).
 *
 * @element rtc-logo
 *
 * @attr {string} [theme=system] - 'light' | 'dark' | 'system'
 *   Determines which logo variant to render. 'system' follows OS preference
 *   and automatically switches when the preference changes.
 *
 * @csspart logo - The logo container
 */
import {LitElement, html, css} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {LogoContext, type LogoContextValue} from '../../contexts/logo.js';
import {renderLogo} from '../../icons/logo.js';

@customElement('rtc-logo')
export class RtcLogo extends LitElement {
    static styles = css`
        :host {
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        ::slotted(*),
        :host svg,
        :host img {
            width: 100%;
            height: 100%;
        }
    `;

    @property({type: String})
    theme: 'light' | 'dark' | 'system' = 'system';

    @consume({context: LogoContext, subscribe: true})
    private _logoCtx: LogoContextValue = {light: '', dark: ''};

    /** Tracks system dark mode for 'system' theme resolution. */
    @state() private _systemDark = false;

    private _mq?: MediaQueryList;
    private _boundOnMediaChange = () => {
        this._systemDark = this._mq?.matches ?? false;
    };

    connectedCallback() {
        super.connectedCallback();
        if (typeof window !== 'undefined') {
            this._mq = window.matchMedia('(prefers-color-scheme: dark)');
            this._systemDark = this._mq.matches;
            this._mq.addEventListener('change', this._boundOnMediaChange);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._mq?.removeEventListener('change', this._boundOnMediaChange);
    }

    /** Resolve effective dark mode. */
    private get _isDark(): boolean {
        if (this.theme === 'system') return this._systemDark;
        return this.theme === 'dark';
    }

    render() {
        const dark = this._isDark;
        const custom = dark ? this._logoCtx.dark : this._logoCtx.light;

        if (custom) {
            // Custom logo: sanitized by <rtc-agent> before storing in context
            return html`<span part="logo" .innerHTML=${custom}></span>`;
        }

        // Default RTC Agent logo
        return html`<span part="logo">${renderLogo(dark)}</span>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-logo': RtcLogo;
    }
}
