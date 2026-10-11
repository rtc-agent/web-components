/**
 * Format Utilities
 *
 * Shared formatting and content helpers used across multiple components.
 * Avoids duplicating timestamp/date logic and content extraction in
 * rtc-message, rtc-toolcall-card, rtc-user-message, etc.
 */

import type { ContentData, PromptContent } from '../types/index.js';
import { msg, str } from '@lit/localize';
import { getLocale } from '../core/i18n.js';

/**
 * Format a timestamp (ms since epoch) into a locale-aware compact string.
 *
 * Uses `Intl.DateTimeFormat` to produce a format appropriate for the current
 * locale. Only the month, day, hour, and minute are included — the year is
 * intentionally omitted because this helper is used in timeline dots and
 * message metadata where a full date would be excessive.
 *
 * Returns empty string for falsy input.
 */
export function formatTimestampCompact(
  timestamp: number | undefined | null,
): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const locale = getLocale();

  const formatter = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return formatter.format(date);
}

/**
 * Format a ban reason into a user-facing toast message.
 *
 * Shared across worker-bridge (sessionStorage path), event-binding controller,
 * and rtc-agent connectedCallback to ensure consistent wording.
 *
 * @param reason - Optional ban reason from the server disconnect frame.
 * @returns Localized ban message suitable for toast display.
 */
export function formatBanMessage(reason?: string): string {
  return reason
    ? msg(str`您的账号已被封禁：${reason}`)
    : msg('您的账号已被封禁，请联系管理员');
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
export function extractTextContent(
  content: ContentData | undefined | null,
): string {
  if (!content) return '';

  switch (content.type) {
    case 'text':
    case 'markdown':
    case 'thinking':
      return typeof content.data === 'string'
        ? content.data
        : JSON.stringify(content.data);
    case 'summary':
      return msg('[消息已被压缩]');
    case 'prompt': {
      // Extract readable text from prompt for clipboard copy
      const pc = content.data as PromptContent;
      if (!pc) return '';
      const parts = [`[${pc.name}]`];
      if (pc.title) parts.push(pc.title);
      parts.push(pc.prompt);
      return parts.join('\n');
    }
    case 'user_message': {
      const data = content.data as {
        text?: string;
        scenarios?: Array<{ title: string }>;
      };
      let result = data?.text ?? '';
      if (data?.scenarios?.length) {
        const tags = data.scenarios.map((s) => `#${s.title}`).join(' ');
        result = `${tags}\n${result}`;
      }
      return result;
    }
    case 'toolcall_input': {
      // Extract tool name for display
      const data = content.data as { tool_name?: string; name?: string };
      return data?.tool_name || data?.name || msg('[工具调用]');
    }
    case 'toolcall_output': {
      // Extract tool name for display
      const data = content.data as { tool_name?: string; name?: string };
      return data?.tool_name || data?.name || msg('[工具结果]');
    }
    case 'error': {
      // Extract error title or message for display
      const data = content.data as { title?: string; message?: string };
      return data?.title || data?.message || msg('[错误]');
    }
    default:
      return typeof content.data === 'string'
        ? content.data
        : content.data != null
          ? JSON.stringify(content.data)
          : '';
  }
}
