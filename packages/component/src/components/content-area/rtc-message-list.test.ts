import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-message-list.js';
import type {RtcMessageList} from './rtc-message-list.js';
import type {Message, ContentData, MessageState} from '../../types/index.js';
import type {MessageController} from '../../controllers/message.controller.js';
import type {MessageRepository} from '../../repositories/message.repository.js';

const makeMsg = (clientId: string, content: string): Message => ({
    clientId,
    role: 'assistant',
    content: {type: 'text', data: content} as ContentData,
    timestamp: Date.now(),
    syncStatus: 'synced',
});

/**
 * Create a mock MessageController with a repository that returns the given messages.
 */
const createMockController = (sessionId: string, messages: Message[]): MessageController => {
    const state: MessageState = {messages, hasMore: false, isLoadingMore: false};
    const subscribers = new Set<(state: MessageState) => void>();

    const mockRepository: Partial<MessageRepository> = {
        subscribe: (sid: string, callback: (state: MessageState) => void) => {
            if (sid === sessionId) {
                subscribers.add(callback);
                // Immediately notify with current state
                callback(state);
            }
            return () => subscribers.delete(callback);
        },
        getSessionState: (sid: string) => {
            return sid === sessionId ? state : {messages: [], hasMore: false, isLoadingMore: false};
        },
        updateMessages: (sid: string, newMessages: Message[]) => {
            if (sid === sessionId) {
                state.messages = newMessages;
                subscribers.forEach(cb => cb(state));
            }
        },
    };

    return {
        repository: mockRepository as MessageRepository,
        fetchInitialMessages: async () => {},
    } as MessageController;
};

describe('<rtc-message-list>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const sessionId = 'test-session';
        const controller = createMockController(sessionId, []);
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .sessionId=${sessionId} .messageController=${controller}></rtc-message-list>`
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should render empty when no messages', async () => {
        const sessionId = 'test-session';
        const controller = createMockController(sessionId, []);
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .sessionId=${sessionId} .messageController=${controller}></rtc-message-list>`
        );
        await nextFrame();
        const items = el.shadowRoot!.querySelectorAll('rtc-message');
        expect(items.length).toBe(0);
    });

    it('should render messages from repository', async () => {
        const sessionId = 'test-session';
        const messages = [
            makeMsg('1', 'Hello'),
            makeMsg('2', 'World'),
        ];
        const controller = createMockController(sessionId, messages);
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .sessionId=${sessionId} .messageController=${controller}></rtc-message-list>`
        );
        await nextFrame();
        const items = el.shadowRoot!.querySelectorAll('rtc-message');
        expect(items.length).toBe(2);
    });

    it('should mark last message with is-last attribute', async () => {
        const sessionId = 'test-session';
        const messages = [
            makeMsg('1', 'First'),
            makeMsg('2', 'Last'),
        ];
        const controller = createMockController(sessionId, messages);
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .sessionId=${sessionId} .messageController=${controller}></rtc-message-list>`
        );
        await nextFrame();
        await nextFrame(); // Extra frame for virtual scroll to render
        const items = el.shadowRoot!.querySelectorAll('rtc-message');
        expect(items.length).toBe(2);
        expect(items[0].hasAttribute('is-last')).toBe(false);
        expect(items[1].hasAttribute('is-last')).toBe(true);
    });

    it('should have a scroll container', async () => {
        const sessionId = 'test-session';
        const controller = createMockController(sessionId, []);
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .sessionId=${sessionId} .messageController=${controller}></rtc-message-list>`
        );
        await nextFrame();
        const container = el.shadowRoot!.querySelector('.message-list-scroll');
        expect(container).not.toBeNull();
    });
});
