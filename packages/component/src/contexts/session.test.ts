import {describe, it, expect} from 'vitest';
import {SessionContext, DEFAULT_SESSION_STATE} from './session.js';

describe('SessionContext', () => {
    it('should export a context key', () => {
        expect(SessionContext).toBeDefined();
    });

    it('should have empty session list by default', () => {
        expect(DEFAULT_SESSION_STATE.sessions).toEqual([]);
        expect(DEFAULT_SESSION_STATE.currentSessionId).toBeNull();
    });
});
