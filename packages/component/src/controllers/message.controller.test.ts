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
        listMessages: vi.fn(async (_sessionId: string) => [...stored]),
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
        // Use the public helper to seed state directly (no persistence needed)
        ctrl.addDemoAssistantMessage('Hello');
        ctrl.actions.appendToLastMessage(' world');
        expect(ctrl.value.state.messages[0].content).toEqual({type: 'text', data: 'Hello world'});
        expect(ctrl.value.state.messages[0].streaming).toBe(true);
    });

    it('should not crash when appending to empty messages', () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        ctrl.actions.appendToLastMessage('chunk');
        expect(ctrl.value.state.messages).toEqual([]);
    });

    it('should finalize last message', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        ctrl.addDemoAssistantMessage('Hello');
        ctrl.actions.appendToLastMessage(' world');
        ctrl.actions.finalizeLastMessage();
        expect(ctrl.value.state.messages[0].streaming).toBe(false);
    });

    it('should clear all messages', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        ctrl.addDemoAssistantMessage('Hello');
        ctrl.actions.clearMessages();
        expect(ctrl.value.state.messages).toEqual([]);
    });
});
