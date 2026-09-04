import {createContext} from '@lit/context';
import type {ToolCallState, ToolCallActions} from '../types/index.js';

/**
 * ToolCall Context — pending tool calls awaiting user approval.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-tool-confirm>, <rtc-overlay-manager>
 */
export interface ToolCallContextValue {
    state: ToolCallState;
    actions: ToolCallActions;
}

export const ToolCallContext = createContext<ToolCallContextValue>(
    Symbol('tool-call-context')
);

export const DEFAULT_TOOL_CALL_STATE: ToolCallState = {
    pendingCalls: [],
};
