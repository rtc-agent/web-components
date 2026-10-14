/**
 * Protocol Extensions - Manual type definitions extending auto-generated models
 *
 * This file contains type definitions that extend the auto-generated OpenAPI types
 * in models.gen.ts. These extensions are manually maintained and should NOT be
 * auto-generated.
 *
 * 此文件包含对 models.gen.ts 中自动生成的 OpenAPI 类型的扩展。
 * 这些扩展是手动维护的，不应被自动生成。
 */

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
