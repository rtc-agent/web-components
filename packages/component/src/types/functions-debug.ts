/**
 * Function Debugger Types
 *
 * Type definitions for the Function Debugger feature.
 * DebugHistoryItem and LogEntry are now re-exported from @rtc-agent/persistence.
 */

import type { FunctionDef } from './skill.js';
import type { DebugHistoryItem, LogEntry, LogLevel } from '@rtc-agent/persistence';

// Re-export for backward compatibility
export type { DebugHistoryItem, LogEntry, LogLevel };

/**
 * Execution status of a function call
 */
export type ExecutionStatus = 'idle' | 'running' | 'success' | 'error';

/**
 * Pagination state for history
 */
export interface HistoryPaginationState {
  /** Items in current page */
  items: DebugHistoryItem[];
  /** Current page number (1-based) */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Total record count */
  total: number;
  /** Filter by function name (optional) */
  filterFunctionName?: string;
  /** Error message if loading failed */
  error?: string;
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
  /** Debug history (current page data, most recent first) */
  history: DebugHistoryItem[];
  /** History pagination state */
  historyPagination: HistoryPaginationState;
  /** Current execution status */
  executionStatus: ExecutionStatus;
}
