/**
 * Function Debugger Types
 *
 * Type definitions for the Function Debugger feature.
 * Includes debug state, log entries, execution history, and storage constants.
 */

import type {FunctionDef} from './skill.js';

/**
 * Log level for console output
 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * A single log entry in the debugger console
 */
export interface LogEntry {
    /** Timestamp (ms since epoch) */
    timestamp: number;
    /** Log level */
    level: LogLevel;
    /** Log message */
    message: string;
    /** Optional structured data (e.g. function result) */
    data?: unknown;
}

/**
 * Execution status of a function call
 */
export type ExecutionStatus = 'idle' | 'running' | 'success' | 'error';

/**
 * A single debug history record
 */
export interface DebugHistoryItem {
    /** Unique ID */
    id: string;
    /** Full function name (e.g. "user.register") */
    functionName: string;
    /** JSON string of the parameters used */
    params: string;
    /** Whether execution succeeded */
    success: boolean;
    /** Execution duration in ms */
    durationMs: number;
    /** Timestamp of execution */
    timestamp: number;
    /** Log entries captured during execution */
    logs: LogEntry[];
    /** Error message if failed */
    errorMessage?: string;
    /** Execution result (serialized) */
    result?: unknown;
}

/**
 * Function debug state
 */
export interface FunctionDebugState {
    /** Currently selected function definition */
    selectedFunction: FunctionDef | null;
    /** Current parameter JSON string */
    currentParams: string;
    /** Console log entries */
    logs: LogEntry[];
    /** Debug history (most recent first) */
    history: DebugHistoryItem[];
    /** Current execution status */
    executionStatus: ExecutionStatus;
}

/** localStorage key for debug history */
export const DEBUG_HISTORY_STORAGE_KEY = 'rtc_function_debug_history';

/** Maximum number of history items to retain */
export const MAX_HISTORY_ITEMS = 100;
