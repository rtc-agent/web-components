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
 * Format a number with thousand separators using current locale.
 *
 * Supports international number formatting:
 * - zh-CN: 123,456.78
 * - en-US: 123,456.78
 * - de-DE: 123.456,78
 *
 * @param num - Number to format
 * @param decimals - Number of decimal places (optional, auto-detect if not provided)
 * @param locale - Optional locale override (defaults to current locale)
 * @returns Formatted number string
 */
export function formatNumber(
  num: number | undefined | null,
  decimals?: number,
  locale?: string
): string {
  if (num === undefined || num === null || !isFinite(num)) return '0';

  const currentLocale = locale || getLocale();

  // If decimals is specified, use toFixed for exact control
  if (decimals !== undefined) {
    if (decimals < 0 || decimals > 20) {
      console.warn(`formatNumber: decimals ${decimals} out of range (0-20), using 0`);
      decimals = 0;
    }
    num = Number(num.toFixed(decimals));
  }

  try {
    return num.toLocaleString(currentLocale);
  } catch {
    // Fallback to US format if locale is invalid
    return num.toLocaleString('en-US');
  }
}

/**
 * Format a percentage with current locale.
 *
 * @param value - Value to format as percentage (0-1 or 0-100)
 * @param decimals - Number of decimal places (default: 1)
 * @param alreadyMultiplied - If true, value is already 0-100, otherwise multiply by 100
 * @returns Formatted percentage string
 */
export function formatPercentage(
  value: number | undefined | null,
  decimals: number = 1,
  alreadyMultiplied: boolean = false
): string {
  if (value === undefined || value === null || !isFinite(value)) return '0%';

  const percentValue = alreadyMultiplied ? value : value * 100;
  const locale = getLocale();

  try {
    return `${percentValue.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })}%`;
  } catch {
    return `${percentValue.toFixed(decimals)}%`;
  }
}

/**
 * Format bytes to human-readable size.
 *
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places (default: 2)
 * @param locale - Optional locale override (defaults to current locale)
 * @returns Human-readable size string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number | undefined | null, decimals: number = 2, locale?: string): string {
  if (bytes === undefined || bytes === null || bytes < 0) return `${msg('B')}`;
  if (bytes === 0) return `${0} ${msg('B')}`;

  const k = 1024;
  const sizes = [msg('B'), msg('KB'), msg('MB'), msg('GB'), msg('TB'), msg('PB')];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));
  const currentLocale = locale || getLocale();

  try {
    return `${value.toLocaleString(currentLocale)} ${sizes[i]}`;
  } catch {
    return `${value} ${sizes[i]}`;
  }
}

/**
 * Validate a date string or timestamp.
 *
 * @param value - Date string, timestamp, or Date object
 * @returns true if valid date, false otherwise
 */
export function isValidDate(value: unknown): boolean {
  if (value instanceof Date) {
    return !isNaN(value.getTime());
  }

  if (typeof value === 'number') {
    if (!isFinite(value)) return false;
    const date = new Date(value);
    return !isNaN(date.getTime());
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return !isNaN(date.getTime());
  }

  return false;
}

/**
 * Cache for DateTimeFormat instances to avoid repeated allocations.
 * Key format: `${locale}_${type}_${options_hash}`
 */
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Get or create a cached DateTimeFormat instance.
 */
function getCachedFormatter(
  locale: string,
  type: 'date' | 'time' | 'datetime',
  options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  // Build cache key from commonly-used option fields to avoid JSON.stringify overhead
  const optsKey = options
    ? `${options.year ?? ''}${options.month ?? ''}${options.day ?? ''}${options.hour ?? ''}${options.minute ?? ''}${options.second ?? ''}${options.hour12 ?? ''}${options.timeZone ?? ''}`
    : '';
  const cacheKey = `${locale}_${type}_${optsKey}`;

  let formatter = dateFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatterCache.set(cacheKey, formatter);
  }

  return formatter;
}

/**
 * Format a timestamp (ms since epoch) into a locale-aware compact string.
 *
 * Uses `Intl.DateTimeFormat` to produce a format appropriate for the current
 * locale. Only the month, day, hour, and minute are included — the year is
 * intentionally omitted because this helper is used in timeline dots and
 * message metadata where a full date would be excessive.
 *
 * Returns empty string for falsy input.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param timeZone - Optional IANA timezone name (e.g., 'Asia/Shanghai', 'America/New_York').
 *                   Defaults to system local timezone.
 */
export function formatTimestampCompact(
  timestamp: number | undefined | null,
  timeZone?: string,
): string {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  if (!isValidDate(date)) return '';

  const locale = getLocale();
  const options: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };

  if (timeZone) {
    options.timeZone = timeZone;
  }

  const formatter = getCachedFormatter(locale, 'datetime', options);
  return formatter.format(date);
}

/**
 * Format a timestamp as a full date and time string.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param showSeconds - Whether to show seconds (default: false)
 * @param timeZone - Optional IANA timezone name (e.g., 'Asia/Shanghai', 'America/New_York').
 *                   Defaults to system local timezone.
 * @returns Formatted date-time string
 */
export function formatDateTime(
  timestamp: number | undefined | null,
  showSeconds: boolean = false,
  timeZone?: string,
): string {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  if (!isValidDate(date)) return '';

  const locale = getLocale();
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };

  if (showSeconds) {
    options.second = '2-digit';
  }

  if (timeZone) {
    options.timeZone = timeZone;
  }

  const formatter = getCachedFormatter(locale, 'datetime', options);
  return formatter.format(date);
}

/**
 * Format a timestamp as a time-only string.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param showSeconds - Whether to show seconds (default: false)
 * @param timeZone - Optional IANA timezone name (e.g., 'Asia/Shanghai', 'America/New_York').
 *                   Defaults to system local timezone.
 * @returns Formatted time string
 */
export function formatTimeOnly(
  timestamp: number | undefined | null,
  showSeconds: boolean = false,
  timeZone?: string,
): string {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  if (!isValidDate(date)) return '';

  const locale = getLocale();
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };

  if (showSeconds) {
    options.second = '2-digit';
  }

  if (timeZone) {
    options.timeZone = timeZone;
  }

  const formatter = getCachedFormatter(locale, 'time', options);
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
