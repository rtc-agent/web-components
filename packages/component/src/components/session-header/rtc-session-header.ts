/**
 * RTC Session Header Component
 *
 * Displays current session title with history and new-session buttons.
 * Manages the session panel (floating dropdown) with @floating-ui/dom positioning.
 *
 * @element rtc-session-header
 * @csspart title - The session title element
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state, query} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {
    computePosition,
    flip,
    shift,
    offset,
    autoUpdate,
} from '@floating-ui/dom';
import {styles} from './rtc-session-header.styles.js';
import {SessionContext, type SessionContextValue} from '../../contexts/session.js';
import {clockIcon, plusIcon} from '../../icons/index.js';
import '../overlay/rtc-session-panel.js';
import type {Session} from '../../types/index.js';

@customElement('rtc-session-header')
export class RtcSessionHeader extends LitElement {
    static styles = styles;

    @consume({context: SessionContext, subscribe: true})
    @state()
    private _sessionCtx: SessionContextValue = {
        state: {sessions: [], currentSessionId: null},
        actions: {createSession: () => {}, switchSession: () => {}, renameSession: () => {}, deleteSession: () => {}, reset: () => {}, clearCurrentSession: () => {}, setCurrentSession: () => {}, setSessions: () => {}},
    };

    @property({type: String, attribute: 'session-title'})
    sessionTitle = 'Untitled';

    @state()
    private _showSessionPanel = false;

    @query('[data-action="history"]')
    private _historyBtn!: HTMLElement;

    @query('rtc-session-panel')
    private _sessionPanel?: HTMLElement;

    private _cleanupPosition: (() => void) | null = null;

    private _handleHistoryClick() {
        this._showSessionPanel = !this._showSessionPanel;
        if (this._showSessionPanel) {
            this._startPositioning();
        } else {
            this._stopPositioning();
        }
    }

    private _handleNewSession() {
        // Start a new conversation: clear current selection and messages, but keep session history
        // Sending a message will auto-create a new session via MessageController
        this._sessionCtx.actions.clearCurrentSession();
        this.dispatchEvent(
            new CustomEvent('rtc-new-session', {bubbles: true, composed: true})
        );
    }

    private async _startPositioning() {
        // Wait for render so rtc-session-panel exists in DOM
        await this.updateComplete;
        const btn = this._historyBtn;
        const panel = this._sessionPanel;
        if (!btn || !panel) return;

        this._cleanupPosition?.();
        this._cleanupPosition = autoUpdate(btn, panel, () => this._updatePosition());
    }

    private async _updatePosition() {
        await this.updateComplete;
        const btn = this._historyBtn;
        const panel = this._sessionPanel;
        if (!btn || !panel) return;

        const {x, y} = await computePosition(btn, panel, {
            placement: 'bottom-end',
            middleware: [
                offset(6),
                flip({padding: 8}),
                shift({padding: 8}),
            ],
        });
        Object.assign(panel.style, {
            left: `${x}px`,
            top: `${y}px`,
        });
    }

    private _stopPositioning() {
        this._cleanupPosition?.();
        this._cleanupPosition = null;
    }

    private _closeSessionPanel() {
        this._showSessionPanel = false;
        this._stopPositioning();
    }

    private _handleSessionSelected(e: Event) {
        const detail = (e as CustomEvent).detail;
        this._sessionCtx.actions.switchSession(detail.sessionId);
        this._closeSessionPanel();
    }

    private _handleSessionPanelClose() {
        this._closeSessionPanel();
    }

    private _onDocClick = (e: MouseEvent) => {
        if (!this._showSessionPanel) return;
        const path = e.composedPath();
        // Don't close if clicking inside this component (panel or trigger button)
        if (path.includes(this)) return;
        this._closeSessionPanel();
    };

    private _onDocKeydown = (e: KeyboardEvent) => {
        if (!this._showSessionPanel) return;
        if (e.key === 'Escape') {
            this._closeSessionPanel();
        }
    };

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('mousedown', this._onDocClick, true);
        document.addEventListener('keydown', this._onDocKeydown, true);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('mousedown', this._onDocClick, true);
        document.removeEventListener('keydown', this._onDocKeydown, true);
        this._stopPositioning();
    }

    render() {
        const sessions: Session[] = this._sessionCtx.state.sessions;
        const currentSessionId = this._sessionCtx.state.currentSessionId;

        // 优先从 Context 读取标题
        const currentSession = currentSessionId
            ? sessions.find(s => s.clientId === currentSessionId)
            : undefined;
        const title = currentSession?.title || this.sessionTitle || 'Untitled';

        return html`
      <div class="session-header">
        <span class="session-title" part="title">${title}</span>
        <div class="header-actions">
          <button
            class="icon-btn"
            data-action="history"
            title="Session history"
            @click=${this._handleHistoryClick}
          >${clockIcon}</button>
          <button
            class="icon-btn"
            data-action="new-session"
            title="New session"
            @click=${this._handleNewSession}
          >${plusIcon}</button>
        </div>
      </div>
      ${this._showSessionPanel ? html`
        <rtc-session-panel
          .sessions=${sessions}
          current-session-id=${currentSessionId ?? ''}
          @rtc-session-selected=${this._handleSessionSelected}
          @rtc-session-panel-close=${this._handleSessionPanelClose}
        ></rtc-session-panel>
      ` : nothing}
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-session-header': RtcSessionHeader;
    }
}
