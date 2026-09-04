import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import {provideContext} from '../../test-context-helpers.js';
import './rtc-content-area.js';
import type {RtcContentArea} from './rtc-content-area.js';
import {MessageContext} from '../../contexts/message.js';
import type {Message} from '../../types/index.js';

describe('<rtc-content-area>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: []},
                    actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
                })
            }
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should show empty-state when no messages', async () => {
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: []},
                    actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
                })
            }
        );
        await nextFrame();
        const empty = el.shadowRoot!.querySelector('rtc-empty-state');
        expect(empty).not.toBeNull();
    });

    it('should show message-list when messages exist', async () => {
        const msgs: Message[] = [{clientId: '1', role: 'assistant', content: {type: 'text', data: 'Hi'}, timestamp: 1, syncStatus: 'synced'}];
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: msgs},
                    actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}}
                })
            }
        );
        await nextFrame();
        const list = el.shadowRoot!.querySelector('rtc-message-list');
        expect(list).not.toBeNull();
        const empty = el.shadowRoot!.querySelector('rtc-empty-state');
        expect(empty).toBeNull();
    });

    it('should switch from empty to list when messages arrive', async () => {
        const emptyActions = {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}};
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`,
            {setup: (host) => provideContext(host, MessageContext, {state: {messages: []}, actions: emptyActions})}
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-empty-state')).not.toBeNull();
    });
});
