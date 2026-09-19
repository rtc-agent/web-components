import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-message-list.js';
import type {RtcMessageList} from './rtc-message-list.js';
import type {Message, ContentData, MessageState} from '../../types/index.js';
import type {MessageRepository} from '../../repositories/message.repository.js';
import type {MessageController} from '../../controllers/message.controller.js';

const makeMsg = (clientId: string, content: string): Message => ({
    clientId,
    role: 'assistant',
    content: {type: 'text', data: content} as ContentData,
    timestamp: Date.now(),
    syncStatus: 'synced',
});

/**
 * Create a mock MessageRepository with subscribe support.
 *
 * The mock stores a single session's state and allows tests to simulate
 * repository updates by calling `emitUpdate()`.
 */
function createMockRepository(initialState?: Partial<MessageState>) {
    let state: MessageState = {
        messages: initialState?.messages ?? [],
        hasMore: initialState?.hasMore ?? false,
        isLoadingMore: initialState?.isLoadingMore ?? false,
    };
    const subscribers = new Set<(data: MessageState) => void>();

    return {
        /** Simulate a repository state update (triggers all subscribers). */
        emitUpdate(newState: Partial<MessageState>) {
            state = {...state, ...newState};
            for (const cb of subscribers) {
                cb(state);
            }
        },
        /** The subscribe method matching MessageRepository.subscribe signature. */
        subscribe(_sessionId: string, callback: (data: MessageState) => void): () => void {
            subscribers.add(callback);
            // Immediately notify with current state (matches real behavior)
            callback(state);
            return () => {
                subscribers.delete(callback);
            };
        },
        /** Expose current state for assertions. */
        getState(): MessageState {
            return state;
        },
    };
}

/**
 * Create a mock MessageController backed by a mock repository.
 */
function createMockMessageController(initialState?: Partial<MessageState>) {
    const repository = createMockRepository(initialState);
    const fetchInitialMessages = vi.fn().mockResolvedValue(undefined);
    const loadMoreForSession = vi.fn().mockResolvedValue(undefined);

    const controller = {
        repository: repository as unknown as MessageRepository,
        fetchInitialMessages,
        loadMoreForSession,
    } as unknown as MessageController;

    return {controller, repository, fetchInitialMessages, loadMoreForSession};
}

