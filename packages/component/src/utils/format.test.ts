import type { ContentData } from '@rtc-agent/protocol';
import { describe, expect, it } from 'vitest';
import { getLocale } from '../core/i18n.js';
import {
  extractTextContent,
  formatCurrency,
  formatTimestampCompact,
} from './format.js';

describe('formatTimestampCompact', () => {
  // ── Falsy inputs ──

  it('should return empty string for undefined', () => {
    expect(formatTimestampCompact(undefined)).toBe('');
  });

  it('should return empty string for null', () => {
    expect(formatTimestampCompact(null)).toBe('');
  });

  it('should return empty string for 0', () => {
    expect(formatTimestampCompact(0)).toBe('');
  });

  // ── Valid timestamps ──
  //
  // The output format is locale-aware via `Intl.DateTimeFormat`, so tests
  // compute the expected value using the same Intl API with the current
  // locale from `getLocale()` to stay consistent regardless of the active locale.

  const makeFormatter = () =>
    new Intl.DateTimeFormat(getLocale(), {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  it('should format a timestamp using locale-aware compact format', () => {
    const date = new Date(2026, 2, 15, 14, 30, 0); // month is 0-indexed
    const result = formatTimestampCompact(date.getTime());
    expect(result).toBe(makeFormatter().format(date));
  });

  it('should pad single-digit month and day', () => {
    const date = new Date(2026, 0, 5, 9, 5, 0); // Jan 5, 09:05
    const result = formatTimestampCompact(date.getTime());
    expect(result).toBe(makeFormatter().format(date));
  });

  it('should handle December 31st 23:59', () => {
    const date = new Date(2026, 11, 31, 23, 59, 0);
    const result = formatTimestampCompact(date.getTime());
    expect(result).toBe(makeFormatter().format(date));
  });
});

describe('extractTextContent', () => {
  // ── Null/undefined ──

  it('should return empty string for undefined', () => {
    expect(extractTextContent(undefined)).toBe('');
  });

  it('should return empty string for null', () => {
    expect(extractTextContent(null)).toBe('');
  });

  // ── Text types ──

  it('should extract string data from text content', () => {
    const content: ContentData = { type: 'text', data: 'Hello world' };
    expect(extractTextContent(content)).toBe('Hello world');
  });

  it('should extract string data from markdown content', () => {
    const content: ContentData = { type: 'markdown', data: '# Title' };
    expect(extractTextContent(content)).toBe('# Title');
  });

  it('should extract string data from thinking content', () => {
    const content: ContentData = { type: 'thinking', data: 'Let me think...' };
    expect(extractTextContent(content)).toBe('Let me think...');
  });

  it('should JSON.stringify object data for text type', () => {
    const content: ContentData = { type: 'text', data: { nested: true } };
    expect(extractTextContent(content)).toBe('{"nested":true}');
  });

  // ── Summary ──

  it('should return placeholder for summary content', () => {
    const content: ContentData = { type: 'summary', data: 'some old data' };
    expect(extractTextContent(content)).toBe('[消息已被压缩]');
  });

  // ── Prompt ──

  it('should extract readable text from prompt content', () => {
    const content: ContentData = {
      type: 'prompt',
      data: {
        name: 'scenarios',
        title: 'Task A, Task B',
        prompt: '# Task A\n\nContent A\n\n# Task B\n\nContent B',
      },
    };
    expect(extractTextContent(content)).toBe(
      '[scenarios]\nTask A, Task B\n# Task A\n\nContent A\n\n# Task B\n\nContent B',
    );
  });

  it('should handle prompt content without title', () => {
    const content: ContentData = {
      type: 'prompt',
      data: { name: 'goal', prompt: 'Complete the task' },
    };
    expect(extractTextContent(content)).toBe('[goal]\nComplete the task');
  });

  it('should handle prompt content with null data', () => {
    const content = { type: 'prompt' as const, data: null };
    expect(extractTextContent(content)).toBe('');
  });

  // ── User message ──

  it('should extract text from user_message without scenarios', () => {
    const content: ContentData = {
      type: 'user_message',
      data: { text: 'Hello' },
    };
    expect(extractTextContent(content)).toBe('Hello');
  });

  it('should prepend scenario tags to user_message text', () => {
    const content: ContentData = {
      type: 'user_message',
      data: {
        text: 'Please help',
        scenarios: [{ title: 'Task A' }, { title: 'Task B' }],
      },
    };
    expect(extractTextContent(content)).toBe('#Task A #Task B\nPlease help');
  });

  it('should handle user_message with empty text and scenarios', () => {
    const content: ContentData = {
      type: 'user_message',
      data: { text: '', scenarios: [{ title: 'OnlyTag' }] },
    };
    expect(extractTextContent(content)).toBe('#OnlyTag\n');
  });

  it('should handle user_message with missing data', () => {
    const content: ContentData = { type: 'user_message', data: {} };
    expect(extractTextContent(content)).toBe('');
  });

  // ── Unknown/other types ──

  it('should extract string data from unknown type', () => {
    const content = { type: 'unknown_type' as any, data: 'Error message' };
    expect(extractTextContent(content)).toBe('Error message');
  });

  it('should JSON.stringify object data from unknown type', () => {
    const content = { type: 'unknown_type' as any, data: { key: 'value' } };
    expect(extractTextContent(content)).toBe('{"key":"value"}');
  });

  it('should return empty string for null data in unknown type', () => {
    const content = { type: 'unknown_type' as any, data: null };
    expect(extractTextContent(content)).toBe('');
  });
});

describe('formatCurrency', () => {
  // ── Null/undefined/invalid inputs ──

  it('should return "USD 0.00" for undefined', () => {
    expect(formatCurrency(undefined)).toBe('USD 0.00');
  });

  it('should return "USD 0.00" for null', () => {
    expect(formatCurrency(null)).toBe('USD 0.00');
  });

  it('should return "USD 0.00" for NaN', () => {
    expect(formatCurrency(NaN)).toBe('USD 0.00');
  });

  it('should return "USD 0.00" for Infinity', () => {
    expect(formatCurrency(Infinity)).toBe('USD 0.00');
  });

  // ── Basic formatting ──

  it('should format a positive amount in USD', () => {
    const result = formatCurrency(123.45, 'USD', 'en-US');
    expect(result).toBe('$123.45');
  });

  it('should format a negative amount in USD', () => {
    const result = formatCurrency(-123.45, 'USD', 'en-US');
    expect(result).toBe('-$123.45');
  });

  it('should format zero', () => {
    const result = formatCurrency(0, 'USD', 'en-US');
    expect(result).toBe('$0.00');
  });

  // ── Different currencies ──

  it('should format in EUR with German locale', () => {
    const result = formatCurrency(123.45, 'EUR', 'de-DE');
    // German format: 123,45 € (with non-breaking space)
    expect(result).toMatch(/123[,.]45\s*€/);
  });

  it('should format in CNY with Chinese locale', () => {
    const result = formatCurrency(123.45, 'CNY', 'zh-CN');
    expect(result).toMatch(/¥123\.45/);
  });

  // ── Different locales ──

  it('should format the same amount differently based on locale', () => {
    const usResult = formatCurrency(1234.56, 'USD', 'en-US');
    const deResult = formatCurrency(1234.56, 'USD', 'de-DE');
    // US: $1,234.56, DE: 1.234,56 $
    expect(usResult).toMatch(/1,234\.56/);
    expect(deResult).toMatch(/1\.234,56/);
  });

  // ── Fallback behavior ──

  it('should handle invalid locale gracefully', () => {
    // Intl.NumberFormat is lenient with invalid locales and will attempt to use a fallback
    const result = formatCurrency(123.45, 'USD', 'invalid-locale');
    // Should still produce a valid currency string (may use system fallback)
    expect(result).toMatch(/\$?123\.45/);
  });

  it('should handle large amounts', () => {
    const result = formatCurrency(1234567.89, 'USD', 'en-US');
    expect(result).toMatch(/1,234,567\.89/);
  });
});
