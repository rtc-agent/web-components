import {describe, it, expect, vi} from 'vitest';
import {MessageController} from './message.controller.js';
import type {ContentData} from '../types/index.js';

class MockHost {
    updateCount = 0;
    dispatchEvent = vi.fn();
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

/**
 * Create minimal mock dependencies for the controller.
 *
 * The controller now requires persistence to be set (which initializes the
 * repository) before most operations can work. This helper sets up both
 * persistence and sessionController.
 */
function createMockDeps(ctrl: MessageController) {
    const stored: Array<{
        client_id: string;
        role: string;
        content: string;
        created_at: string;
        streaming_status: string;
        sync_status: string;
        session_client_id: string;
        parent_client_id?: string;
        global_offset?: number;
    }> = [];

    const persistence = {
        sendMessage: vi.fn(async ({content, messageClientId, sessionClientId}: {
            content: ContentData;
            messageClientId: string;
            sessionClientId: string;
        }) => {
            const entry = {
                client_id: messageClientId,
                role: 'user',
                content: JSON.stringify(content),
                created_at: new Date().toISOString(),
                streaming_status: 'finalized',
                sync_status: 'pending',
                session_client_id: sessionClientId,
            };
            stored.push(entry);
            return {
                message: {...entry, content: JSON.parse(entry.content)},
                session: {
                    client_id: sessionClientId,
                    title: '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                },
            };
        }),
        listMessages: vi.fn(async (_sessionId: string) =>
            stored.filter(m => m.session_client_id === _sessionId)
        ),
        getMessage: vi.fn(async (_entityId: string) =>
            stored.find(m => m.client_id === _entityId) ?? null
        ),
    };

    const currentSession = {clientId: '', title: '', createdAt: 0, updatedAt: 0};
    const sessionController = {
        value: {state: {currentSessionId: 'test-session' as string | null}},
        actions: {
            setCurrentSession: vi.fn((s: typeof currentSession) => {
                currentSession.clientId = s.clientId;
                currentSession.title = s.title;
                currentSession.createdAt = s.createdAt;
                currentSession.updatedAt = s.updatedAt;
                sessionController.value.state.currentSessionId = s.clientId;
            }),
            switchSession: vi.fn(),
            renameSession: vi.fn(),
            deleteSession: vi.fn(),
            reset: vi.fn(),
            clearCurrentSession: vi.fn(),
            createSession: vi.fn(),
            setSessions: vi.fn(),
        },
    };

    // Set persistence first — this initializes the repository
    ctrl.persistence = persistence as any;
    ctrl.sessionController = sessionController as any;

    return {persistence, sessionController, stored};
}

describe('MessageController', () => {
    it('should have empty messages by default', () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        expect(ctrl.value.state.messages).toEqual([]);
    });

    it('should send a user message', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        const {persistence} = createMockDeps(ctrl);

        await ctrl.actions.sendMessage({type: 'text', data: 'Hello'} as ContentData);
        expect(persistence.sendMessage).toHaveBeenCalledOnce();
        expect(ctrl.value.state.messages).toHaveLength(1);
        expect(ctrl.value.state.messages[0].role).toBe('user');
        expect(ctrl.value.state.messages[0].content).toEqual({type: 'text', data: 'Hello'});
    });

    it('should dispatch rtc-message-sent on send', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);

        await ctrl.actions.sendMessage({type: 'text', data: 'Hello'} as ContentData);
        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-message-sent'})
        );
    });

    it('should append chunk to last message (streaming)', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        // Must set up persistence to initialize repository
        createMockDeps(ctrl);
        // Use the public helper to seed state directly (no persistence needed)
        ctrl.addDemoAssistantMessage('Hello');
        ctrl.actions.appendToLastMessage(' world');
        expect(ctrl.value.state.messages[0].content).toEqual({type: 'text', data: 'Hello world'});
        expect(ctrl.value.state.messages[0].streaming).toBe(true);
    });

    it('should not crash when appending to empty messages', () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);
        ctrl.actions.appendToLastMessage('chunk');
        expect(ctrl.value.state.messages).toEqual([]);
    });

    it('should finalize last message', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);
        ctrl.addDemoAssistantMessage('Hello');
        ctrl.actions.appendToLastMessage(' world');
        ctrl.actions.finalizeLastMessage();
        expect(ctrl.value.state.messages[0].streaming).toBe(false);
    });

    it('should clear all messages', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);
        ctrl.addDemoAssistantMessage('Hello');
        ctrl.actions.clearMessages();
        expect(ctrl.value.state.messages).toEqual([]);
    });

    it('should expose repository getter after persistence is set', () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        // Before persistence is set, repository should throw
        expect(() => ctrl.repository).toThrow('repository not initialized');

        // After persistence is set, repository should be accessible
        createMockDeps(ctrl);
        expect(ctrl.repository).toBeDefined();
        expect(typeof ctrl.repository.subscribe).toBe('function');
        expect(typeof ctrl.repository.getSessionState).toBe('function');
    });

    it('should fetch initial messages for a session', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        const {persistence, stored} = createMockDeps(ctrl);

        // Pre-populate stored messages
        stored.push({
            client_id: 'msg-1',
            role: 'user',
            content: JSON.stringify({type: 'text', data: 'Hello'}),
            created_at: new Date().toISOString(),
            streaming_status: 'finalized',
            sync_status: 'synced',
            session_client_id: 'test-session',
        });

        await ctrl.fetchInitialMessages('test-session');

        expect(persistence.listMessages).toHaveBeenCalledWith('test-session', undefined, 50, 'backward');
        expect(ctrl.repository.getSessionState('test-session').messages).toHaveLength(1);
    });

    it('should not reload if fetchInitialMessages already loaded', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        const {persistence, stored} = createMockDeps(ctrl);

        stored.push({
            client_id: 'msg-1',
            role: 'user',
            content: JSON.stringify({type: 'text', data: 'Hello'}),
            created_at: new Date().toISOString(),
            streaming_status: 'finalized',
            sync_status: 'synced',
            session_client_id: 'test-session',
        });

        // First call loads
        await ctrl.fetchInitialMessages('test-session');
        expect(persistence.listMessages).toHaveBeenCalledTimes(1);

        // Second call should be a no-op (messages already loaded)
        await ctrl.fetchInitialMessages('test-session');
        expect(persistence.listMessages).toHaveBeenCalledTimes(1);
    });

    it('should evict session from repository', () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);

        // Add a message to the session
        ctrl.addDemoAssistantMessage('Hello');
        expect(ctrl.repository.getSessionState('test-session').messages).toHaveLength(1);

        // Evict the session
        ctrl.evictSession('test-session');

        // Session state should be empty now
        expect(ctrl.repository.getSessionState('test-session').messages).toEqual([]);
    });

    it('should support repository subscription', () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);

        const callback = vi.fn();
        const unsubscribe = ctrl.repository.subscribe('test-session', callback);

        // Callback should be called immediately with current state
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(
            expect.objectContaining({messages: [], hasMore: false, isLoadingMore: false})
        );

        // Adding a message should trigger the callback
        ctrl.addDemoAssistantMessage('Hello');
        expect(callback).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenLastCalledWith(
            expect.objectContaining({messages: expect.arrayContaining([
                expect.objectContaining({role: 'assistant'})
            ])})
        );

        // Unsubscribe should stop notifications
        callback.mockClear();
        unsubscribe();
        ctrl.addDemoAssistantMessage('World');
        expect(callback).not.toHaveBeenCalled();
    });

    describe('reloadForSession / updateMessage', () => {
        it('reloadForSession loads messages for a new session', async () => {
            const host = new MockHost();
            const ctrl = new MessageController(host as any);
            const {persistence, stored} = createMockDeps(ctrl);

            stored.push({
                client_id: 'msg-1',
                role: 'user',
                content: JSON.stringify({type: 'text', data: 'Hello'}),
                created_at: new Date().toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: 'test-session',
            });

            await ctrl.reloadForSession('test-session');
            expect(persistence.listMessages).toHaveBeenCalledWith(
                'test-session', undefined, 50, 'backward'
            );
            expect(ctrl.repository.getSessionState('test-session').messages).toHaveLength(1);
        });

        it('reloadForSession is a no-op if messages already loaded', async () => {
            const host = new MockHost();
            const ctrl = new MessageController(host as any);
            const {persistence, stored} = createMockDeps(ctrl);

            stored.push({
                client_id: 'msg-1',
                role: 'user',
                content: JSON.stringify({type: 'text', data: 'Hello'}),
                created_at: new Date().toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: 'test-session',
            });

            await ctrl.reloadForSession('test-session');
            expect(persistence.listMessages).toHaveBeenCalledTimes(1);

            // Second call: messages already present -> no new persistence call
            await ctrl.reloadForSession('test-session');
            expect(persistence.listMessages).toHaveBeenCalledTimes(1);
        });

        it('updateMessage replaces existing message in current session', async () => {
            const host = new MockHost();
            const ctrl = new MessageController(host as any);
            const {stored} = createMockDeps(ctrl);

            stored.push({
                client_id: 'msg-1',
                role: 'user',
                content: JSON.stringify({type: 'text', data: 'Hello'}),
                created_at: new Date().toISOString(),
                streaming_status: 'finalized',
                sync_status: 'pending',
                session_client_id: 'test-session',
            });

            await ctrl.reloadForSession('test-session');
            expect(ctrl.repository.getSessionState('test-session').messages[0].syncStatus).toBe('pending');

            // Simulate sync_status change in persistence
            stored[0].sync_status = 'synced';
            await ctrl.updateMessage('msg-1');

            expect(ctrl.repository.getSessionState('test-session').messages[0].syncStatus).toBe('synced');
        });

        it('updateMessage ignores messages from other sessions', async () => {
            const host = new MockHost();
            const ctrl = new MessageController(host as any);
            const {stored} = createMockDeps(ctrl);

            // A message belonging to a different session
            stored.push({
                client_id: 'msg-other',
                role: 'user',
                content: JSON.stringify({type: 'text', data: 'Hello'}),
                created_at: new Date().toISOString(),
                streaming_status: 'finalized',
                sync_status: 'pending',
                session_client_id: 'other-session',
            });

            await ctrl.reloadForSession('test-session');
            expect(ctrl.repository.getSessionState('test-session').messages).toHaveLength(0);

            // updateMessage for a message in another session -> no effect on current session
            await ctrl.updateMessage('msg-other');
            expect(ctrl.repository.getSessionState('test-session').messages).toHaveLength(0);
        });
    });

    describe('hasMore and loadMore integration', () => {
        it('sets hasMore=true when initial load returns 50 messages', async () => {
            const host = new MockHost();
            const ctrl = new MessageController(host as any);
            const {persistence} = createMockDeps(ctrl);

            // Mock persistence to return exactly 50 messages (PAGE_SIZE)
            const mockMessages = Array.from({length: 50}, (_, i) => ({
                client_id: `msg-${i}`,
                role: 'user',
                content: JSON.stringify({type: 'text', data: `msg-${i}`}),
                created_at: new Date(Date.now() + i).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: 'test-session',
                global_offset: i,
            }));
            persistence.listMessages.mockResolvedValue(mockMessages);

            await ctrl.reloadForSession('test-session');

            const state = ctrl.repository.getSessionState('test-session');
            expect(state.messages).toHaveLength(50);
            expect(state.hasMore).toBe(true);
        });

        it('sets hasMore=false when initial load returns < 50 messages', async () => {
            const host = new MockHost();
            const ctrl = new MessageController(host as any);
            const {persistence} = createMockDeps(ctrl);

            // Mock persistence to return 30 messages (< PAGE_SIZE)
            const mockMessages = Array.from({length: 30}, (_, i) => ({
                client_id: `msg-${i}`,
                role: 'user',
                content: JSON.stringify({type: 'text', data: `msg-${i}`}),
                created_at: new Date(Date.now() + i).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: 'test-session',
                global_offset: i,
            }));
            persistence.listMessages.mockResolvedValue(mockMessages);

            await ctrl.reloadForSession('test-session');

            const state = ctrl.repository.getSessionState('test-session');
            expect(state.messages).toHaveLength(30);
            expect(state.hasMore).toBe(false);
        });

        it('loadMore appends older messages and updates hasMore', async () => {
            const host = new MockHost();
            const ctrl = new MessageController(host as any);
            const {persistence} = createMockDeps(ctrl);

            // First page: 50 messages (triggers hasMore=true)
            const firstPage = Array.from({length: 50}, (_, i) => ({
                client_id: `msg-${i}`,
                role: 'user',
                content: JSON.stringify({type: 'text', data: `msg-${i}`}),
                created_at: new Date(Date.now() + i).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: 'test-session',
                global_offset: 100 + i,
            }));

            // Second page: 50 older messages (hasMore remains true)
            const secondPage = Array.from({length: 50}, (_, i) => ({
                client_id: `msg-old-${i}`,
                role: 'user',
                content: JSON.stringify({type: 'text', data: `msg-old-${i}`}),
                created_at: new Date(Date.now() + i - 1000).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: 'test-session',
                global_offset: 50 + i,
            }));

            // Third page: 10 messages (triggers hasMore=false)
            const thirdPage = Array.from({length: 10}, (_, i) => ({
                client_id: `msg-ancient-${i}`,
                role: 'user',
                content: JSON.stringify({type: 'text', data: `msg-ancient-${i}`}),
                created_at: new Date(Date.now() + i - 2000).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: 'test-session',
                global_offset: i,
            }));

            // Call sequence: first page, then second page (beforeOffset=100), then third (beforeOffset=50)
            persistence.listMessages
                .mockResolvedValueOnce(firstPage)
                .mockResolvedValueOnce(secondPage)
                .mockResolvedValueOnce(thirdPage);

            await ctrl.reloadForSession('test-session');
            let state = ctrl.repository.getSessionState('test-session');
            expect(state.messages).toHaveLength(50);
            expect(state.hasMore).toBe(true);

            await ctrl.loadMore();
            state = ctrl.repository.getSessionState('test-session');
            expect(state.messages).toHaveLength(100);
            expect(state.hasMore).toBe(true);

            await ctrl.loadMore();
            state = ctrl.repository.getSessionState('test-session');
            expect(state.messages).toHaveLength(110);
            expect(state.hasMore).toBe(false);
        });
    });
});
