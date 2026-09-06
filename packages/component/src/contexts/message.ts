import {createContext} from '@lit/context';
import type {MessageState, MessageActions} from '../types/index.js';

/**
 * Message Context — holds messages for the current session.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-content-area>, <rtc-message-list>, <rtc-input-area>
 */
export interface MessageContextValue {
    state: MessageState;
    actions: MessageActions;
    /**
     * 查询当前 session 的用户消息历史（用于输入框上下箭头导航）
     *
     * 返回纯文本内容数组，按时间倒序（最新消息在前）。
     * 可选方法，Worker 模式下由 MessageController 注入。
     */
    getUserMessageHistory?(sessionId: string, limit?: number): Promise<string[]>;
}

export const MessageContext = createContext<MessageContextValue>(
    Symbol('message-context')
);
