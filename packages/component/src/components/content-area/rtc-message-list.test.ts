import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import {provideContext} from '../../test-context-helpers.js';
import './rtc-message-list.js';
import type {RtcMessageList} from './rtc-message-list.js';
import type {Message, ContentData} from '../../types/index.js';
import {MessageContext} from '../../contexts/message.js';

const makeMsg = (clientId: string, content: string): Message => ({
    clientId,
    role: 'assistant',
    content: {type: 'text', data: content} as ContentData,
    timestamp: Date.now(),
    syncStatus: 'synced',
});

describe('<rtc-message-list>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: []},
                    actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
                })
            }
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should render empty when no messages', async () => {
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: []},
                    actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
                })
            }
        );
        await nextFrame();
        const items = el.shadowRoot!.querySelectorAll('rtc-message');
        expect(items.length).toBe(0);
    });

    it('should render messages from context', async () => {
        const messages = [
            makeMsg('1', 'Hello'),
            makeMsg('2', 'World'),
        ];
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages},
                    actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
                })
            }
        );
        await nextFrame();
        const items = el.shadowRoot!.querySelectorAll('rtc-message');
        expect(items.length).toBe(2);
    });

    it('should mark last message with is-last attribute', async () => {
        const messages = [
            makeMsg('1', 'First'),
            makeMsg('2', 'Last'),
        ];
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages},
                    actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
                })
            }
        );
        await nextFrame();
        const items = el.shadowRoot!.querySelectorAll('rtc-message');
        expect(items[0].hasAttribute('is-last')).toBe(false);
        expect(items[1].hasAttribute('is-last')).toBe(true);
    });

    it('should have a scroll container', async () => {
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: []},
                    actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
                })
            }
        );
        await nextFrame();
        const container = el.shadowRoot!.querySelector('.message-list-scroll');
        expect(container).not.toBeNull();
    });
});
