import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillController } from './skill.controller.js';
import { eventBus } from '../core/event-bus.js';
import type { ReactiveControllerHost } from 'lit';

// Mock ReactiveControllerHost
function createMockHost(): ReactiveControllerHost {
    return {
        addController: vi.fn(),
        removeController: vi.fn(),
        requestUpdate: vi.fn(),
        updateComplete: Promise.resolve(true),
    };
}

describe('SkillController', () => {
    let host: ReactiveControllerHost;
    let controller: SkillController;

    beforeEach(() => {
        vi.clearAllMocks();
        host = createMockHost();
        controller = new SkillController(host);
    });

    describe('initial state', () => {
        it('should have null registry initially', () => {
            expect(controller.value.registry).toBeNull();
        });

        it('should provide actions', () => {
            expect(controller.actions).toBeDefined();
            expect(typeof controller.actions.getRegistry).toBe('function');
            expect(typeof controller.actions.setRegistry).toBe('function');
        });
    });

    describe('setConfig()', () => {
        it('should set config for callbacks', () => {
            const onToast = vi.fn();
            controller.setConfig({ onToast });
            // Config is set; we'll test its effect via eventBus
        });
    });

    describe('eventBus integration', () => {
        it('should call onToast callback when ui:toast is emitted', () => {
            const onToast = vi.fn();
            controller.setConfig({ onToast });
            controller.hostConnected();

            eventBus.emit('ui:toast', { message: 'Hello', type: 'info' });

            expect(onToast).toHaveBeenCalledWith('Hello', 'info');

            controller.hostDisconnected();
        });

        it('should call onConfirmRequest callback when ui:confirm-request is emitted', () => {
            const onConfirmRequest = vi.fn();
            controller.setConfig({ onConfirmRequest });
            controller.hostConnected();

            eventBus.emit('ui:confirm-request', {
                requestId: 'req-1',
                path: 'test.func',
                message: 'Confirm?',
            });

            expect(onConfirmRequest).toHaveBeenCalledWith('req-1', 'test.func', 'Confirm?');

            controller.hostDisconnected();
        });

        it('should not call callbacks after hostDisconnected()', () => {
            const onToast = vi.fn();
            controller.setConfig({ onToast });
            controller.hostConnected();
            controller.hostDisconnected();

            eventBus.emit('ui:toast', { message: 'Hello', type: 'info' });

            expect(onToast).not.toHaveBeenCalled();
        });
    });

    describe('respondToConfirm()', () => {
        it('should emit ui:confirm-response event', () => {
            const handler = vi.fn();
            eventBus.on('ui:confirm-response', handler);

            controller.respondToConfirm('req-1', true);

            expect(handler).toHaveBeenCalledWith({ requestId: 'req-1', confirmed: true });

            eventBus.off('ui:confirm-response', handler);
        });
    });
});
