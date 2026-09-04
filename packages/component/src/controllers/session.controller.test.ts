import {describe, it, expect, vi} from 'vitest';
import {SessionController} from './session.controller.js';

class MockHost {
    updateCount = 0;
    dispatchEvent = vi.fn();
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('SessionController', () => {
    it('should have empty session list by default', () => {
        const host = new MockHost();
        const ctrl = new SessionController(host as any);
        expect(ctrl.value.state.sessions).toEqual([]);
        expect(ctrl.value.state.currentSessionId).toBeNull();
    });

    it('should create a new session and set it as current', () => {
        const host = new MockHost();
        const ctrl = new SessionController(host as any);
        ctrl.actions.createSession();
        expect(ctrl.value.state.sessions).toHaveLength(1);
        expect(ctrl.value.state.currentSessionId).toBeTruthy();
    });

    it('should dispatch rtc-session-created on create', () => {
        const host = new MockHost();
        const ctrl = new SessionController(host as any);
        ctrl.actions.createSession();
        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-session-created'})
        );
    });

    it('should switch session', () => {
        const host = new MockHost();
        const ctrl = new SessionController(host as any);
        ctrl.actions.createSession();
        const id = ctrl.value.state.sessions[0].clientId;
        ctrl.actions.createSession();
        ctrl.actions.switchSession(id);
        expect(ctrl.value.state.currentSessionId).toBe(id);
    });

    it('should rename session', () => {
        const host = new MockHost();
        const ctrl = new SessionController(host as any);
        ctrl.actions.createSession();
        const id = ctrl.value.state.sessions[0].clientId;
        ctrl.actions.renameSession(id, 'New Title');
        expect(ctrl.value.state.sessions[0].title).toBe('New Title');
    });

    it('should delete session and update current if needed', () => {
        const host = new MockHost();
        const ctrl = new SessionController(host as any);
        ctrl.actions.createSession();
        const id = ctrl.value.state.sessions[0].clientId;
        ctrl.actions.deleteSession(id);
        expect(ctrl.value.state.sessions).toHaveLength(0);
        expect(ctrl.value.state.currentSessionId).toBeNull();
    });

    it('should switch to last session when current is deleted', () => {
        const host = new MockHost();
        const ctrl = new SessionController(host as any);
        ctrl.actions.createSession();
        ctrl.actions.createSession();
        const firstId = ctrl.value.state.sessions[0].clientId;
        const secondId = ctrl.value.state.sessions[1].clientId;
        expect(ctrl.value.state.currentSessionId).toBe(secondId);
        ctrl.actions.deleteSession(secondId);
        expect(ctrl.value.state.currentSessionId).toBe(firstId);
    });

    it('should dispatch rtc-session-switched on switch', () => {
        const host = new MockHost();
        const ctrl = new SessionController(host as any);
        ctrl.actions.createSession();
        const id = ctrl.value.state.sessions[0].clientId;
        ctrl.actions.switchSession(id);
        expect(host.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({type: 'rtc-session-switched'})
        );
    });
});
