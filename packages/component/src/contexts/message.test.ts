import {describe, it, expect} from 'vitest';
import {MessageContext} from './message.js';
import type {MessageActions} from '../types/index.js';

describe('MessageContext', () => {
    it('should export a context key', () => {
        expect(MessageContext).toBeDefined();
    });

    it('should define MessageActions interface with clearMessages', () => {
        const actions: MessageActions = {
            sendMessage: async () => {},
            resendMessage: async () => {},
            forkSession: async () => {},
            appendToLastMessage: () => {},
            finalizeLastMessage: () => {},
            clearMessages: () => {},
        };
        expect(typeof actions.sendMessage).toBe('function');
        expect(typeof actions.clearMessages).toBe('function');
    });
});
