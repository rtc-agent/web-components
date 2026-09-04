import {createContext} from '@lit/context';
import type {SessionState, SessionActions} from '../types/index.js';

/**
 * Session Context — holds session list and current session.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-session-header>, <rtc-session-panel>, <rtc-content-area>
 */
export interface SessionContextValue {
    state: SessionState;
    actions: SessionActions;
}

export const SessionContext = createContext<SessionContextValue>(
    Symbol('session-context')
);

export const DEFAULT_SESSION_STATE: SessionState = {
    sessions: [],
    currentSessionId: null,
};
