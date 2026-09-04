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
 *
 * @csspart label - The app label element
 * @csspart controls - The window controls container
 * @csspart status-dot - The connection status indicator dot
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-title-bar.styles.js';
import type {WindowMode} from '../../types/index.js';
import type {ConnectionState} from '@rtc-agent/client';
import {minimizeIcon, maximizeIcon, restoreIcon} from '../../icons/index.js';

@customElement('rtc-title-bar')
export class RtcTitleBar extends LitElement {
    static styles = styles;

    @property({type: String, attribute: 'app-label'})
    appLabel = 'RTC Agent';

    @property({type: String, attribute: 'window-mode'})
    windowMode: WindowMode = 'normal';

    @property({type: String, attribute: 'connection-state'})
    connectionState: ConnectionState = 'disconnected';

    private _getStatusText(): string {
        switch (this.connectionState) {
            case 'connected': return '已连接';
            case 'connecting': return '连接中';
            case 'reconnecting': return '重新连接中';
            case 'disconnected': return '未连接';
            default: return '未知';
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

    render() {
        const isMaximized = this.windowMode === 'maximized';
        return html`
      <div class="title-bar" part="bar" tabindex="0" role="toolbar" aria-label="Window controls">
        <span class="app-label" part="label">
          <span
            class="status-dot ${this.connectionState}"
            part="status-dot"
            title=${this._getStatusText()}
            aria-label=${this._getStatusText()}
          ></span>
          ${this.appLabel}
        </span>
        <div class="window-controls" part="controls">
          <button
            class="window-btn"
            data-action="minimize"
            title="Minimize"
            aria-label="Minimize window"
            @click=${this._handleMinimize}
          >${minimizeIcon}</button>
          <button
            class="window-btn"
            data-action="maximize"
            title=${isMaximized ? 'Restore' : 'Maximize'}
            aria-label=${isMaximized ? 'Restore window' : 'Maximize window'}
            @click=${this._handleMaximizeToggle}
          >${isMaximized ? restoreIcon : maximizeIcon}</button>
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
