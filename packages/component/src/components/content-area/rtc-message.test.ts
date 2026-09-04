import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-message.js';
import type {Message} from '../../types/index.js';

const makeMsg = (overrides: Partial<Message> = {}): Message => ({
    clientId: 'msg-1',
    role: 'assistant',
    content: {type: 'text', data: 'Hello world'},
    timestamp: Date.now(),
    syncStatus: 'synced',
    ...overrides,
});

describe('<rtc-message>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-message .message=${makeMsg()}></rtc-message>`
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should render a timeline dot', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-message .message=${makeMsg()}></rtc-message>`
        );
        await nextFrame();
        const dot = el.shadowRoot!.querySelector('.timeline-dot');
        expect(dot).not.toBeNull();
    });

    it('should render message content', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-message .message=${makeMsg({content: {type: 'text', data: 'Test content'}})}></rtc-message>`
        );
        await nextFrame();
        const content = el.shadowRoot!.querySelector('.timeline-content');
        expect(content).not.toBeNull();
        expect(content!.textContent).toContain('Test content');
    });

    it('should render thinking content as collapsible block', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-message .message=${makeMsg({content: {type: 'thinking', data: 'thinking content'}})}></rtc-message>`
        );
        await nextFrame();
        const block = el.shadowRoot!.querySelector('.thinking-block');
        expect(block).not.toBeNull();
        const label = el.shadowRoot!.querySelector('.thinking-label');
        expect(label!.textContent).toContain('思考过程');
    });

    it('should apply success class for completed last messages', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-message .message=${makeMsg({streaming: false})} is-last></rtc-message>`
        );
        await nextFrame();
        const item = el.shadowRoot!.querySelector('.timeline-item');
        expect(item!.classList.contains('success')).toBe(true);
    });

    it('should render Markdown as HTML', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-message .message=${makeMsg({content: {type: 'text', data: '**bold text**'}})}></rtc-message>`
        );
        // Wait for lazy-loaded marked + dompurify to parse
        await nextFrame();
        await new Promise(r => setTimeout(r, 100));
        await nextFrame();
        const content = el.shadowRoot!.querySelector('.timeline-content');
        const strong = content!.querySelector('strong');
        expect(strong).not.toBeNull();
        expect(strong!.textContent).toBe('bold text');
    });

    it('should apply syntax highlighting to fenced code blocks', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-message .message=${makeMsg({content: {type: 'text', data: '```typescript\nconst x: number = 1;\n```'}})}></rtc-message>`
        );
        // Wait for lazy-loaded marked + dompurify + hljs pipeline
        await nextFrame();
        await new Promise(r => setTimeout(r, 200));
        await nextFrame();
        const content = el.shadowRoot!.querySelector('.timeline-content');
        const code = content!.querySelector('pre code');
        expect(code).not.toBeNull();
        // highlight.js adds .hljs class and <span class="hljs-*"> tokens
        expect(code!.classList.contains('hljs')).toBe(true);
        const keywordSpan = code!.querySelector('.hljs-keyword');
        expect(keywordSpan).not.toBeNull();
    });

    it('should preserve XSS safety after highlighting', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-message .message=${makeMsg({content: {type: 'text', data: '```html\n<script>alert(1)</script>\n```'}})}></rtc-message>`
        );
        await nextFrame();
        await new Promise(r => setTimeout(r, 200));
        await nextFrame();
        const content = el.shadowRoot!.querySelector('.timeline-content');
        // DOMPurify must have stripped the <script> tag even after hljs processing
        const script = content!.querySelector('script');
        expect(script).toBeNull();
    });
});
