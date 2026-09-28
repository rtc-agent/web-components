/**
 * Function Debug Context
 *
 * Provides function debugger state and actions to child components.
 *
 * Consumed by: <rtc-function-tree>, <rtc-function-debugger>, <rtc-function-params>,
 *              <rtc-function-console>, <rtc-function-history>
 * Provided by: <rtc-agent> (root)
 */

import {createContext} from '@lit/context';
import type {FunctionDef} from '../types/skill.js';
import type {FunctionDebugState, DebugHistoryItem} from '../types/functions-debug.js';

/**
 * Function debug context actions
 */
export interface FunctionDebugActions {
    /** Select a function for debugging */
    selectFunction: (fn: FunctionDef) => void;
    /** Update the current parameter JSON string */
    updateParams: (params: string) => void;
    /** Execute the currently selected function */
    execute: () => Promise<void>;
    /** Execute from a history item (restores params and re-runs) */
    executeFromHistory: (item: DebugHistoryItem) => Promise<void>;
    /** Restore a history item's params and logs to the current view (without executing) */
    loadFromHistory: (item: DebugHistoryItem) => void;
    /** Clear console logs */
    clearLogs: () => void;
    /** Clear all history */
    clearHistory: () => void;
    /** Load a specific page of history */
    loadHistoryPage: (page: number) => Promise<void>;
    /** Set history filter by function name */
    setHistoryFilter: (functionName?: string) => Promise<void>;
}

/**
 * Function debug context value
 */
export interface FunctionDebugContextValue {
    state: FunctionDebugState;
    actions: FunctionDebugActions;
}

/**
 * Default state
 */
export const DEFAULT_FUNCTION_DEBUG_STATE: FunctionDebugState = {
    selectedFunction: null,
    currentParams: '{}',
    logs: [],
    history: [],
    historyPagination: {
        items: [],
        page: 1,
        totalPages: 0,
        total: 0,
    },
    executionStatus: 'idle',
};

/**
 * Function debug context key
 */
export const FunctionDebugContext = createContext<FunctionDebugContextValue>(Symbol('function-debug-context'));
