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
     * Query the current session's user message history (for input box up/down arrow navigation)
     *
     * Returns an array of plain text content, sorted by time in descending order (newest first).
     * Optional method, injected by MessageController.
     */
    getUserMessageHistory?(sessionId: string, limit?: number): Promise<string[]>;
}

export const MessageContext = createContext<MessageContextValue>(
    Symbol('message-context')
);
