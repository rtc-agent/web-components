/**
 * Session Tab Context — holds open tabs and active tab state.
 *
 * 管理对话页面的 Tab 页签。点击会话树节点时打开/切换到对应 tab，
 * Tab 栏显示所有已打开的 session，活动 tab 的聊天内容渲染在右侧。
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
