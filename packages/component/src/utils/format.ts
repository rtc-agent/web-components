/**
 * Format Utilities
 *
 * Shared formatting and content helpers used across multiple components.
 * Avoids duplicating timestamp/date logic and content extraction in
 * rtc-message, rtc-toolcall-card, rtc-user-message, etc.
 */

import type {ContentData, PromptContent} from '../types/index.js';
import {getLocale} from '../core/i18n.js';

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
      return getLocale() === 'en-US' ? '[Messages compressed]' : '[消息已被压缩]';
    case 'prompt': {
      // 提取 prompt 的可读文本用于剪贴板复制
      const pc = content.data as PromptContent;
      if (!pc) return '';
      const parts = [`[${pc.name}]`];
      if (pc.title) parts.push(pc.title);
      parts.push(pc.prompt);
      return parts.join('\n');
    }
    case 'user_message': {
      const data = content.data as {text?: string; scenarios?: Array<{title: string}>};
      let result = data?.text ?? '';
      if (data?.scenarios?.length) {
        const tags = data.scenarios.map(s => `#${s.title}`).join(' ');
        result = `${tags}\n${result}`;
      }
      return result;
    }
    case 'toolcall_input': {
      // 提取工具名称用于显示
      const data = content.data as { tool_name?: string; name?: string };
      return data?.tool_name || data?.name || '[工具调用]';
    }
    case 'toolcall_output': {
      // 提取工具名称用于显示
      const data = content.data as { tool_name?: string; name?: string };
      return data?.tool_name || data?.name || '[工具结果]';
    }
    case 'error': {
      // 提取错误标题或消息用于显示
      const data = content.data as { title?: string; message?: string };
      return data?.title || data?.message || '[错误]';
    }
    default:
      return typeof content.data === 'string' ? content.data : (content.data != null ? JSON.stringify(content.data) : '');
  }
}
