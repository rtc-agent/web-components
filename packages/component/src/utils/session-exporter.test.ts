// web-components/packages/component/src/utils/session-exporter.test.ts
import { describe, it, expect } from 'vitest';
import { generateFilename, shouldExpand, renderMessageContent, getPreviewText, generateSessionHTML } from './session-exporter.js';
import type { Session, Message } from '../types/index.js';

describe('session-exporter', () => {
    describe('generateFilename', () => {
        it('should generate filename with title and date', () => {
            const session: Session = {
                clientId: 'test-1',
                title: '调试问题',
                createdAt: new Date('2026-09-29T14:23:00').getTime(),
                updatedAt: Date.now(),
                status: 'active',
            } as Session;

            const filename = generateFilename(session);
            expect(filename).toBe('rtc-调试问题-2026-09-29.html');
        });

        it('should replace illegal filename characters', () => {
            const session: Session = {
                clientId: 'test-2',
                title: 'Test: File/Name<>',
                createdAt: new Date('2026-09-29').getTime(),
                updatedAt: Date.now(),
                status: 'active',
            } as Session;

            const filename = generateFilename(session);
            expect(filename).not.toContain(':');
            expect(filename).not.toContain('/');
            expect(filename).not.toContain('<');
            expect(filename).not.toContain('>');
        });

        it('should replace spaces with hyphens', () => {
            const session: Session = {
                clientId: 'test-3',
                title: 'Hello World Test',
                createdAt: new Date('2026-09-29').getTime(),
                updatedAt: Date.now(),
                status: 'active',
            } as Session;

            const filename = generateFilename(session);
            expect(filename).toBe('rtc-Hello-World-Test-2026-09-29.html');
        });

        it('should truncate long titles to 50 characters', () => {
            const longTitle = 'a'.repeat(100);
            const session: Session = {
                clientId: 'test-4',
                title: longTitle,
                createdAt: new Date('2026-09-29').getTime(),
                updatedAt: Date.now(),
                status: 'active',
            } as Session;

            const filename = generateFilename(session);
            // rtc- (4) + title (50) + - (1) + date (10) + .html (5) = 70
            expect(filename.length).toBeLessThanOrEqual(70);
        });
    });

    describe('shouldExpand', () => {
        it('should expand user messages', () => {
            const msg: Message = {
                clientId: 'msg-1',
                role: 'user',
                content: { type: 'user_message', data: { text: 'Hello' } },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            expect(shouldExpand(msg)).toBe(true);
        });

        it('should expand assistant markdown messages', () => {
            const msg: Message = {
                clientId: 'msg-2',
                role: 'assistant',
                content: { type: 'markdown', data: '# Title' },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            expect(shouldExpand(msg)).toBe(true);
        });

        it('should collapse toolcall_input messages', () => {
            const msg: Message = {
                clientId: 'msg-3',
                role: 'assistant',
                content: { type: 'toolcall_input', data: { id: 'tc-0', tool_name: 'read_file', input: {} } },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            expect(shouldExpand(msg)).toBe(false);
        });

        it('should collapse thinking messages', () => {
            const msg: Message = {
                clientId: 'msg-4',
                role: 'assistant',
                content: { type: 'thinking', data: 'Let me think...' },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            expect(shouldExpand(msg)).toBe(false);
        });
    });

    describe('renderMessageContent', () => {
        it('should render user message text', async () => {
            const msg: Message = {
                clientId: 'msg-1',
                role: 'user',
                content: { type: 'user_message', data: { text: 'Hello **world**' } },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const html = await renderMessageContent(msg);
            expect(html).toContain('Hello');
            expect(html).toContain('<strong>world</strong>');
        });

        it('should render assistant markdown', async () => {
            const msg: Message = {
                clientId: 'msg-2',
                role: 'assistant',
                content: { type: 'markdown', data: '# Title\n\nParagraph' },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const html = await renderMessageContent(msg);
            expect(html).toContain('<h1>');
            expect(html).toContain('Title');
            expect(html).toContain('<p>');
        });

        it('should escape HTML in text content', async () => {
            const msg: Message = {
                clientId: 'msg-3',
                role: 'assistant',
                content: { type: 'text', data: '<script>alert("xss")</script>' },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const html = await renderMessageContent(msg);
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;');
        });

        it('should sanitize markdown HTML via DOMPurify', async () => {
            const msg: Message = {
                clientId: 'msg-4',
                role: 'assistant',
                content: { type: 'markdown', data: 'Hello <script>alert("xss")</script>' },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const html = await renderMessageContent(msg);
            expect(html).not.toContain('<script>');
            expect(html).toContain('Hello');
        });
    });

    describe('getPreviewText', () => {
        it('should return tool_name for toolcall_input', () => {
            const msg: Message = {
                clientId: 'msg-1',
                role: 'assistant',
                content: { type: 'toolcall_input', data: { id: 'tc-1', tool_name: 'read_file', input: { path: '/test' } } },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const preview = getPreviewText(msg);
            expect(preview).toBe('read_file');
        });

        it('should handle toolcall_input with JSON string data', () => {
            const msg: Message = {
                clientId: 'msg-1b',
                role: 'assistant',
                content: { type: 'toolcall_input', data: JSON.stringify({ tool_name: 'script' }) },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const preview = getPreviewText(msg);
            expect(preview).toBe('script');
        });

        it('should return fallback for toolcall_input without tool_name', () => {
            const msg: Message = {
                clientId: 'msg-2',
                role: 'assistant',
                content: { type: 'toolcall_input', data: {} },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const preview = getPreviewText(msg);
            expect(preview).toBe('Tool Call');
        });

        it('should return "推理过程" for thinking', () => {
            const msg: Message = {
                clientId: 'msg-3',
                role: 'assistant',
                content: { type: 'thinking', data: 'Let me analyze...' },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const preview = getPreviewText(msg);
            expect(preview).toBe('推理过程');
        });

        it('should return error title for error', () => {
            const msg: Message = {
                clientId: 'msg-4',
                role: 'assistant',
                content: { type: 'error', data: { title: 'API Error', message: 'Rate limit exceeded' } },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const preview = getPreviewText(msg);
            expect(preview).toBe('API Error');
        });

        it('should return prompt name for prompt', () => {
            const msg: Message = {
                clientId: 'msg-5',
                role: 'system',
                content: { type: 'prompt', data: { name: 'goal', prompt: '...' } },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const preview = getPreviewText(msg);
            expect(preview).toBe('Prompt: goal');
        });

        it('should return "对话摘要" for summary', () => {
            const msg: Message = {
                clientId: 'msg-6',
                role: 'assistant',
                content: { type: 'summary', data: 'Summary text' },
                timestamp: Date.now(),
                syncStatus: 'synced',
            } as Message;

            const preview = getPreviewText(msg);
            expect(preview).toBe('对话摘要');
        });
    });

    describe('generateSessionHTML', () => {
        it('should generate valid HTML document', async () => {
            const session: Session = {
                clientId: 'session-1',
                title: 'Test Session',
                createdAt: new Date('2026-09-29T14:23:00').getTime(),
                updatedAt: Date.now(),
                status: 'active',
                totalInputTokens: 1000,
                totalOutputTokens: 500,
            } as Session;

            const messages: Message[] = [
                {
                    clientId: 'msg-1',
                    role: 'user',
                    content: { type: 'user_message', data: { text: 'Hello' } },
                    timestamp: Date.now(),
                    syncStatus: 'synced',
                } as Message,
            ];

            const html = await generateSessionHTML(session, messages);

            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('<html');
            expect(html).toContain('Test Session');
            expect(html).toContain('Hello');
            expect(html).toContain('</html>');
        });

        it('should include token statistics', async () => {
            const session: Session = {
                clientId: 'session-2',
                title: 'Token Test',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                status: 'active',
                totalInputTokens: 12458,
                totalOutputTokens: 3271,
                totalCachedReadTokens: 8120,
                totalCostUsd: 0.042,
            } as Session;

            const html = await generateSessionHTML(session, []);

            expect(html).toContain('12,458');
            expect(html).toContain('3,271');
            expect(html).toContain('8,120');
            expect(html).toContain('$0.042');
        });

        it('should handle undefined token fields gracefully', async () => {
            const session: Session = {
                clientId: 'session-no-tokens',
                title: 'No Tokens',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                status: 'active',
                // No token fields set — all optional
            } as Session;

            const html = await generateSessionHTML(session, []);

            // Should render "0" for undefined token values, not crash
            expect(html).toContain('输入 Tokens: <strong>0</strong>');
            expect(html).toContain('总花费: <strong>$0.000</strong>');
        });

        it('should render expanded and collapsed messages correctly', async () => {
            const session: Session = {
                clientId: 'session-3',
                title: 'Message Test',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                status: 'active',
            } as Session;

            const messages: Message[] = [
                {
                    clientId: 'msg-1',
                    role: 'user',
                    content: { type: 'user_message', data: { text: 'User message' } },
                    timestamp: Date.now(),
                    syncStatus: 'synced',
                } as Message,
                {
                    clientId: 'msg-2',
                    role: 'assistant',
                    content: { type: 'toolcall_input', data: { id: 'tc-1', tool_name: 'read_file', input: {} } },
                    timestamp: Date.now(),
                    syncStatus: 'synced',
                } as Message,
            ];

            const html = await generateSessionHTML(session, messages);

            // User message should be expanded (no <details> wrapper)
            expect(html).toContain('User message');
            expect(html).toContain('class="message user"');

            // Tool call should be collapsed (wrapped in <details>)
            expect(html).toContain('<details>');
            expect(html).toContain('read_file');
        });
    });
});
