/**
 * RTC Title Bar Component
 *
 * Displays the app label and window control buttons (minimize, maximize/restore).
 * The title bar area serves as the drag handle for the floating window.
 *
 * @element rtc-title-bar
 * @fires rtc-window-minimize - User clicked minimize
 * @fires rtc-window-maximize - User clicked maximize
 * @fires rtc-window-restore - User clicked restore (when maximized)
 * @fires rtc-connection-retry - User clicked retry button (when connection failed)
 *
 * @csspart label - The app label element
 * @csspart controls - The window controls container
 * @csspart status-dot - The connection status indicator dot
 * @csspart retry-btn - The connection retry button
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {styles} from './rtc-title-bar.styles.js';
import type {WindowMode} from '../../types/index.js';
import type {ConnectionState} from '@rtc-agent/client';
import {minimizeIcon, maximizeIcon, restoreIcon, retryIcon} from '../../icons/index.js';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';

@localized()
@customElement('rtc-title-bar')
export class RtcTitleBar extends LitElement {
    static styles = styles;

    @property({type: String, attribute: 'app-label'})
    appLabel = 'RTC Agent';

    @property({type: String, attribute: 'window-mode'})
    windowMode: WindowMode = 'normal';

    @property({type: String, attribute: 'connection-state'})
    connectionState: ConnectionState = 'disconnected';

    /** 是否显示最小化按钮 */
    @property({type: Boolean, attribute: 'show-minimize'})
    showMinimize = true;

    /** 是否显示最大化按钮 */
    @property({type: Boolean, attribute: 'show-maximize'})
    showMaximize = true;

    /** 连接是否失败（显示重试按钮） */
    @property({type: Boolean, attribute: 'connection-failed'})
    connectionFailed = false;

    /** 连接失败的错误信息（用于 tooltip） */
    @property({type: String, attribute: 'connection-error'})
    connectionError = '';

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-title-bar] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    private _getStatusText(): string {
        switch (this.connectionState) {
            case 'connected': return msg('已连接');
            case 'connecting': return msg('连接中');
            case 'reconnecting': return msg('重新连接中');
            case 'disconnected': return msg('未连接');
            default: return msg('未知');
        }
    }

    private _handleMinimize() {
        this.dispatchEvent(
            new CustomEvent('rtc-window-minimize', {bubbles: true, composed: true})
        );
    }

    private _handleMaximizeToggle() {
        if (this.windowMode === 'maximized') {
            this.dispatchEvent(
                new CustomEvent('rtc-window-restore', {bubbles: true, composed: true})
            );
        } else {
            this.dispatchEvent(
                new CustomEvent('rtc-window-maximize', {bubbles: true, composed: true})
            );
        }
    }

    private _handleRetry() {
        this.dispatchEvent(
            new CustomEvent('rtc-connection-retry', {bubbles: true, composed: true})
        );
    }

    render() {
        // Reference locale to ensure re-render on locale change
        void this._localeCtx.locale;

        const isMaximized = this.windowMode === 'maximized';
        const statusText = this.connectionFailed
            ? `${msg('连接失败')}: ${this.connectionError || msg('点击重试')}`
            : this._getStatusText();

        return html`
      <div class="title-bar" part="bar" tabindex="0" role="toolbar" aria-label="Window controls">
        <span class="app-label" part="label">
          <span
            class="status-dot ${this.connectionFailed ? 'failed' : this.connectionState}"
            part="status-dot"
            title=${statusText}
            aria-label=${statusText}
          ></span>
          ${this.appLabel}
        </span>
        <div class="window-controls" part="controls">
          ${this.connectionFailed ? html`
          <button
            class="window-btn retry-btn"
            part="retry-btn"
            data-action="retry"
            aria-label=${msg('重新连接')}
            title=${msg('点击重新连接')}
            @click=${this._handleRetry}
          >${retryIcon}</button>
          ` : nothing}
          ${this.showMinimize ? html`
          <button
            class="window-btn"
            data-action="minimize"
            aria-label="Minimize"
            @click=${this._handleMinimize}
          >${minimizeIcon}</button>
          ` : nothing}
          ${this.showMaximize ? html`
          <button
            class="window-btn"
            data-action=${isMaximized ? 'restore' : 'maximize'}
            aria-label=${isMaximized ? 'Restore' : 'Maximize'}
            @click=${this._handleMaximizeToggle}
          >${isMaximized ? restoreIcon : maximizeIcon}</button>
          ` : nothing}
        </div>
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-title-bar': RtcTitleBar;
    }
}
