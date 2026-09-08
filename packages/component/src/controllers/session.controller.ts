/**
 * Session Controller
 *
 * Encapsulates session management: create, switch, rename, delete.
 * Dispatches public `rtc-session-*` events on the host for external consumers.
 *
 * When switching sessions, also reloads messages for the new session (via messageController reference).
 * This cross-controller communication is handled by the root component wiring.
 *
 * Corresponds to: `sessionContext` (defined in `contexts/session.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-session-header>`, `<rtc-session-panel>`, `<rtc-content-area>`
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Session, SessionState, SessionActions} from '../types/index.js';
import type {SessionContextValue} from '../contexts/session.js';
import {DEFAULT_SESSION_STATE} from '../contexts/session.js';
import type {PersistenceLayer} from '@rtc-agent/persistence';

export class SessionController implements ReactiveController {
    host: ReactiveControllerHost & EventTarget;

    private _state: SessionState = {...DEFAULT_SESSION_STATE};

    readonly actions: SessionActions;

    /** Called when session switches — root wires this to MessageController. */
    onSessionSwitch?: () => void;

    /**
     * Persistence layer reference (injected by root after connect).
     *
     * When set, rename/delete operations are persisted to IndexedDB + synced to server.
     * When unset, rename/delete operate in-memory only (offline / pre-connect fallback).
     */
    persistence?: PersistenceLayer;

    get value(): SessionContextValue {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost & EventTarget) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            createSession: () => this._createSession(),
            switchSession: (id: string) => this._switchSession(id),
            renameSession: (id: string, title: string) =>
                this._renameSession(id, title),
            deleteSession: (id: string) => this._deleteSession(id),
            reset: () => this._reset(),
            clearCurrentSession: () => this._clearCurrentSession(),
            setCurrentSession: (session: Session) => this._setCurrentSession(session),
            setSessions: (sessions: Session[]) => this._setSessions(sessions),
        };
    }

    hostConnected() {}
    hostDisconnected() {}

    private _createSession(): string {
        // Use crypto.randomUUID() for unique IDs (avoids Date.now() collisions)
        const clientId = `session-${crypto.randomUUID()}`;
        const newSession: Session = {
            clientId,
            title: 'New Session',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        const sessions = [...this._state.sessions, newSession];
        this._state = {sessions, currentSessionId: newSession.clientId};
        this.host.requestUpdate();
        this.host.dispatchEvent(
            new CustomEvent('rtc-session-created', {
                bubbles: true,
                composed: true,
                detail: {session: newSession},
            })
        );
        return clientId;
    }

    private _switchSession(id: string) {
        console.log('[SessionController._switchSession] Switching to session:', id);
        this._state = {...this._state, currentSessionId: id};
        this.host.requestUpdate();
        // Clear messages for new session — delegate to root via callback
        this.onSessionSwitch?.();
        this.host.dispatchEvent(
            new CustomEvent('rtc-session-switched', {
                bubbles: true,
                composed: true,
                detail: {id},
            })
        );
    }

    private async _renameSession(id: string, title: string): Promise<{ok: boolean; error?: string}> {
        // 1. Persist + sync (fire-and-forget the RPC, but await the local write)
        if (this.persistence) {
            try {
                await this.persistence.updateSessionTitle(id, title);
            } catch (err) {
                console.error('[SessionController._renameSession] persistence failed:', err);
                return {ok: false, error: '重命名失败，请稍后重试'};
            }
        }

        // 2. Update in-memory state
        const sessions = this._state.sessions.map((s) =>
            s.clientId === id ? {...s, title, updatedAt: Date.now()} : s
        );
        this._state = {...this._state, sessions};
        this.host.requestUpdate();
        this.host.dispatchEvent(
            new CustomEvent('rtc-session-renamed', {
                bubbles: true,
                composed: true,
                detail: {id, title},
            })
        );
        return {ok: true};
    }

    private async _deleteSession(id: string): Promise<{ok: boolean; error?: string}> {
        console.log('[SessionController._deleteSession] id:', id, 'persistence:', !!this.persistence);
        // 1. Persist + sync (fire-and-forget the RPC, but await the local write)
        if (this.persistence) {
            try {
                console.log('[SessionController._deleteSession] calling persistence.deleteSession');
                await this.persistence.deleteSession(id);
                console.log('[SessionController._deleteSession] persistence.deleteSession completed');
            } catch (err) {
                console.error('[SessionController._deleteSession] persistence failed:', err);
                return {ok: false, error: '删除失败，请稍后重试'};
            }
        } else {
            console.warn('[SessionController._deleteSession] NO persistence layer, doing in-memory only');
        }

        // 2. Update in-memory state
        const sessions = this._state.sessions.filter((s) => s.clientId !== id);
        const currentSessionId =
            this._state.currentSessionId === id
                ? sessions.length > 0
                    ? sessions[sessions.length - 1].clientId
                    : null
                : this._state.currentSessionId;
        this._state = {sessions, currentSessionId};
        this.host.requestUpdate();

        // 3. If we deleted the active session, trigger switch to the new active
        if (this._state.currentSessionId !== id && currentSessionId !== this._state.currentSessionId) {
            // currentSessionId changed — fire switch event
            this.onSessionSwitch?.();
            this.host.dispatchEvent(
                new CustomEvent('rtc-session-switched', {
                    bubbles: true,
                    composed: true,
                    detail: {id: currentSessionId},
                })
            );
        }

        this.host.dispatchEvent(
            new CustomEvent('rtc-session-deleted', {
                bubbles: true,
                composed: true,
                detail: {id},
            })
        );
        return {ok: true};
    }

    private _reset() {
        this._state = {...DEFAULT_SESSION_STATE};
        this.host.requestUpdate();
    }

    private _clearCurrentSession() {
        this._state = {...this._state, currentSessionId: null};
        this.host.requestUpdate();
        // Trigger session switch callback to clear messages
        this.onSessionSwitch?.();
    }

    private _setCurrentSession(session: Session) {
        console.log('[SessionController._setCurrentSession] Setting session:', session.clientId, 'title:', `"${session.title}"`);
        const existingIndex = this._state.sessions.findIndex(
            (s) => s.clientId === session.clientId
        );
        let sessions: Session[];
        if (existingIndex >= 0) {
            sessions = this._state.sessions.map((s, i) =>
                i === existingIndex ? session : s
            );
        } else {
            sessions = [...this._state.sessions, session];
        }
        this._state = {sessions, currentSessionId: session.clientId};
        this.host.requestUpdate();
    }

    private _setSessions(sessions: Session[]) {
        // 只更新 sessions 列表，保持 currentSessionId 不变
        this._state = {...this._state, sessions};
        this.host.requestUpdate();
    }
}
