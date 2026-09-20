/**
 * Toast Controller Unit Tests
 *
 * Tests the ToastController's core functionality:
 * - Show/remove toast notifications
 * - Auto-dismiss behavior (success/info vs error)
 * - Timer cleanup on host disconnect
 * - Action callbacks
 */
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {ToastController} from './toast.controller.js';
import type {ReactiveControllerHost} from 'lit';

// Mock ReactiveControllerHost
function createMockHost(): ReactiveControllerHost & {updateCount: number} {
    const host = {
        updateCount: 0,
        addController: vi.fn(),
        removeController: vi.fn(),
        requestUpdate: vi.fn(function (this: {updateCount: number}) {
            this.updateCount++;
        }),
        updateComplete: Promise.resolve(true),
    };
    return host;
}

describe('ToastController', () => {
    let controller: ToastController;
    let host: ReturnType<typeof createMockHost>;

    beforeEach(() => {
        vi.useFakeTimers();
        host = createMockHost();
        controller = new ToastController(host);
    });

    afterEach(() => {
        controller.hostDisconnected();
        vi.useRealTimers();
    });

    describe('show', () => {
        it('should add a toast to the list', () => {
            controller.actions.show('Test message', 'info');

            expect(controller.toasts).toHaveLength(1);
            expect(controller.toasts[0].message).toBe('Test message');
            expect(controller.toasts[0].type).toBe('info');
        });

        it('should default to info type when not specified', () => {
            controller.actions.show('Test message');

            expect(controller.toasts[0].type).toBe('info');
        });

        it('should trigger host requestUpdate', () => {
            controller.actions.show('Test message', 'info');

            expect(host.requestUpdate).toHaveBeenCalledTimes(1);
        });

        it('should support multiple toasts', () => {
            controller.actions.show('First', 'info');
            controller.actions.show('Second', 'success');
            controller.actions.show('Third', 'error');

            expect(controller.toasts).toHaveLength(3);
            expect(controller.toasts[0].message).toBe('First');
            expect(controller.toasts[1].message).toBe('Second');
            expect(controller.toasts[2].message).toBe('Third');
        });

        it('should support action callbacks', () => {
            const action = {label: 'Undo', onClick: vi.fn()};
            controller.actions.show('Deleted', 'info', action);

            expect(controller.toasts[0].action).toBe(action);
        });
    });

    describe('auto-dismiss', () => {
        it('should auto-dismiss success toast after 2000ms', () => {
            controller.actions.show('Success', 'success');
            expect(controller.toasts).toHaveLength(1);

            vi.advanceTimersByTime(2000);

            expect(controller.toasts).toHaveLength(0);
        });

        it('should auto-dismiss info toast after 2500ms', () => {
            controller.actions.show('Info', 'info');
            expect(controller.toasts).toHaveLength(1);

            vi.advanceTimersByTime(2500);

            expect(controller.toasts).toHaveLength(0);
        });

        it('should NOT auto-dismiss error toast', () => {
            controller.actions.show('Error', 'error');
            expect(controller.toasts).toHaveLength(1);

            vi.advanceTimersByTime(10000);

            expect(controller.toasts).toHaveLength(1);
        });

        it('should trigger requestUpdate on auto-dismiss', () => {
            controller.actions.show('Info', 'info');
            const initialUpdateCount = host.updateCount;

            vi.advanceTimersByTime(2500);

            expect(host.updateCount).toBe(initialUpdateCount + 1);
        });
    });

    describe('remove', () => {
        it('should remove a specific toast by id', () => {
            controller.actions.show('First', 'info');
            controller.actions.show('Second', 'info');
            const firstId = controller.toasts[0].id;

            controller.actions.remove(firstId);

            expect(controller.toasts).toHaveLength(1);
            expect(controller.toasts[0].message).toBe('Second');
        });

        it('should clear the timer when removing a toast', () => {
            controller.actions.show('Info', 'info');
            const id = controller.toasts[0].id;

            controller.actions.remove(id);

            // Advance time - should not cause issues
            vi.advanceTimersByTime(5000);
            expect(controller.toasts).toHaveLength(0);
        });

        it('should trigger requestUpdate on remove', () => {
            controller.actions.show('Test', 'info');
            const id = controller.toasts[0].id;
            const initialUpdateCount = host.updateCount;

            controller.actions.remove(id);

            expect(host.updateCount).toBe(initialUpdateCount + 1);
        });

        it('should handle removing non-existent toast gracefully', () => {
            controller.actions.show('Test', 'info');

            // Should not throw
            controller.actions.remove(99999);

            expect(controller.toasts).toHaveLength(1);
        });
    });

    describe('hostDisconnected', () => {
        it('should clear all timers on disconnect', () => {
            controller.actions.show('First', 'info');
            controller.actions.show('Second', 'success');
            controller.actions.show('Third', 'info');

            expect(controller.toasts).toHaveLength(3);

            controller.hostDisconnected();

            // Advance time - no auto-dismiss should occur after disconnect
            vi.advanceTimersByTime(5000);

            // Toasts list is not cleared, but timers are
            expect(controller.toasts).toHaveLength(3);
        });

        it('should prevent memory leaks from pending timers', () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

            controller.actions.show('First', 'info');
            controller.actions.show('Second', 'info');

            controller.hostDisconnected();

            // Should have cleared 2 timers
            expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

            clearTimeoutSpy.mockRestore();
        });
    });

    describe('edge cases', () => {
        it('should handle rapid show/remove cycles', () => {
            for (let i = 0; i < 10; i++) {
                controller.actions.show(`Toast ${i}`, 'info');
            }
            expect(controller.toasts).toHaveLength(10);

            for (const toast of controller.toasts) {
                controller.actions.remove(toast.id);
            }
            expect(controller.toasts).toHaveLength(0);
        });

        it('should handle show during auto-dismiss', () => {
            controller.actions.show('First', 'success');

            vi.advanceTimersByTime(2000);
            expect(controller.toasts).toHaveLength(0);

            controller.actions.show('Second', 'info');
            expect(controller.toasts).toHaveLength(1);
            expect(controller.toasts[0].message).toBe('Second');
        });

        it('should generate unique IDs for toasts', () => {
            controller.actions.show('First', 'info');
            controller.actions.show('Second', 'info');
            controller.actions.show('Third', 'info');

            const ids = controller.toasts.map(t => t.id);
            const uniqueIds = new Set(ids);

            expect(uniqueIds.size).toBe(3);
        });
    });
});
