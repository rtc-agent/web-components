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

describe('MessageController', () => {
    it('should have empty messages by default', () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        expect(ctrl.value.state.messages).toEqual([]);
    });

    it('should send a user message', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        await ctrl.actions.sendMessage({type: 'text', data: 'Hello'} as ContentData);
        expect(ctrl.value.state.messages).toHaveLength(1);
        expect(ctrl.value.state.messages[0].role).toBe('user');
        expect(ctrl.value.state.messages[0].content).toEqual({type: 'text', data: 'Hello'});
    });

    it('should dispatch rtc-message-sent on send', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        await ctrl.actions.sendMessage({type: 'text', data: 'Hello'} as ContentData);
        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-message-sent'})
        );
    });

    it('should append chunk to last message (streaming)', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        await ctrl.actions.sendMessage({type: 'text', data: 'Hello'} as ContentData);
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
        await ctrl.actions.sendMessage({type: 'text', data: 'Hello'} as ContentData);
        ctrl.actions.appendToLastMessage(' world');
        ctrl.actions.finalizeLastMessage();
        expect(ctrl.value.state.messages[0].streaming).toBe(false);
    });

    it('should clear all messages', async () => {
        const host = new MockHost();
        const ctrl = new MessageController(host as any);
        await ctrl.actions.sendMessage({type: 'text', data: 'Hello'} as ContentData);
        ctrl.actions.clearMessages();
        expect(ctrl.value.state.messages).toEqual([]);
    });
});
