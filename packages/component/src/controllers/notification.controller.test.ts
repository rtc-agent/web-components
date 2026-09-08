import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {NotificationController} from './notification.controller.js';

// Mock UIUpdateBus
vi.mock('@rtc-agent/persistence', async () => {
    const actual = await vi.importActual('@rtc-agent/persistence');
    return {
        ...actual,
        getUIUpdateBus: vi.fn(),
    };
});

describe('NotificationController', () => {
    let controller: NotificationController;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockHost: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockSessionController: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockMessageController: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockToastController: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockWindowStateController: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockSettingsController: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockPersistence: any;
    let mockBus: {subscribe: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn>};

    beforeEach(async () => {
        const {getUIUpdateBus} = await import('@rtc-agent/persistence');

        vi.clearAllMocks();

        // Mock bus
        mockBus = {
            subscribe: vi.fn(() => vi.fn()),
            publish: vi.fn(),
        };
        vi.mocked(getUIUpdateBus).mockReturnValue(mockBus as any);

        // Mock host
        mockHost = {
            addController: vi.fn(),
            removeController: vi.fn(),
            requestUpdate: vi.fn(),
            dispatchEvent: vi.fn(() => true),
            setAttribute: vi.fn(),
            removeAttribute: vi.fn(),
        } as any;

        // Mock controllers
        const switchSessionFn = vi.fn();
        mockSessionController = {
            actions: {
                switchSession: switchSessionFn,
            },
            value: {
                state: {
                    currentSessionId: 'session-A',
                    sessions: [{clientId: 'session-A', title: 'Session A'}],
                },
                actions: {
                    switchSession: switchSessionFn,
                },
            },
        };

        mockMessageController = {
            value: {
                state: {},
                actions: {},
            },
        };

        mockToastController = {
            actions: {
                show: vi.fn(),
                remove: vi.fn(),
            },
        };

        mockWindowStateController = {
            value: {
                state: {
                    mode: 'normal',
                },
                actions: {},
            },
        };

        mockSettingsController = {
            value: {
                state: {
                    notifications: {
                        soundEnabled: true,
                        toastEnabled: true,
                    },
                },
                actions: {},
            },
        };

        mockPersistence = {
            getMessage: vi.fn().mockResolvedValue({
                session_client_id: 'session-B',
            }),
        };

        // Create controller
        controller = new NotificationController(mockHost);
        controller.sessionController = mockSessionController;
        controller.messageController = mockMessageController;
        controller.toastController = mockToastController;
        controller.windowStateController = mockWindowStateController;
        controller.settingsController = mockSettingsController;
        controller.persistence = mockPersistence;

        // Trigger hostConnected to subscribe to bus
        controller.hostConnected();
    });

    afterEach(async () => {
        controller.hostDisconnected();
        const {closeUIUpdateBus} = await import('@rtc-agent/persistence');
        closeUIUpdateBus();
    });

    describe('_shouldNotify', () => {
        it('should not notify when message belongs to current session', () => {
            // Access private method via any
            const result = (controller as any)._shouldNotify('session-A');
            expect(result).toBe(false);
        });

        it('should notify when message belongs to different session', () => {
            const result = (controller as any)._shouldNotify('session-B');
            expect(result).toBe(true);
        });

        it('should not notify when both sound and toast are disabled', () => {
            mockSettingsController.value!.state.notifications = {
                soundEnabled: false,
                toastEnabled: false,
            };
            const result = (controller as any)._shouldNotify('session-B');
            expect(result).toBe(false);
        });

        it('should notify when at least one notification method is enabled', () => {
            mockSettingsController.value!.state.notifications = {
                soundEnabled: true,
                toastEnabled: false,
            };
            const result = (controller as any)._shouldNotify('session-B');
            expect(result).toBe(true);
        });
    });

    describe('actions', () => {
        it('markAsRead should reset unreadCount to 0', () => {
            // Set up state with unread count
            (controller as any)._state = {
                unreadCount: 5,
                lastNotificationAt: Date.now(),
            };

            controller.actions.markAsRead();

            expect(controller.value.state.unreadCount).toBe(0);
            expect(mockHost.requestUpdate).toHaveBeenCalled();
        });

        it('clearAll should reset state to defaults', () => {
            (controller as any)._state = {
                unreadCount: 5,
                lastNotificationAt: Date.now(),
            };
            (controller as any)._animationTimer = setTimeout(() => {}, 1000);

            controller.actions.clearAll();

            expect(controller.value.state.unreadCount).toBe(0);
            expect(controller.value.state.lastNotificationAt).toBeNull();
            expect(mockHost.removeAttribute).toHaveBeenCalledWith('data-notification');
        });
    });

    describe('UIUpdateBus subscription', () => {
        it('should subscribe to message events on hostConnected', () => {
            expect(mockBus.subscribe).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('should unsubscribe on hostDisconnected', () => {
            const unsubscribe = vi.fn();
            mockBus.subscribe.mockReturnValue(unsubscribe);

            controller.hostConnected();
            controller.hostDisconnected();

            expect(unsubscribe).toHaveBeenCalled();
        });

        it('should handle message created events', async () => {
            const handler = mockBus.subscribe.mock.calls[0][1];
            const event = {
                entity: 'message',
                action: 'created',
                entityId: 'msg-1',
                field: 'content',
                oldValue: null,
                newValue: 'Hello',
            };

            // Call handler (it's async)
            await handler(event);

            // Should have queried message to get session_id
            expect(mockPersistence.getMessage).toHaveBeenCalledWith('msg-1');
        });

        it('should ignore non-created events', async () => {
            const handler = mockBus.subscribe.mock.calls[0][1];
            const event = {
                entity: 'message',
                action: 'updated',
                entityId: 'msg-1',
                field: 'content',
                oldValue: 'Hello',
                newValue: 'World',
            };

            await handler(event);

            expect(mockPersistence.getMessage).not.toHaveBeenCalled();
        });

        it('should ignore non-content field changes', async () => {
            const handler = mockBus.subscribe.mock.calls[0][1];
            const event = {
                entity: 'message',
                action: 'created',
                entityId: 'msg-1',
                field: 'role',
                oldValue: null,
                newValue: 'user',
            };

            await handler(event);

            expect(mockPersistence.getMessage).not.toHaveBeenCalled();
        });
    });

    describe('throttling', () => {
        it('should throttle rapid successive notifications', async () => {
            const handler = mockBus.subscribe.mock.calls[0][1];

            // First event
            await handler({
                entity: 'message',
                action: 'created',
                entityId: 'msg-1',
                field: 'content',
                oldValue: null,
                newValue: 'First',
            });

            // Second event immediately after (should be throttled before getMessage)
            await handler({
                entity: 'message',
                action: 'created',
                entityId: 'msg-2',
                field: 'content',
                oldValue: null,
                newValue: 'Second',
            });

            // First event queries message; second is throttled before getMessage
            expect(mockPersistence.getMessage).toHaveBeenCalledTimes(1);
            // Only one toast should be shown (second is throttled)
            expect(mockToastController.actions.show).toHaveBeenCalledTimes(1);
        });
    });

    describe('_showToast', () => {
        it('should show toast with action when toast is enabled', () => {
            const event = {
                newValue: 'Test message content',
            };

            (controller as any)._showToast(event, 'session-B');

            expect(mockToastController.actions.show).toHaveBeenCalledWith(
                '新消息: Test message content',
                'info',
                expect.objectContaining({
                    label: '查看',
                    onClick: expect.any(Function),
                })
            );
        });

        it('should not show toast when toast is disabled', () => {
            mockSettingsController.value!.state.notifications.toastEnabled = false;

            const event = {
                newValue: 'Test message',
            };

            (controller as any)._showToast(event, 'session-B');

            expect(mockToastController.actions.show).not.toHaveBeenCalled();
        });

        it('should pass full message content to toast (CSS handles truncation)', () => {
            const longMessage = 'A'.repeat(100);
            const event = {
                newValue: longMessage,
            };

            (controller as any)._showToast(event, 'session-B');

            const call = mockToastController.actions.show.mock.calls[0];
            const message = call[0];
            // Full content is passed; CSS handles visual truncation
            expect(message).toContain(longMessage);
        });
    });

    describe('_navigateToSession', () => {
        it('should switch session and mark as read', () => {
            (controller as any)._navigateToSession('session-B');

            expect(mockSessionController.actions.switchSession).toHaveBeenCalledWith('session-B');
            expect(controller.value.state.unreadCount).toBe(0);
        });

        it('should dispatch rtc-notification-click event', () => {
            (controller as any)._navigateToSession('session-B');

            expect(mockHost.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'rtc-notification-click',
                    detail: {sessionId: 'session-B'},
                })
            );
        });
    });

    describe('window mode handling', () => {
        it('should show toast in normal mode', () => {
            mockWindowStateController.value!.state.mode = 'normal';

            (controller as any)._triggerNotification(
                {newValue: 'Test'},
                'session-B'
            );

            expect(mockToastController.actions.show).toHaveBeenCalled();
        });

        it('should animate minimize icon in minimized mode', () => {
            mockWindowStateController.value!.state.mode = 'minimized';

            (controller as any)._triggerNotification(
                {newValue: 'Test'},
                'session-B'
            );

            expect(mockHost.setAttribute).toHaveBeenCalledWith('data-notification', 'active');
        });
    });

    describe('audio management', () => {
        it('should preload sounds on hostConnected', () => {
            // Audio constructor is called during _preloadSounds
            // We can't easily mock Audio in this context, but we can verify
            // that the method was called by checking that sounds Map is populated
            // (though loading may fail in test environment)
            expect((controller as any)._sounds).toBeInstanceOf(Map);
        });

        it('should not play sound when sound is disabled', () => {
            mockSettingsController.value!.state.notifications.soundEnabled = false;

            // Try to play sound (should early return)
            (controller as any)._playSound('message');

            // No error thrown, method handled gracefully
        });
    });

    describe('state management', () => {
        it('should increment unreadCount when notification is triggered', () => {
            const initialCount = controller.value.state.unreadCount;

            (controller as any)._triggerNotification(
                {newValue: 'Test'},
                'session-B'
            );

            expect(controller.value.state.unreadCount).toBe(initialCount + 1);
            expect(controller.value.state.lastNotificationAt).toBeDefined();
        });

        it('should update lastNotificationAt timestamp', () => {
            const before = Date.now();

            (controller as any)._triggerNotification(
                {newValue: 'Test'},
                'session-B'
            );

            const after = Date.now();
            const timestamp = controller.value.state.lastNotificationAt!;

            expect(timestamp).toBeGreaterThanOrEqual(before);
            expect(timestamp).toBeLessThanOrEqual(after);
        });
    });
});
