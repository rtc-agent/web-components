/**
 * ContentData Type Guards and Narrowing Helpers
 *
 * Provides type-safe access to ContentData.data field, which has different
 * structures depending on the `type` field. This eliminates the need for
 * unsafe `as any` casts throughout the codebase.
 *
 * Usage:
 * ```typescript
 * import { getToolCallData, getSummaryData } from '../utils/content-data.js';
 *
 * const toolCall = getToolCallInputData(message.content);
 * if (toolCall) {
 *   console.log(toolCall.id, toolCall.name);
 * }
 * ```
 */
import type { ContentData } from '@rtc-agent/protocol';

/**
 * ToolCall input data structure (toolcall_input content type).
 * Represents a tool invocation request from the assistant.
 */
export interface ToolCallInputData {
  /** Unique identifier for this tool call */
  id: string;
  /** Tool name (e.g., 'filesystem.read_file') */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Tool-specific parameters */
  parameters?: Record<string, unknown>;
}

/**
 * ToolCall output data structure (toolcall_output content type).
 * Represents the result of a tool invocation.
 */
export interface ToolCallOutputData {
  /** Reference to the originating tool call */
  id: string;
  /** Tool execution result (type varies by tool) */
  result?: unknown;
  /** Error message if execution failed */
  error?: string;
}

/**
 * Summary content metadata (for summary content type).
 */
export interface SummaryMetadata {
  /** Token count before compression */
  tokens_before: number;
  /** Token count after compression */
  tokens_after: number;
  /** Compression duration in milliseconds */
  duration_ms?: number;
}

/**
 * Summary content data structure (for summary content type).
 */
export interface SummaryContentData {
  /** Summary items (legacy format: array) */
  items?: unknown[];
  /** Compression metadata */
  metadata?: SummaryMetadata;
}

/**
 * Error content data structure (for error content type).
 */
export interface ErrorContentData {
  /** Error category */
  category:
    | 'api'
    | 'stream'
    | 'tool'
    | 'context'
    | 'system'
    | 'network'
    | 'timeout'
    | 'permission';
  /** Short error title */
  title: string;
  /** Detailed description */
  message: string;
  /** Whether the operation can be retried */
  retryable: boolean;
}

/**
 * Type guard to check if a value is a non-null object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a value is a string.
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard for ToolCallInputData structure.
 * Validates required fields: id, name
 */
function isToolCallInputData(data: unknown): data is ToolCallInputData {
  if (!isObject(data)) return false;
  return isString(data.id) && isString(data.name);
}

/**
 * Type guard for ToolCallOutputData structure.
 * Validates required field: id
 */
function isToolCallOutputData(data: unknown): data is ToolCallOutputData {
  if (!isObject(data)) return false;
  return isString(data.id);
}

/**
 * Type guard for SummaryContentData structure.
 * Validates that data is an object with optional items array or metadata object.
 */
function isSummaryContentData(data: unknown): data is SummaryContentData {
  if (!isObject(data)) return false;
  // items is optional, but if present should be an array
  if (data.items !== undefined && !Array.isArray(data.items)) return false;
  // metadata is optional, but if present should be an object
  if (data.metadata !== undefined && !isObject(data.metadata)) return false;
  return true;
}

/**
 * Type guard for ErrorContentData structure.
 * Validates required fields: category, title, message, retryable
 */
function isErrorContentData(data: unknown): data is ErrorContentData {
  if (!isObject(data)) return false;
  const validCategories = [
    'api',
    'stream',
    'tool',
    'context',
    'system',
    'network',
    'timeout',
    'permission',
  ];
  return (
    isString(data.category) &&
    validCategories.includes(data.category) &&
    isString(data.title) &&
    isString(data.message) &&
    typeof data.retryable === 'boolean'
  );
}

/**
 * Extract ToolCall input data from ContentData with runtime validation.
 *
 * @param content - The ContentData object
 * @returns ToolCallInputData if content.type is 'toolcall_input' and data is valid, undefined otherwise
 */
export function getToolCallInputData(
  content: ContentData | undefined | null,
): ToolCallInputData | undefined {
  if (!content || content.type !== 'toolcall_input') return undefined;
  if (!isToolCallInputData(content.data)) {
    console.warn('getToolCallInputData: data failed validation', content.data);
    return undefined;
  }
  return content.data;
}

/**
 * Extract ToolCall output data from ContentData with runtime validation.
 *
 * @param content - The ContentData object
 * @returns ToolCallOutputData if content.type is 'toolcall_output' and data is valid, undefined otherwise
 */
export function getToolCallOutputData(
  content: ContentData | undefined | null,
): ToolCallOutputData | undefined {
  if (!content || content.type !== 'toolcall_output') return undefined;
  if (!isToolCallOutputData(content.data)) {
    console.warn('getToolCallOutputData: data failed validation', content.data);
    return undefined;
  }
  return content.data;
}

/**
 * Extract Summary content data from ContentData with runtime validation.
 *
 * @param content - The ContentData object
 * @returns SummaryContentData if content.type is 'summary' and data is valid, undefined otherwise
 */
export function getSummaryData(
  content: ContentData | undefined | null,
): SummaryContentData | undefined {
  if (!content || content.type !== 'summary') return undefined;
  if (!isSummaryContentData(content.data)) {
    console.warn('getSummaryData: data failed validation', content.data);
    return undefined;
  }
  return content.data;
}

/**
 * Extract Error content data from ContentData with runtime validation.
 *
 * @param content - The ContentData object
 * @returns ErrorContentData if content.type is 'error' and data is valid, undefined otherwise
 */
export function getErrorData(
  content: ContentData | undefined | null,
): ErrorContentData | undefined {
  if (!content || content.type !== 'error') return undefined;
  if (!isErrorContentData(content.data)) {
    console.warn('getErrorData: data failed validation', content.data);
    return undefined;
  }
  return content.data;
}

/**
 * Extract string data from ContentData (for text/markdown/thinking types).
 *
 * @param content - The ContentData object
 * @returns String data if content.type is 'text', 'markdown', or 'thinking' and data is a string, undefined otherwise
 */
export function getStringData(
  content: ContentData | undefined | null,
): string | undefined {
  if (!content) return undefined;
  if (
    content.type === 'text' ||
    content.type === 'markdown' ||
    content.type === 'thinking'
  ) {
    if (!isString(content.data)) {
      console.warn('getStringData: data is not a string', content.data);
      return undefined;
    }
    return content.data;
  }
  return undefined;
}
