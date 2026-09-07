/**
 * Session Tree Context — holds session tree structure and expand/collapse actions.
 *
 * 将会话列表组织为层级树：root session 为"文件夹"，
 * fork 产生的子 session（通过 rootClientSessionId 关联）嵌套其中。
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
