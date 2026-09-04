import {describe, it, expect, vi} from 'vitest';
import {AuthController} from './auth.controller.js';

class MockHost {
    updateCount = 0;
    dispatchEvent = vi.fn();
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('AuthController', () => {
    it('should have default state (not logged in)', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        expect(ctrl.value.state.isLoggedIn).toBe(false);
    });

    it('should login and dispatch rtc-auth-login-requested', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        ctrl.actions.login();
        // login() dispatches an event for the root to handle the OAuth flow;
        // it does NOT set isLoggedIn directly (that happens via setTokens()).
        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-auth-login-requested'})
        );
    });

    it('should logout and clear state', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        ctrl.actions.login();
        ctrl.actions.logout();
        expect(ctrl.value.state.isLoggedIn).toBe(false);
    });

    it('should dispatch rtc-auth-login-requested on login', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        ctrl.actions.login();
        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-auth-login-requested'})
        );
    });

    it('should request host update on login', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        ctrl.actions.login();
        expect(host.updateCount).toBeGreaterThan(0);
    });
});
