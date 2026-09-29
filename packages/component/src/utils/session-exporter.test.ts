// web-components/packages/component/src/utils/session-exporter.test.ts
import { describe, it, expect } from 'vitest';
import { generateFilename, shouldExpand, renderMessageContent } from './session-exporter.js';
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
});
