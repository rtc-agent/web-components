import { describe, it, expect } from 'vitest';
import { formatTimestampCompact, extractTextContent } from './format.js';
import type { ContentData } from '@rtc-agent/protocol';

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

    it('should format a timestamp as MM-DD HH:mm', () => {
        // Use a fixed timestamp: 2026-03-15 14:30:00 local time
        const date = new Date(2026, 2, 15, 14, 30, 0); // month is 0-indexed
        const result = formatTimestampCompact(date.getTime());
        expect(result).toBe('03-15 14:30');
    });

    it('should pad single-digit month and day', () => {
        const date = new Date(2026, 0, 5, 9, 5, 0); // Jan 5, 09:05
        const result = formatTimestampCompact(date.getTime());
        expect(result).toBe('01-05 09:05');
    });

    it('should handle December 31st 23:59', () => {
        const date = new Date(2026, 11, 31, 23, 59, 0);
        const result = formatTimestampCompact(date.getTime());
        expect(result).toBe('12-31 23:59');
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

    // ── User message ──

    it('should extract text from user_message without scenarios', () => {
        const content: ContentData = { type: 'user_message', data: { text: 'Hello' } };
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
        const content = { type: 'error' as any, data: 'Error message' };
        expect(extractTextContent(content)).toBe('Error message');
    });

    it('should JSON.stringify object data from unknown type', () => {
        const content = { type: 'toolcall_input' as any, data: { key: 'value' } };
        expect(extractTextContent(content)).toBe('{"key":"value"}');
    });

    it('should return empty string for null data in unknown type', () => {
        const content = { type: 'error' as any, data: null };
        expect(extractTextContent(content)).toBe('');
    });
});
