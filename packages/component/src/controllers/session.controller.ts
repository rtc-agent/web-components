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
import {createLogger} from '@rtc-agent/client';

const log = createLogger('SessionController');

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
            closeSession: (id: string) => this._closeSession(id),
            reopenSession: (id: string) => this._reopenSession(id),
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
        log.debug('Switching to session:', id);
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
                log.error('persistence rename failed:', err);
                return {ok: false, error: 'rename-failed'};
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
        log.debug('deleteSession id:', id, 'persistence:', !!this.persistence);
        // 1. Persist + sync (fire-and-forget the RPC, but await the local write)
        if (this.persistence) {
            try {
                log.debug('calling persistence.deleteSession');
                await this.persistence.deleteSession(id);
                log.debug('persistence.deleteSession completed');
            } catch (err) {
                log.error('persistence delete failed:', err);
                return {ok: false, error: 'delete-failed'};
            }
        } else {
            log.warn('NO persistence layer, doing in-memory only delete');
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

    /**
     * Notify backend to close session
     *
     * Only sends RPC notification, does not change local state (Tab close is handled by caller).
     * On failure, only logs error; caller decides how to handle it.
     */
    private async _closeSession(id: string): Promise<{ok: boolean; error?: Error}> {
        if (!this.persistence) {
            log.warn('No persistence layer, skipping close');
            return {ok: true};
        }

        // Check if session has been synced to backend (has server_id)
        const session = await this.persistence.getSession(id);
        if (!session?.server_id) {
            // Unsynced session does not need backend notification
            return {ok: true};
        }

        try {
            await this.persistence.closeSession(id);
            return {ok: true};
        } catch (err) {
            log.error('Failed to close session:', err);
            return {ok: false, error: err instanceof Error ? err : new Error(String(err))};
        }
    }

    /**
     * Reopen a closed session (transparent reopen)
     *
     * Calls backend openSession API to change session state from closed back to idle/active.
     * After backend returns updates, applyUpdates handles local state sync.
     */
    private async _reopenSession(id: string): Promise<{ok: boolean; error?: Error}> {
        if (!this.persistence) {
            log.error('No persistence layer for reopen');
            return {ok: false, error: new Error('Persistence layer not available')};
        }

        try {
            await this.persistence.openSession(id);
            return {ok: true};
        } catch (err) {
            log.error('Failed to reopen session:', err);
            return {ok: false, error: err instanceof Error ? err : new Error(String(err))};
        }
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
        log.debug('Setting session:', session.clientId, 'title:', `"${session.title}"`);
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
        // Only update sessions list, keep currentSessionId unchanged
        this._state = {...this._state, sessions};
        this.host.requestUpdate();
    }
}
