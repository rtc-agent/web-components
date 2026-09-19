import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-content-area.js';
import type {RtcContentArea} from './rtc-content-area.js';
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

    return {repository: mockRepository as MessageRepository} as MessageController;
};

describe('<rtc-content-area>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const sessionId = 'test-session';
        const controller = createMockController(sessionId, []);
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area .sessionId=${sessionId} .messageController=${controller}></rtc-content-area>`
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should show empty-state when no sessionId', async () => {
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`
        );
        await nextFrame();
        const empty = el.shadowRoot!.querySelector('rtc-empty-state');
        expect(empty).not.toBeNull();
    });

    it('should show message-list when sessionId is provided', async () => {
        const sessionId = 'test-session';
        const msgs: Message[] = [makeMsg('1', 'Hi')];
        const controller = createMockController(sessionId, msgs);
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area .sessionId=${sessionId} .messageController=${controller}></rtc-content-area>`
        );
        await nextFrame();
        const list = el.shadowRoot!.querySelector('rtc-message-list');
        expect(list).not.toBeNull();
        const empty = el.shadowRoot!.querySelector('rtc-empty-state');
        expect(empty).toBeNull();
    });

    it('should switch from empty to list when sessionId is set', async () => {
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-empty-state')).not.toBeNull();

        // Now set sessionId
        const sessionId = 'test-session';
        const controller = createMockController(sessionId, []);
        el.sessionId = sessionId;
        el.messageController = controller;
        await nextFrame();

        expect(el.shadowRoot!.querySelector('rtc-message-list')).not.toBeNull();
        expect(el.shadowRoot!.querySelector('rtc-empty-state')).toBeNull();
    });
});
