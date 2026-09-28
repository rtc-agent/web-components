/**
 * Session Tree Context — holds session tree structure and expand/collapse actions.
 *
 * Organizes the session list into a hierarchical tree: root sessions serve as "folders",
 * and forked child sessions (linked via rootClientSessionId) are nested inside.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-session-tree>, <rtc-session-tree-item>
 */
import {createContext} from '@lit/context';
import type {SessionTreeState, SessionTreeActions} from '../types/index.js';

export interface SessionTreeContextValue {
    state: SessionTreeState;
    actions: SessionTreeActions;
}

export const SessionTreeContext = createContext<SessionTreeContextValue>(
    Symbol('session-tree-context')
);

export const DEFAULT_SESSION_TREE_STATE: SessionTreeState = {
    rootNodes: [],
};
