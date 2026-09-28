/**
 * Session Tab Context — holds open tabs and active tab state.
 *
 * Manages conversation page tabs. Clicking a session tree node opens/switches to the corresponding tab.
 * The tab bar shows all opened sessions, and the active tab's chat content is rendered on the right.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-session-tab-bar>, <rtc-chat-layout>
 */
import {createContext} from '@lit/context';
import type {SessionTabState, SessionTabActions} from '../types/index.js';

export interface SessionTabContextValue {
    state: SessionTabState;
    actions: SessionTabActions;
}

export const SessionTabContext = createContext<SessionTabContextValue>(
    Symbol('session-tab-context')
);

export const DEFAULT_SESSION_TAB_STATE: SessionTabState = {
    tabs: [],
    activeSessionId: null,
};
