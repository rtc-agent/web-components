import {describe, it, expect} from 'vitest';
import {WindowStateController} from './window-state.controller.js';

/** Minimal mock host for unit-testing controllers outside of a LitElement. */
class MockHost {
    updateCount = 0;
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('WindowStateController', () => {
    it('should have default state (normal mode)', () => {
        const host = new MockHost();
        const ctrl = new WindowStateController(host as any);
        expect(ctrl.value.state.mode).toBe('normal');
    });

    it('should set mode to maximized and save lastState', () => {
        const host = new MockHost();
        const ctrl = new WindowStateController(host as any);
        ctrl.actions.maximize();
        expect(ctrl.value.state.mode).toBe('maximized');
        expect(ctrl.value.state.lastState).toBeDefined();
    });

    it('should restore from maximized to normal using lastState', () => {
        const host = new MockHost();
        const ctrl = new WindowStateController(host as any);
        ctrl.actions.maximize();
        ctrl.actions.restore();
        expect(ctrl.value.state.mode).toBe('normal');
    });

    it('should minimize and restore', () => {
        const host = new MockHost();
        const ctrl = new WindowStateController(host as any);
        ctrl.actions.minimize();
        expect(ctrl.value.state.mode).toBe('minimized');
        ctrl.actions.restore();
        expect(ctrl.value.state.mode).toBe('normal');
    });

    it('should update position', () => {
        const host = new MockHost();
        const ctrl = new WindowStateController(host as any);
        ctrl.actions.setPosition({x: 200, y: 300});
        expect(ctrl.value.state.position).toEqual({x: 200, y: 300});
    });

    it('should update size', () => {
        const host = new MockHost();
        const ctrl = new WindowStateController(host as any);
        ctrl.actions.setSize({width: 800, height: 600});
        expect(ctrl.value.state.size).toEqual({width: 800, height: 600});
    });

    it('should request host update on state change', () => {
        const host = new MockHost();
        const ctrl = new WindowStateController(host as any);
        ctrl.actions.maximize();
        expect(host.updateCount).toBeGreaterThan(0);
    });
});
