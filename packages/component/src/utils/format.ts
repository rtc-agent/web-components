/**
 * Format Utilities
 *
 * Shared formatting and content helpers used across multiple components.
 * Avoids duplicating timestamp/date logic and content extraction in
 * rtc-message, rtc-toolcall-card, rtc-user-message, etc.
 */

import type {ContentData} from '../types/index.js';

/**
 * Format a timestamp (ms since epoch) into a compact MM-DD HH:mm string.
 *
 * Used in timeline dots and message metadata where full dates are unnecessary.
 * Returns empty string for falsy input.
 */
export function formatTimestampCompact(timestamp: number | undefined | null): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

/**
 * Extract plain text content from a ContentData object.
 *
 * Handles all content types uniformly:
 * - text/markdown/thinking: return string data or JSON-stringify objects
 * - summary: return placeholder text
 * - other: best-effort string extraction
 *
 * Used for clipboard copy operations across message components.
 */
export function extractTextContent(content: ContentData | undefined | null): string {
  if (!content) return '';

  switch (content.type) {
    case 'text':
    case 'markdown':
    case 'thinking':
      return typeof content.data === 'string' ? content.data : JSON.stringify(content.data);
    case 'summary':
      return '[消息已被压缩]';
    default:
      return typeof content.data === 'string' ? content.data : (content.data != null ? JSON.stringify(content.data) : '');
  }
}
