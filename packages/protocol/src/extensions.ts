/**
 * Protocol Extensions - Manual type definitions extending auto-generated models
 *
 * This file contains type definitions that extend the auto-generated OpenAPI types
 * in models.gen.ts. These extensions are manually maintained and should NOT be
 * auto-generated.
 *
 * 此文件包含对 models.gen.ts 中自动生成的 OpenAPI 类型的扩展。
 * 这些扩展是手动维护的，不应被自动生成。
 *
 * ## ContentData.data Type Safety
 *
 * ContentData.data is typed as `unknown` in models.gen.ts because the OpenAPI spec
 * uses a oneOf schema that openapi-typescript cannot automatically narrow.
 *
 * To safely work with ContentData.data, use the type guards and typed utilities
 * in type-guards.ts:
 *
 * ```typescript
 * import {
 *   isValidContentData,
 *   isStringContentData,
 *   isMarkdownContent,
 *   isToolCallInputContent,
 *   TypedContentData,
 *   ContentDataTypeMap,
 * } from '@rtc-agent/protocol';
 *
 * // Type guard approach
 * if (isMarkdownContent(contentData)) {
 *   // contentData.data is now typed as string
 *   console.log(contentData.data);
 * }
 *
 * // Discriminated union approach
 * const markdown: TypedContentData<'markdown'> = {
 *   type: 'markdown',
 *   data: '# Hello'
 * };
 * ```
 *
 * The ContentDataTypeMap interface provides a mapping from ContentType to the
 * concrete type of the `data` field:
 *
 * - `markdown` → string
 * - `summary` → SummaryContentData[] (array of summary items)
 * - `text` → string
 * - `thinking` → string
 * - `toolcall_input` → ToolCall
 * - `toolcall_output` → ToolCall
 * - `user_message` → UserMessageContent
 * - `error` → ErrorContent
 * - `prompt` → PromptContent
 */

import type { components } from './models.gen.js';

// Extract base ToolCall type from OpenAPI components
type BaseToolCall = components['schemas']['ToolCall'];

/**
 * SummaryContentData - Structure for summary content
 *
 * Since the OpenAPI spec does not define the exact structure of SummaryItem,
 * we define a flexible but constrained type that represents an array of
 * summary items. Each item is a record with string keys and unknown values,
 * providing better type safety than `unknown` while maintaining flexibility.
 *
 * 由于 OpenAPI spec 没有定义 SummaryItem 的确切结构，
 * 我们定义了一个灵活但有约束的类型，表示摘要项的数组。
 * 每个项是一个带有字符串键和未知值的记录，
 * 在保持灵活性的同时提供了比 `unknown` 更好的类型安全。
 */
export type SummaryContentData = ReadonlyArray<Readonly<Record<string, unknown>>>;

/**
 * FileAttachmentExtra - Extended metadata for file attachments
 *
 * Provides additional information about file attachments beyond the required mimetype and fileid.
 * Common fields include filename, size, and mimeType for display and processing purposes.
 *
 * 为文件附件提供除必需的 mimetype 和 fileid 之外的额外元数据。
 * 常见字段包括用于显示和处理的 filename、size 和 mimeType。
 */
export interface FileAttachmentExtra {
  /** Original filename (e.g., "document.pdf") */
  filename?: string;
  /** File size in bytes */
  size?: number;
  /** MIME type (redundant with FileAttachment.mimetype, for convenience) */
  mimeType?: string;
  /** Additional custom properties */
  [key: string]: unknown;
}

/**
 * ToolCallExtended - Extended ToolCall with error information
 *
 * Extends the base ToolCall from OpenAPI spec with an optional `error` field
 * to capture tool execution errors. This is used by the frontend to display
 * error states in tool call cards.
 *
 * 扩展 OpenAPI spec 中的基础 ToolCall，添加可选的 `error` 字段
 * 以捕获工具执行错误。前端使用此字段在工具调用卡片中显示错误状态。
 */
export interface ToolCallExtended extends BaseToolCall {
  /** Error message if tool execution failed */
  error?: string;
}
