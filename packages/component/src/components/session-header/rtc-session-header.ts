/**
 * RTC Session Header Component
 *
 * Displays current session title with history and new-session buttons.
 * Manages the session panel (floating dropdown) with @floating-ui/dom positioning.
 * Also manages the todo panel toggle with auto-expand on todoList updates.
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
import {clockIcon, plusIcon, checklistIcon} from '../../icons/index.js';
import '../overlay/rtc-session-panel.js';
import '../overlay/rtc-todo-panel.js';
import type {Session, TodoItem} from '../../types/index.js';

@customElement('rtc-session-header')
export class RtcSessionHeader extends LitElement {
    static styles = styles;

    @consume({context: SessionContext, subscribe: true})
    @state()
    private _sessionCtx: SessionContextValue = {
        state: {sessions: [], currentSessionId: null},
        actions: {createSession: () => '', switchSession: () => {}, renameSession: () => {}, deleteSession: () => {}, reset: () => {}, clearCurrentSession: () => {}, setCurrentSession: () => {}, setSessions: () => {}},
    };

    @property({type: String, attribute: 'session-title'})
    sessionTitle = 'Untitled';

    @state()
    private _showSessionPanel = false;

    @state()
    private _showTodoPanel = false;

    /** Fading-out state for auto-close animation. */
    @state()
    private _isFadingOut = false;

    /** Previous todoList for detecting changes. null = not initialized. */
    private _prevTodoList: TodoItem[] | null = null;

    /** Timer for auto-close after 3 seconds. */
    private _autoCloseTimer?: ReturnType<typeof setTimeout>;

    @query('[data-action="history"]')
    private _historyBtn!: HTMLElement;

    @query('[data-action="todo"]')
    private _todoBtn!: HTMLElement;

    @query('rtc-session-panel')
    private _sessionPanel?: HTMLElement;

    @query('rtc-todo-panel')
    private _todoPanel?: HTMLElement;

    private _cleanupSessionPosition: (() => void) | null = null;
    private _cleanupTodoPosition: (() => void) | null = null;

    /* ── Lifecycle ── */

    willUpdate(changedProperties: Map<string, unknown>) {
        // Auto-expand todo panel when todoList changes.
        if (changedProperties.has('_sessionCtx')) {
            const prevCtx = changedProperties.get('_sessionCtx') as SessionContextValue | undefined;
            const hadSession = prevCtx?.state.currentSessionId != null;

            const currentSession = this._getCurrentSession();
            const todoList = currentSession?.todoList ?? [];

            if (!hadSession) {
                // Initial load (no session before): just set baseline, don't auto-expand
                this._prevTodoList = todoList;
            } else if (this._todoListChanged(this._prevTodoList, todoList)) {
                // Had session before and todoList changed: auto-expand and schedule auto-close
                this._showTodoPanel = true;
                this._isFadingOut = false;
                this._scheduleAutoClose();
                this.updateComplete.then(() => this._startTodoPositioning());
                this._prevTodoList = todoList;
            }
        }
    }

    /**
     * Check if todoList has changed (by content, not just length).
     * Uses JSON.stringify for deep comparison.
     */
    private _todoListChanged(prev: TodoItem[] | null, curr: TodoItem[]): boolean {
        if (prev === null) return curr.length > 0;
        if (prev === curr) return false;  // Same reference
        if (prev.length !== curr.length) return true;
        // Deep compare: JSON.stringify is sufficient for TodoItem objects
        return JSON.stringify(prev) !== JSON.stringify(curr);
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('mousedown', this._onDocClick, true);
        document.addEventListener('keydown', this._onDocKeydown, true);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('mousedown', this._onDocClick, true);
        document.removeEventListener('keydown', this._onDocKeydown, true);
        this._stopSessionPositioning();
        this._stopTodoPositioning();
        clearTimeout(this._autoCloseTimer);
    }

    /* ── Helpers ── */

    private _getCurrentSession(): Session | undefined {
        const sessions: Session[] = this._sessionCtx.state.sessions;
        const currentSessionId = this._sessionCtx.state.currentSessionId;
        return currentSessionId
            ? sessions.find(s => s.clientId === currentSessionId)
            : undefined;
    }

    /* ── Session Panel ── */

    private _handleHistoryClick() {
        this._showSessionPanel = !this._showSessionPanel;
        if (this._showSessionPanel) {
            this._closeTodoPanel();
            clearTimeout(this._autoCloseTimer);
            this._startSessionPositioning();
        } else {
            this._stopSessionPositioning();
        }
    }

    private async _startSessionPositioning() {
        await this.updateComplete;
        const btn = this._historyBtn;
        const panel = this._sessionPanel;
        if (!btn || !panel) return;

        this._stopSessionPositioning();
        this._cleanupSessionPosition = autoUpdate(btn, panel, () => this._updateSessionPosition());
    }

    private async _updateSessionPosition() {
        await this.updateComplete;
        const btn = this._historyBtn;
        const panel = this._sessionPanel;
        if (!btn || !panel) return;

        const {x, y} = await computePosition(btn, panel, {
            placement: 'bottom-end',
            strategy: 'absolute',
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

    private _stopSessionPositioning() {
        this._cleanupSessionPosition?.();
        this._cleanupSessionPosition = null;
    }

    private _closeSessionPanel() {
        this._showSessionPanel = false;
        this._stopSessionPositioning();
    }

    private _handleSessionSelected(e: Event) {
        const detail = (e as CustomEvent).detail;
        this._sessionCtx.actions.switchSession(detail.sessionId);
        this._closeSessionPanel();
    }

    private _handleSessionPanelClose() {
        this._closeSessionPanel();
    }

    /* ── Todo Panel ── */

    private _handleTodoClick() {
        this._showTodoPanel = !this._showTodoPanel;
        this._isFadingOut = false;
        clearTimeout(this._autoCloseTimer);
        if (this._showTodoPanel) {
            this._closeSessionPanel();
            this._startTodoPositioning();
        } else {
            this._stopTodoPositioning();
        }
    }

    private async _startTodoPositioning() {
        await this.updateComplete;
        const btn = this._todoBtn;
        const panel = this._todoPanel;
        if (!btn || !panel) return;

        this._stopTodoPositioning();
        this._cleanupTodoPosition = autoUpdate(btn, panel, () => this._updateTodoPosition());
    }

    private async _updateTodoPosition() {
        await this.updateComplete;
        const btn = this._todoBtn;
        const panel = this._todoPanel;
        if (!btn || !panel) return;

        const {x, y} = await computePosition(btn, panel, {
            placement: 'bottom-end',
            strategy: 'absolute',
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

    private _stopTodoPositioning() {
        this._cleanupTodoPosition?.();
        this._cleanupTodoPosition = null;
    }

    private _closeTodoPanel() {
        this._showTodoPanel = false;
        this._isFadingOut = false;
        this._stopTodoPositioning();
    }

    /**
     * Schedule auto-close with fade-out animation after 3 seconds.
     * Cancels any pending timer before starting a new one.
     */
    private _scheduleAutoClose() {
        clearTimeout(this._autoCloseTimer);
        this._autoCloseTimer = setTimeout(() => {
            this._isFadingOut = true;
            // Wait for fade-out animation (300ms) before hiding
            setTimeout(() => {
                this._showTodoPanel = false;
                this._isFadingOut = false;
                this._stopTodoPositioning();
            }, 300);
        }, 3000);
    }

    /**
     * When the user hovers over the todo panel, cancel auto-close.
     * The panel stays open until the user manually closes it or
     * the next todoList update re-triggers the auto-close timer.
     */
    private _onTodoPanelMouseEnter() {
        clearTimeout(this._autoCloseTimer);
        if (this._isFadingOut) {
            this._isFadingOut = false;
        }
    }

    /* ── Global Listeners ── */

    private _onDocClick = (e: MouseEvent) => {
        if (!this._showSessionPanel && !this._showTodoPanel) return;
        const path = e.composedPath();
        // Don't close if clicking inside this component (panels or trigger buttons)
        if (path.includes(this)) return;
        this._closeSessionPanel();
        this._closeTodoPanel();
        clearTimeout(this._autoCloseTimer);
    };

    private _onDocKeydown = (e: KeyboardEvent) => {
        if (!this._showSessionPanel && !this._showTodoPanel) return;
        if (e.key === 'Escape') {
            this._closeSessionPanel();
            this._closeTodoPanel();
            clearTimeout(this._autoCloseTimer);
        }
    };

    /* ── Render ── */

    render() {
        const sessions: Session[] = this._sessionCtx.state.sessions;
        const currentSessionId = this._sessionCtx.state.currentSessionId;

        // 优先从 Context 读取标题
        const currentSession = currentSessionId
            ? sessions.find(s => s.clientId === currentSessionId)
            : undefined;
        const title = currentSession?.title || this.sessionTitle || 'Untitled';
        const todoList: TodoItem[] = currentSession?.todoList ?? [];

        return html`
      <div class="session-header">
        <span class="session-title" part="title">${title}</span>
        <div class="header-actions">
          <button
            class="icon-btn"
            data-action="history"
            title="Session history"
            aria-label="Session history"
            @click=${this._handleHistoryClick}
          >${clockIcon}</button>
          <button
            class="icon-btn"
            data-action="todo"
            title="Task list"
            aria-label="Toggle task list"
            @click=${this._handleTodoClick}
          >${checklistIcon}</button>
          <button
            class="icon-btn"
            data-action="new-session"
            title="New session"
            aria-label="New session"
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
      ${this._showTodoPanel ? html`
        <rtc-todo-panel
          class=${this._isFadingOut ? 'fading-out' : ''}
          .todoList=${todoList}
          @mouseenter=${this._onTodoPanelMouseEnter}
        ></rtc-todo-panel>
      ` : nothing}
    `;
    }

    private _handleNewSession() {
        // Start a new conversation: clear current selection and messages, but keep session history.
        // Then dispatch rtc-session-tree-new so chat-layout 走统一的 unsaved tab 编排流程
        // （与 session-tree "+" 按钮同源）。
        this._sessionCtx.actions.clearCurrentSession();
        this.dispatchEvent(
            new CustomEvent('rtc-session-tree-new', {bubbles: true, composed: true})
        );
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-session-header': RtcSessionHeader;
    }
}
