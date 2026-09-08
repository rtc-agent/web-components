import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {NotificationController} from './notification.controller.js';
import {closeUIUpdateBus} from '@rtc-agent/persistence';
import type {ReactiveControllerHost} from 'lit';

/**
 * Integration tests for the notification system
 *
 * Verifies end-to-end flows:
 * - UIUpdateBus event → NotificationController → Toast / animation
 * - Toast action → navigate to session + rtc-notification-click event
 * - Settings changes → runtime behavior changes
 * - Minimize animation lifecycle
 */

// Use real UIUpdateBus for integration tests
vi.mock('@rtc-agent/persistence', async () => {
    const actual = await vi.importActual('@rtc-agent/persistence');
    const bus = new (actual as any).UIUpdateBus();
    return {
        ...actual,
        getUIUpdateBus: () => bus,
    };
});

describe('Notification System Integration', () => {
    let controller: NotificationController;
    let mockHost: ReactiveControllerHost & HTMLElement;
    let mockToastShow: ReturnType<typeof vi.fn>;
    let mockSwitchSession: ReturnType<typeof vi.fn>;
    let mockGetMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();

        mockToastShow = vi.fn();
        mockSwitchSession = vi.fn();
        mockGetMessage = vi.fn().mockResolvedValue({session_client_id: 'session-B'});

        mockHost = {
            addController: vi.fn(),
            removeController: vi.fn(),
            requestUpdate: vi.fn(),
            dispatchEvent: vi.fn(() => true),
            setAttribute: vi.fn(),
            removeAttribute: vi.fn(),
        } as any;

        controller = new NotificationController(mockHost);

        // Inject minimal dependencies
        controller.sessionController = {
            actions: {switchSession: mockSwitchSession},
            value: {
                state: {
                    currentSessionId: 'session-A',
                    sessions: [{clientId: 'session-B', title: 'Session B'}],
                },
                actions: {switchSession: mockSwitchSession},
            },
        } as any;

        controller.toastController = {
            actions: {show: mockToastShow, remove: vi.fn()},
        } as any;

        controller.windowStateController = {
            value: {state: {mode: 'normal'}, actions: {}},
        } as any;

        controller.settingsController = {
            value: {
                state: {notifications: {soundEnabled: true, toastEnabled: true}},
                actions: {},
            },
        } as any;

        controller.persistence = {
            getMessage: mockGetMessage,
        } as any;

        controller.hostConnected();
    });

    afterEach(() => {
        controller.hostDisconnected();
        closeUIUpdateBus();
    });

    it('should show toast when UIUpdateBus publishes message for different session', async () => {
        const bus = (await import('@rtc-agent/persistence')).getUIUpdateBus();

        bus.publish({
            entity: 'message',
            action: 'created',
            entityId: 'msg-123',
            field: 'content',
            oldValue: null,
            newValue: 'Hello from session B',
        });

        // Wait for async handler
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockGetMessage).toHaveBeenCalledWith('msg-123');
        expect(mockToastShow).toHaveBeenCalledWith(
            expect.stringContaining('Hello from session B'),
            'info',
            expect.objectContaining({label: '查看'})
        );
        expect(controller.value.state.unreadCount).toBe(1);
    });

    it('should NOT show toast when message belongs to current session', async () => {
        mockGetMessage.mockResolvedValue({session_client_id: 'session-A'});
        const bus = (await import('@rtc-agent/persistence')).getUIUpdateBus();

        bus.publish({
            entity: 'message',
            action: 'created',
            entityId: 'msg-456',
            field: 'content',
            oldValue: null,
            newValue: 'Hello from current session',
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockToastShow).not.toHaveBeenCalled();
        expect(controller.value.state.unreadCount).toBe(0);
    });

    it('should navigate to session and dispatch event when toast action is clicked', async () => {
        const bus = (await import('@rtc-agent/persistence')).getUIUpdateBus();

        bus.publish({
            entity: 'message',
            action: 'created',
            entityId: 'msg-789',
            field: 'content',
            oldValue: null,
            newValue: 'Click me to navigate',
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        // Extract the action from the toast show call
        const action = mockToastShow.mock.calls[0][2];
        expect(action).toBeDefined();
        expect(action.label).toBe('查看');

        // Simulate clicking the action
        action.onClick();

        expect(mockSwitchSession).toHaveBeenCalledWith('session-B');
        expect(controller.value.state.unreadCount).toBe(0);
        expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'rtc-notification-click',
                detail: {sessionId: 'session-B'},
            })
        );
    });

    it('should animate minimize icon when window is minimized', async () => {
        controller.windowStateController = {
            value: {state: {mode: 'minimized'}, actions: {}},
        } as any;

        const bus = (await import('@rtc-agent/persistence')).getUIUpdateBus();

        bus.publish({
            entity: 'message',
            action: 'created',
            entityId: 'msg-min',
            field: 'content',
            oldValue: null,
            newValue: 'Minimized notification',
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockHost.setAttribute).toHaveBeenCalledWith('data-notification', 'active');
        expect(mockToastShow).not.toHaveBeenCalled(); // No toast in minimized mode
    });

    it('should respect runtime settings changes', async () => {
        const bus = (await import('@rtc-agent/persistence')).getUIUpdateBus();

        // Disable toast
        controller.settingsController = {
            value: {
                state: {notifications: {soundEnabled: false, toastEnabled: false}},
                actions: {},
            },
        } as any;

        bus.publish({
            entity: 'message',
            action: 'created',
            entityId: 'msg-settings',
            field: 'content',
            oldValue: null,
            newValue: 'Should not notify',
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockToastShow).not.toHaveBeenCalled();
        expect(controller.value.state.unreadCount).toBe(0);
    });

    it('should clean up resources on disconnect', () => {
        controller.hostDisconnected();

        // Sounds map should be cleared
        expect((controller as any)._sounds.size).toBe(0);
    });
});
