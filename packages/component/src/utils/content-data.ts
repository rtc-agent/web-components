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
 * const toolCall = getToolCallData(message.content);
 * if (toolCall) {
 *   console.log(toolCall.id, toolCall.name);
 * }
 * ```
 */
import type {ContentData} from '@rtc-agent/protocol';

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
    category: 'api' | 'stream' | 'tool' | 'context' | 'system' | 'network' | 'timeout' | 'permission';
    /** Short error title */
    title: string;
    /** Detailed description */
    message: string;
    /** Whether the operation can be retried */
    retryable: boolean;
}

/**
 * Extract ToolCall input data from ContentData.
 *
 * @param content - The ContentData object
 * @returns ToolCallInputData if content.type is 'toolcall_input', undefined otherwise
 */
export function getToolCallInputData(content: ContentData | undefined | null): ToolCallInputData | undefined {
    if (!content || content.type !== 'toolcall_input') return undefined;
    return content.data as ToolCallInputData;
}

/**
 * Extract ToolCall output data from ContentData.
 *
 * @param content - The ContentData object
 * @returns ToolCallOutputData if content.type is 'toolcall_output', undefined otherwise
 */
export function getToolCallOutputData(content: ContentData | undefined | null): ToolCallOutputData | undefined {
    if (!content || content.type !== 'toolcall_output') return undefined;
    return content.data as ToolCallOutputData;
}

/**
 * Extract Summary content data from ContentData.
 *
 * @param content - The ContentData object
 * @returns SummaryContentData if content.type is 'summary', undefined otherwise
 */
export function getSummaryData(content: ContentData | undefined | null): SummaryContentData | undefined {
    if (!content || content.type !== 'summary') return undefined;
    return content.data as SummaryContentData;
}

/**
 * Extract Error content data from ContentData.
 *
 * @param content - The ContentData object
 * @returns ErrorContentData if content.type is 'error', undefined otherwise
 */
export function getErrorData(content: ContentData | undefined | null): ErrorContentData | undefined {
    if (!content || content.type !== 'error') return undefined;
    return content.data as ErrorContentData;
}

/**
 * Extract string data from ContentData (for text/markdown/thinking types).
 *
 * @param content - The ContentData object
 * @returns String data if content.type is 'text', 'markdown', or 'thinking', undefined otherwise
 */
export function getStringData(content: ContentData | undefined | null): string | undefined {
    if (!content) return undefined;
    if (content.type === 'text' || content.type === 'markdown' || content.type === 'thinking') {
        return content.data as string;
    }
    return undefined;
}
