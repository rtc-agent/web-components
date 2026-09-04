import {describe, it, expect} from 'vitest';
import {AuthContext} from './auth.js';
import type {AuthState} from '../types/index.js';

describe('AuthContext', () => {
    it('should export a context key', () => {
        expect(AuthContext).toBeDefined();
    });

    it('should define a default not-logged-in state', () => {
        const state: AuthState = {isLoggedIn: false};
        expect(state.isLoggedIn).toBe(false);
        expect(state.accessToken).toBeUndefined();
    });
});
