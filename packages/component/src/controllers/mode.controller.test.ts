import {describe, it, expect} from 'vitest';
import {ModeController} from './mode.controller.js';

class MockHost {
    updateCount = 0;
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('ModeController', () => {
    it('should have default mode "edit"', () => {
        const host = new MockHost();
        const ctrl = new ModeController(host as any);
        expect(ctrl.value.state.currentMode).toBe('edit');
    });

    it('should set mode to manual', () => {
        const host = new MockHost();
        const ctrl = new ModeController(host as any);
        ctrl.actions.setMode('manual');
        expect(ctrl.value.state.currentMode).toBe('manual');
    });

    it('should cycle through all modes', () => {
        const host = new MockHost();
        const ctrl = new ModeController(host as any);
        const modes = ['manual', 'edit', 'bypass'] as const;
        for (const mode of modes) {
            ctrl.actions.setMode(mode);
            expect(ctrl.value.state.currentMode).toBe(mode);
        }
    });

    it('should request host update on mode change', () => {
        const host = new MockHost();
        const ctrl = new ModeController(host as any);
        ctrl.actions.setMode('bypass');
        expect(host.updateCount).toBeGreaterThan(0);
    });
});
