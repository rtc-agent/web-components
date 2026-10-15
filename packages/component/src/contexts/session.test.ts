import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_STATE, SessionContext } from './session.js';

describe('SessionContext', () => {
  it('should export a context key', () => {
    expect(SessionContext).toBeDefined();
  });

  it('should have empty session list by default', () => {
    expect(DEFAULT_SESSION_STATE.sessions).toEqual([]);
    expect(DEFAULT_SESSION_STATE.currentSessionId).toBeNull();
  });
});