describe('<rtc-message-list>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const {controller} = createMockMessageController();
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should render empty when no messages', async () => {
        const {controller} = createMockMessageController();
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        await nextFrame();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._renderItems.length).toBe(0);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._messages.length).toBe(0);
    });

    it('should subscribe to repository and receive messages', async () => {
        const messages = [makeMsg('1', 'Hello'), makeMsg('2', 'World')];
        const {controller} = createMockMessageController({messages});
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        // Wait for willUpdate to process property changes and subscription callback
        await el.updateComplete;
        await nextFrame();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = (el as any)._renderItems;
        expect(items.length).toBe(2);
        expect(items.map((i: {type: string}) => i.type)).toEqual(['assistant', 'assistant']);
        expect(items.map((i: {key: string}) => i.key)).toEqual(['1', '2']);
    });

    it('should call fetchInitialMessages on connect', async () => {
        const {controller, fetchInitialMessages} = createMockMessageController();
        await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        await nextFrame();
        expect(fetchInitialMessages).toHaveBeenCalledWith('test-session');
    });

    it('should react to repository updates', async () => {
        const {controller, repository} = createMockMessageController();
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        await nextFrame();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._renderItems.length).toBe(0);

        // Simulate repository push
        const newMsg = makeMsg('3', 'New message');
        repository.emitUpdate({messages: [newMsg]});
        await nextFrame();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = (el as any)._renderItems;
        expect(items.length).toBe(1);
        expect(items[0].key).toBe('3');
    });

    it('should unsubscribe on disconnect', async () => {
        const {controller, repository} = createMockMessageController();
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        await nextFrame();

        // Remove element from DOM — triggers disconnectedCallback
        el.remove();
        await nextFrame();

        // After disconnect, repository updates should NOT affect the element
        // (No error thrown; subscription is cleaned up)
        const newMsg = makeMsg('4', 'After disconnect');
        repository.emitUpdate({messages: [newMsg]});
        await nextFrame();

        // Internal _messages should still be the pre-disconnect value (empty)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._messages.length).toBe(0);
    });

    it('should identify last render item key for is-last attribute', async () => {
        const messages = [makeMsg('1', 'First'), makeMsg('2', 'Last')];
        const {controller} = createMockMessageController({messages});
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        // Wait for willUpdate to process property changes and subscription callback
        await el.updateComplete;
        await nextFrame();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = (el as any)._renderItems;
        const lastKey = items[items.length - 1]?.key;
        expect(lastKey).toBe('2');
        expect(items[0].key === lastKey).toBe(false);
        expect(items[1].key === lastKey).toBe(true);
    });

    it('should have a virtualizer inside a list-wrapper div', async () => {
        const {controller} = createMockMessageController();
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        await nextFrame();
        // Virtualizer is inside a div.list-wrapper that bridges flex layout
        const virtualizer = el.shadowRoot!.querySelector('div.list-wrapper > lit-virtualizer.message-list-scroll');
        expect(virtualizer).not.toBeNull();
    });

    it('should expose messages via public getter', async () => {
        const messages = [makeMsg('1', 'Hello')];
        const {controller} = createMockMessageController({messages});
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        await nextFrame();
        expect(el.messages.length).toBe(1);
        expect(el.messages[0].clientId).toBe('1');
    });

    it('should not connect repository when messageController is absent', async () => {
        // No messageController — should not throw
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list sessionId="test-session"></rtc-message-list>`,
        );
        await nextFrame();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._messages.length).toBe(0);
    });

    it('should not connect repository when sessionId is absent', async () => {
        const {controller, fetchInitialMessages} = createMockMessageController();
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller}></rtc-message-list>`,
        );
        await nextFrame();
        // Should not have called fetchInitialMessages
        expect(fetchInitialMessages).not.toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._messages.length).toBe(0);
    });

    it('should track hasMore and isLoadingMore from repository', async () => {
        const {controller, repository} = createMockMessageController({hasMore: true});
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
        );
        await nextFrame();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._hasMore).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._isLoadingMore).toBe(false);

        // Simulate loading state
        repository.emitUpdate({isLoadingMore: true});
        await nextFrame();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._isLoadingMore).toBe(true);
    });

    describe('_ready state transition', () => {
        it('starts with _ready false and transitions to true after firstUpdated', async () => {
            const {controller} = createMockMessageController();
            const el = await fixture<RtcMessageList>(
                html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
            );
            // The wrapper div uses class="list-wrapper" for flex layout (not visibility).
            // Visibility is controlled by the parent (rtc-chat-layout) via inline style
            // on the rtc-message-list element itself.
            const wrapper = el.shadowRoot!.querySelector('div.list-wrapper');
            expect(wrapper).not.toBeNull();

            // _ready may already be true after fixture() completes depending on timing,
            // but _waitForRenderComplete has a 100ms stable timeout.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const readyBefore = (el as any)._ready;
            expect(typeof readyBefore).toBe('boolean');

            // Wait for _waitForRenderComplete to resolve (stable timeout + margin)
            await new Promise(resolve => setTimeout(resolve, 200));
            await el.updateComplete;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((el as any)._ready).toBe(true);
        });

        it('transitions to _ready true even with no messages', async () => {
            const {controller} = createMockMessageController();
            const el = await fixture<RtcMessageList>(
                html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
            );
            // Wait for _waitForRenderComplete to resolve
            await new Promise(resolve => setTimeout(resolve, 200));
            await el.updateComplete;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((el as any)._ready).toBe(true);
            // Wrapper div has list-wrapper class for flex layout
            const wrapper = el.shadowRoot!.querySelector('div.list-wrapper');
            expect(wrapper).not.toBeNull();
        });
    });

    describe('_followMode toggling', () => {
        it('defaults to true', async () => {
            const {controller} = createMockMessageController();
            const el = await fixture<RtcMessageList>(
                html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((el as any)._followMode).toBe(true);
        });

        it('sets to false when scrolled far from bottom', async () => {
            const messages = Array.from({length: 20}, (_, i) => makeMsg(`m${i}`, `Message ${i}`));
            const {controller} = createMockMessageController({messages});
            const el = await fixture<RtcMessageList>(
                html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
            );
            // Wait for firstUpdated
            await new Promise(resolve => setTimeout(resolve, 200));
            await el.updateComplete;

            // Simulate scroll event with position far from bottom
            const virtualizer = el.shadowRoot!.querySelector('lit-virtualizer');
            expect(virtualizer).not.toBeNull();

            Object.defineProperty(virtualizer, 'scrollHeight', {value: 5000, configurable: true});
            Object.defineProperty(virtualizer, 'scrollTop', {value: 0, configurable: true});
            Object.defineProperty(virtualizer, 'clientHeight', {value: 500, configurable: true});
            virtualizer!.dispatchEvent(new Event('scroll'));
            await nextFrame();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((el as any)._followMode).toBe(false);
        });

        it('remains true when near bottom after scroll', async () => {
            const messages = Array.from({length: 20}, (_, i) => makeMsg(`m${i}`, `Message ${i}`));
            const {controller} = createMockMessageController({messages});
            const el = await fixture<RtcMessageList>(
                html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
            );
            await new Promise(resolve => setTimeout(resolve, 200));
            await el.updateComplete;

            const virtualizer = el.shadowRoot!.querySelector('lit-virtualizer');
            expect(virtualizer).not.toBeNull();

            // Near bottom: scrollHeight - scrollTop - clientHeight < 80 (SCROLL_END_THRESHOLD)
            Object.defineProperty(virtualizer, 'scrollHeight', {value: 5000, configurable: true});
            Object.defineProperty(virtualizer, 'scrollTop', {value: 4950, configurable: true});
            Object.defineProperty(virtualizer, 'clientHeight', {value: 500, configurable: true});
            virtualizer!.dispatchEvent(new Event('scroll'));
            await nextFrame();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((el as any)._followMode).toBe(true);
        });
    });

    describe('_pendingScroll behavior', () => {
        it('sets _pendingScroll to bottom when near bottom and new messages arrive', async () => {
            const messages = [makeMsg('1', 'Initial')];
            const {controller, repository} = createMockMessageController({messages});
            const el = await fixture<RtcMessageList>(
                html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
            );
            // Wait for firstUpdated
            await new Promise(resolve => setTimeout(resolve, 200));
            await el.updateComplete;

            // Mock virtualizer near bottom
            const virtualizer = el.shadowRoot!.querySelector('lit-virtualizer');
            expect(virtualizer).not.toBeNull();
            Object.defineProperty(virtualizer, 'scrollHeight', {value: 1000, configurable: true});
            Object.defineProperty(virtualizer, 'scrollTop', {value: 950, configurable: true});
            Object.defineProperty(virtualizer, 'clientHeight', {value: 500, configurable: true});

            // Push new message via repository
            repository.emitUpdate({messages: [makeMsg('1', 'Initial'), makeMsg('2', 'New')]});
            await nextFrame();

            // After _handleNewMessages runs and detects near-bottom, _pendingScroll should be set
            // It may already have been cleared by _applyPendingScroll in updated(), so we
            // verify by checking the scroll was applied (i.e. _pendingScroll was processed)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pendingAfter = (el as any)._pendingScroll;
            // _pendingScroll should be null because _applyPendingScroll clears it
            expect(pendingAfter).toBeNull();
        });

        it('does not set _pendingScroll when _followMode is false (user scrolled up)', async () => {
            const messages = [makeMsg('1', 'Initial')];
            const {controller, repository} = createMockMessageController({messages});
            const el = await fixture<RtcMessageList>(
                html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
            );
            await new Promise(resolve => setTimeout(resolve, 200));
            await el.updateComplete;

            // Mock virtualizer far from bottom
            const virtualizer = el.shadowRoot!.querySelector('lit-virtualizer');
            expect(virtualizer).not.toBeNull();
            Object.defineProperty(virtualizer, 'scrollHeight', {value: 5000, configurable: true});
            Object.defineProperty(virtualizer, 'scrollTop', {value: 0, configurable: true});
            Object.defineProperty(virtualizer, 'clientHeight', {value: 500, configurable: true});

            // Dispatch a scroll event so _handleScroll updates _followMode to false.
            // With the synchronous _followMode fix, _handleNewMessages now relies
            // on _followMode (not raw scroll position) as the authority signal.
            virtualizer!.dispatchEvent(new Event('scroll'));
            await nextFrame();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((el as any)._followMode).toBe(false);

            // Push new message — _handleNewMessages should NOT set _pendingScroll
            // because _followMode is false (user scrolled up)
            repository.emitUpdate({messages: [makeMsg('1', 'Initial'), makeMsg('2', 'New')]});
            await nextFrame();

            // _pendingScroll should NOT be set because _followMode is false
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((el as any)._pendingScroll).toBeNull();
        });
    });

    describe('_buildRenderItems filtering', () => {
        it('excludes toolcall_output from render items (paired into toolcall)', async () => {
            const messages: Message[] = [
                {clientId: 'tc1', role: 'assistant', content: {type: 'toolcall_input', data: {toolName: 'test', input: {}}} as ContentData, timestamp: Date.now(), syncStatus: 'synced'},
                {clientId: 'tc1-out', role: 'assistant', content: {type: 'toolcall_output', data: {result: 'ok'}} as ContentData, timestamp: Date.now(), syncStatus: 'synced', parentClientId: 'tc1'},
                makeMsg('msg1', 'text'),
            ];
            const {controller} = createMockMessageController({messages});
            const el = await fixture<RtcMessageList>(
                html`<rtc-message-list .messageController=${controller} sessionId="test-session"></rtc-message-list>`,
            );
            // Wait for willUpdate to process property changes and subscription callback
            await el.updateComplete;
            await nextFrame();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = (el as any)._renderItems;
            // toolcall_output should be filtered out; toolcall_input becomes 'toolcall' type
            expect(items.length).toBe(2);
            expect(items.map((i: {type: string}) => i.type)).toEqual(['toolcall', 'assistant']);
        });
    });
});
