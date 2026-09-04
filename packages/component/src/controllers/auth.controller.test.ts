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

    it('should login and set isLoggedIn to true', () => {
        const host = new MockHost();
        const ctrl = new AuthController(host as any);
        ctrl.actions.login();
        expect(ctrl.value.state.isLoggedIn).toBe(true);
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
