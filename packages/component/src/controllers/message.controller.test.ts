import {describe, it, expect, vi} from 'vitest';
import {MessageController} from './message.controller.js';
import type {ContentData, Message} from '../types/index.js';

class MockHost {
    updateCount = 0;
    dispatchEvent = vi.fn();
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

/**
 * The real controller delegates persistence to an injected layer,
 * and the send flow only updates UI state via `_reloadFromDB` (triggered
 * when `_sessionController` is also set). These tests mock both dependencies
 * so they can verify controller behavior without standing up IndexedDB.
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
        listMessages: vi.fn(async (_sessionId: string, _cursor?: string, _limit?: number, _direction?: string) => {
            // Simple mock: return all stored messages
            // In a real scenario, this would respect cursor and limit
            return [...stored];
        }),
        getMessage: vi.fn(async (_entityId: string) =>
            stored.find(m => m.client_id === _entityId) ?? null
        ),
    };

    const currentSession = {clientId: 'test-session', title: '', createdAt: 0, updatedAt: 0};
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

    it('should clear cursors when clearing messages', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);
        ctrl.addDemoAssistantMessage('Hello');

        // Verify repository has data
        const repoState = ctrl.repository.getSessionState('test-session');
        expect(repoState.messages).toHaveLength(1);

        // Clear messages
        ctrl.actions.clearMessages();

        // Verify repository is empty
        const clearedState = ctrl.repository.getSessionState('test-session');
        expect(clearedState.messages).toEqual([]);
        expect(clearedState.hasMore).toBe(false);
        expect(clearedState.hasMoreNewer).toBe(false);
    });

    it('should derive state from repository', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);

        // Add message via demo helper (goes to repository)
        ctrl.addDemoAssistantMessage('Hello');

        // value.state should reflect repository state
        expect(ctrl.value.state.messages).toHaveLength(1);
        expect(ctrl.value.state.messages[0].content).toEqual({type: 'text', data: 'Hello'});

        // Adding another message
        ctrl.addDemoAssistantMessage('World');
        expect(ctrl.value.state.messages).toHaveLength(2);
    });

    it('should return shallow copy of state to prevent external mutation', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        createMockDeps(ctrl);
        ctrl.addDemoAssistantMessage('Hello');

        const state1 = ctrl.value.state;
        const state2 = ctrl.value.state;

        // Messages array should be a different reference each time
        expect(state1.messages).not.toBe(state2.messages);

        // But content should be equal
        expect(state1.messages).toEqual(state2.messages);
    });
});

describe('MessageController merge semantics', () => {
    it('should preserve existing messages when reloading', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        const {stored} = createMockDeps(ctrl);

        // Simulate having loaded 69 messages (50 initial + 19 from loadMore)
        const sessionId = 'test-session';
        const existingMessages: Message[] = [];
        for (let i = 1; i <= 69; i++) {
            existingMessages.push({
                clientId: `msg-${i}`,
                role: 'user',
                content: {type: 'text', data: `Message ${i}`},
                timestamp: 1000 + i,
                syncStatus: 'synced',
            });
        }

        // Manually populate repository with existing messages
        ctrl.repository.updateMessages(sessionId, existingMessages);
        ctrl.repository.setHasMore(sessionId, true);

        // Simulate DB having 50 latest messages (msg-20 to msg-69)
        stored.length = 0;
        for (let i = 20; i <= 69; i++) {
            stored.push({
                client_id: `msg-${i}`,
                role: 'user',
                content: JSON.stringify({type: 'text', data: `Message ${i}`}),
                created_at: new Date(1000 + i).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: sessionId,
            });
        }

        // Call reload (which calls _reloadFromDB internally)
        await ctrl.reload();

        // Should still have all 69 messages, not just 50
        expect(ctrl.value.state.messages).toHaveLength(69);

        // First message should still be msg-1 (preserved from existing)
        expect(ctrl.value.state.messages[0].clientId).toBe('msg-1');

        // Last message should be msg-69
        expect(ctrl.value.state.messages[68].clientId).toBe('msg-69');
    });

    it('should use composite sort (timestamp, clientId) for messages with same timestamp', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        const {stored} = createMockDeps(ctrl);

        const sessionId = 'test-session';
        const sameTimestamp = 1000;

        // Simulate DB having messages with same timestamp but different clientIds
        stored.push(
            {
                client_id: 'msg-c',
                role: 'user',
                content: JSON.stringify({type: 'text', data: 'C'}),
                created_at: new Date(sameTimestamp).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: sessionId,
            },
            {
                client_id: 'msg-a',
                role: 'user',
                content: JSON.stringify({type: 'text', data: 'A'}),
                created_at: new Date(sameTimestamp).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: sessionId,
            },
            {
                client_id: 'msg-b',
                role: 'user',
                content: JSON.stringify({type: 'text', data: 'B'}),
                created_at: new Date(sameTimestamp).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: sessionId,
            }
        );

        // Call reload to trigger _reloadFromDB which uses _mergeMessages
        await ctrl.reload();

        // Messages should be sorted by (timestamp, clientId)
        // Since timestamps are equal, they should be sorted by clientId
        expect(ctrl.value.state.messages[0].clientId).toBe('msg-a');
        expect(ctrl.value.state.messages[1].clientId).toBe('msg-b');
        expect(ctrl.value.state.messages[2].clientId).toBe('msg-c');
    });

    it('should skip reload when repository already has messages', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        const {stored} = createMockDeps(ctrl);

        const sessionId = 'test-session';

        // Simulate existing messages: msg-1 to msg-69
        const existingMessages: Message[] = [];
        for (let i = 1; i <= 69; i++) {
            existingMessages.push({
                clientId: `msg-${i}`,
                role: 'user',
                content: {type: 'text', data: `Message ${i}`},
                timestamp: 1000 + i,
                syncStatus: 'synced',
            });
        }
        ctrl.repository.updateMessages(sessionId, existingMessages);

        // Simulate DB returning msg-20 to msg-69 (50 messages)
        stored.length = 0;
        for (let i = 20; i <= 69; i++) {
            stored.push({
                client_id: `msg-${i}`,
                role: 'user',
                content: JSON.stringify({type: 'text', data: `Message ${i}`}),
                created_at: new Date(1000 + i).toISOString(),
                streaming_status: 'finalized',
                sync_status: 'synced',
                session_client_id: sessionId,
            });
        }

        await ctrl.reload();

        // Reload should be skipped when repository already has messages
        // Cursor should remain unchanged (not updated from DB)
        const oldestCursor = ctrl.repository.getOldestOffset(sessionId);
        // oldestCursor may be undefined or point to existing messages
        expect(oldestCursor === undefined || oldestCursor.includes('msg-1')).toBe(true);

        // Newest cursor should remain unchanged
        const newestCursor = ctrl.repository.getNewestOffset(sessionId);
        expect(newestCursor === undefined || newestCursor.includes('msg-69')).toBe(true);
    });

    it('should skip reload and preserve existing state when repository has messages', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        const {stored} = createMockDeps(ctrl);

        const sessionId = 'test-session';

        // Existing has older messages and hasMore=true
        const existingMessages: Message[] = [
            {
                clientId: 'msg-1',
                role: 'user',
                content: {type: 'text', data: 'Message 1'},
                timestamp: 1001,
                syncStatus: 'synced',
            },
        ];
        ctrl.repository.updateMessages(sessionId, existingMessages);
        ctrl.repository.setHasMore(sessionId, true); // There are more older messages

        // DB returns newer messages
        stored.length = 0;
        stored.push({
            client_id: 'msg-2',
            role: 'user',
            content: JSON.stringify({type: 'text', data: 'Message 2'}),
            created_at: new Date(1002).toISOString(),
            streaming_status: 'finalized',
            sync_status: 'synced',
            session_client_id: sessionId,
        });

        await ctrl.reload();

        // Reload should be skipped when repository already has messages
        // Existing message should be preserved
        expect(ctrl.value.state.messages).toHaveLength(1);
        expect(ctrl.value.state.messages[0].clientId).toBe('msg-1');

        // hasMore should be preserved from existing state
        expect(ctrl.value.state.hasMore).toBe(true);
    });
});
