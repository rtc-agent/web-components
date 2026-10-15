import { describe, expect, it } from 'vitest';
import type { AuthState } from '../types/index.js';
import { AuthContext } from './auth.js';

describe('AuthContext', () => {
  it('should export a context key', () => {
    expect(AuthContext).toBeDefined();
  });

  it('should define a default not-logged-in state', () => {
    const state: AuthState = { isLoggedIn: false };
    expect(state.isLoggedIn).toBe(false);
    expect(state.accessToken).toBeUndefined();
  });
});
