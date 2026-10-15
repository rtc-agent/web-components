/**
 * ContentData Type Guards and Narrowing Helpers
 *
 * Provides type-safe access to ContentData.data field, which has different
 * structures depending on the `type` field. This eliminates the need for
 * unsafe `as any` casts throughout the codebase.
 *
 * This module re-exports Protocol's type guards and provides additional
 * component-specific extraction helpers.
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
import type {
  ContentData,
  ErrorContent,
  SummaryContentData,
  ToolCall,
  ToolCallExtended,
} from '@rtc-agent/protocol';
import {
  isErrorContentData as isErrorContentDataBase,
  isStringContentData,
  isSummaryContentData as isSummaryContentDataBase,
  isToolCallInputContent,
  isToolCallOutputContent,
} from '@rtc-agent/protocol';

// Re-export Protocol types for component use
export type { ErrorContent, SummaryContentData, ToolCall, ToolCallExtended };

// Re-export Protocol type guards for convenience.
//
// Naming note: `isSummaryContentDataBase` and `isErrorContentDataBase` are renamed
// to `isSummaryContentData` and `isErrorContentData` (dropping the "Base" suffix)
// because this module serves as the component layer's public API. The "Base" suffix
// in the protocol package distinguished the original definitions from these re-exports;
// here, the cleaner names are preferred since no naming collision exists in this scope.
export {
  /**
   * @see {@link import('@rtc-agent/protocol').isErrorContentData} — re-exported
   * without the "Base" suffix for component-layer convenience.
   */
  isErrorContentDataBase as isErrorContentData,
  isStringContentData,
  /**
   * @see {@link import('@rtc-agent/protocol').isSummaryContentData} — re-exported
   * without the "Base" suffix for component-layer convenience.
   */
  isSummaryContentDataBase as isSummaryContentData,
  isToolCallInputContent,
  isToolCallOutputContent,
};

/**
 * Extract ToolCall input data from ContentData with runtime validation.
 *
 * @param content - The ContentData object
 * @returns ToolCall if content.type is 'toolcall_input' and data is valid, undefined otherwise
 */
export function getToolCallInputData(
  content: ContentData | undefined | null,
): ToolCall | undefined {
  if (!content) return undefined;
  if (isToolCallInputContent(content)) {
    return content.data;
  }
  return undefined;
}

/**
 * Extract ToolCall output data from ContentData with runtime validation.
 *
 * @param content - The ContentData object
 * @returns ToolCall if content.type is 'toolcall_output' and data is valid, undefined otherwise
 */
export function getToolCallOutputData(
  content: ContentData | undefined | null,
): ToolCall | undefined {
  if (!content) return undefined;
  if (isToolCallOutputContent(content)) {
    return content.data;
  }
  return undefined;
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
  if (!content) return undefined;
  if (isSummaryContentDataBase(content)) {
    return content.data;
  }
  return undefined;
}

/**
 * Extract Error content data from ContentData with runtime validation.
 *
 * @param content - The ContentData object
 * @returns ErrorContent if content.type is 'error' and data is valid, undefined otherwise
 */
export function getErrorData(
  content: ContentData | undefined | null,
): ErrorContent | undefined {
  if (!content) return undefined;
  if (isErrorContentDataBase(content)) {
    return content.data;
  }
  return undefined;
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
  if (isStringContentData(content)) {
    return content.data;
  }
  return undefined;
}
