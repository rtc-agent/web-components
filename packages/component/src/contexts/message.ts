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
}

export const MessageContext = createContext<MessageContextValue>(
    Symbol('message-context')
);
