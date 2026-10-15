import { describe, expect, it } from 'vitest';
import type { MessageActions } from '../types/index.js';
import { MessageContext } from './message.js';

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
