/**
 * DebouncedSessionLoader Unit Tests
 *
 * Tests the DebouncedSessionLoader class (Fix 40):
 * - Debouncing multiple rapid requests into a single loadSessions call
 * - Serializing in-flight requests to prevent race conditions
 * - Proper cleanup on dispose
 * - Error handling when loadSessions fails
 *
 * Tests the handleBusEvent function (Fix 45):
 * - Session close should evict message cache
 * - Session reopen should create tab
 * - Other status changes should update tab status
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DebouncedSessionLoader, handleBusEvent } from './bus-handler.js';
import type { UIUpdateEvent } from '@rtc-agent/persistence';

describe('DebouncedSessionLoader', () => {
    let loadSessions: ReturnType<typeof vi.fn>;
    let loader: DebouncedSessionLoader;

    beforeEach(() => {
        vi.useFakeTimers();
        loadSessions = vi.fn().mockResolvedValue(undefined);
        loader = new DebouncedSessionLoader(loadSessions, 50);
    });

    afterEach(() => {
        loader.dispose();
        vi.useRealTimers();
    });

    describe('debouncing', () => {
        it('should call loadSessions after debounce period', async () => {
            loader.request();

            expect(loadSessions).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(50);

            expect(loadSessions).toHaveBeenCalledTimes(1);
        });

        it('should debounce multiple rapid requests into single call', async () => {
            loader.request();
            loader.request();
            loader.request();
            loader.request();
            loader.request();

            await vi.advanceTimersByTimeAsync(50);

            expect(loadSessions).toHaveBeenCalledTimes(1);
        });

        it('should reset debounce timer on each request', async () => {
            loader.request();
            await vi.advanceTimersByTimeAsync(30);
            loader.request();
            await vi.advanceTimersByTimeAsync(30);
            loader.request();

            // Should not have been called yet (timer keeps resetting)
            expect(loadSessions).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(50);

            expect(loadSessions).toHaveBeenCalledTimes(1);
        });

        it('should allow new requests after debounce completes', async () => {
            loader.request();
            await vi.advanceTimersByTimeAsync(50);
            expect(loadSessions).toHaveBeenCalledTimes(1);

            loader.request();
            await vi.advanceTimersByTimeAsync(50);
            expect(loadSessions).toHaveBeenCalledTimes(2);
        });
    });

    describe('serialization', () => {
        it('should serialize in-flight requests', async () => {
            let resolveFirst: () => void;
            const firstPromise = new Promise<void>(resolve => {
                resolveFirst = resolve;
            });
            loadSessions.mockReturnValueOnce(firstPromise);

            loader.request();
            await vi.advanceTimersByTimeAsync(50);

            // First call is in flight
            expect(loadSessions).toHaveBeenCalledTimes(1);

            // Request while first is still in flight
            loader.request();
            await vi.advanceTimersByTimeAsync(50);

            // Second call should wait for first to complete
            expect(loadSessions).toHaveBeenCalledTimes(1);

            // Complete first call
            resolveFirst!();
            await vi.advanceTimersByTimeAsync(0);

            // Now second call should execute
            expect(loadSessions).toHaveBeenCalledTimes(2);
        });

        it('should handle errors in loadSessions', async () => {
            loadSessions.mockRejectedValueOnce(new Error('Load failed'));

            loader.request();
            await vi.advanceTimersByTimeAsync(50);

            // Wait for the error to be caught and handled
            await vi.advanceTimersByTimeAsync(10);

            // Should still allow new requests after error
            loader.request();
            await vi.advanceTimersByTimeAsync(50);
            expect(loadSessions).toHaveBeenCalledTimes(2);
        });
    });

    describe('dispose', () => {
        it('should cancel pending timer on dispose', async () => {
            loader.request();
            loader.dispose();

            await vi.advanceTimersByTimeAsync(50);

            expect(loadSessions).not.toHaveBeenCalled();
        });

        it('should be safe to call dispose multiple times', () => {
            loader.dispose();
            loader.dispose();
            loader.dispose();

            // Should not throw
        });

        it('should allow creating new loader after dispose', async () => {
            loader.request();
            loader.dispose();

            const newLoader = new DebouncedSessionLoader(loadSessions, 50);
            newLoader.request();
            await vi.advanceTimersByTimeAsync(50);

            expect(loadSessions).toHaveBeenCalledTimes(1);

            newLoader.dispose();
        });
    });

    describe('edge cases', () => {
        it('should handle custom debounce period', async () => {
            const customLoader = new DebouncedSessionLoader(loadSessions, 100);

            customLoader.request();
            await vi.advanceTimersByTimeAsync(50);
            expect(loadSessions).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(50);
            expect(loadSessions).toHaveBeenCalledTimes(1);

            customLoader.dispose();
        });

        it('should handle zero debounce period', async () => {
            const instantLoader = new DebouncedSessionLoader(loadSessions, 0);

            instantLoader.request();
            await vi.advanceTimersByTimeAsync(0);

            expect(loadSessions).toHaveBeenCalledTimes(1);

            instantLoader.dispose();
        });

        it('should handle rapid request-dispose-request cycles', async () => {
            loader.request();
            loader.dispose();
            loader.request();

            await vi.advanceTimersByTimeAsync(50);

            expect(loadSessions).toHaveBeenCalledTimes(1);
        });

        it('should handle loadSessions returning undefined', async () => {
            loadSessions.mockResolvedValueOnce(undefined);

            loader.request();
            await vi.advanceTimersByTimeAsync(50);

            expect(loadSessions).toHaveBeenCalledTimes(1);
        });

        it('should handle loadSessions returning a value', async () => {
            loadSessions.mockResolvedValueOnce('some value' as any);

            loader.request();
            await vi.advanceTimersByTimeAsync(50);

            expect(loadSessions).toHaveBeenCalledTimes(1);
        });
    });
});

describe('handleBusEvent - Fix 45: Session close evicts message cache', () => {
    let mockMessage: { updateMessageFromBus: ReturnType<typeof vi.fn>; evictSession: ReturnType<typeof vi.fn> };
    let mockSession: { value: { state: { sessions: Array<{clientId: string; title: string}> } } };
    let mockSessionTab: { actions: { closeTab: ReturnType<typeof vi.fn>; openOrActivate: ReturnType<typeof vi.fn>; updateTabStatus: ReturnType<typeof vi.fn> } };
    let mockSessionTree: {};
    let mockSessionLoader: DebouncedSessionLoader;
    let mockRefreshTurnCounts: ReturnType<typeof vi.fn>;
    let mockHandleFileChange: ReturnType<typeof vi.fn>;
    let mockLog: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
    let mockGetRtcProcessor: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        mockMessage = {
            updateMessageFromBus: vi.fn().mockResolvedValue(undefined),
            evictSession: vi.fn(),
        };
        mockSession = {
            value: {
                state: {
                    sessions: [
                        { clientId: 'session-1', title: 'Session 1' },
                        { clientId: 'session-2', title: 'Session 2' },
                    ],
                },
            },
        };
        mockSessionTab = {
            actions: {
                closeTab: vi.fn(),
                openOrActivate: vi.fn(),
                updateTabStatus: vi.fn(),
            },
        };
        mockSessionTree = {};
        mockSessionLoader = new DebouncedSessionLoader(vi.fn().mockResolvedValue(undefined), 50);
        mockRefreshTurnCounts = vi.fn().mockResolvedValue(undefined);
        mockHandleFileChange = vi.fn().mockResolvedValue(undefined);
        mockLog = {
            debug: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
        };
        mockGetRtcProcessor = vi.fn().mockReturnValue(undefined);
    });

    afterEach(() => {
        mockSessionLoader.dispose();
        vi.useRealTimers();
    });

    const createDeps = () => ({
        message: mockMessage,
        session: mockSession,
        sessionTab: mockSessionTab,
        sessionTree: mockSessionTree,
        persistence: {},
        getRtcProcessor: mockGetRtcProcessor,
        sessionLoader: mockSessionLoader,
        refreshTurnCounts: mockRefreshTurnCounts,
        handleFileChange: mockHandleFileChange,
        log: mockLog,
    });

    describe('session close', () => {
        it('should call closeTab and evictSession when session status changes to closed', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: 'idle',
                newValue: 'closed',
            };

            handleBusEvent(event, createDeps());

            expect(mockSessionTab.actions.closeTab).toHaveBeenCalledWith('session-1');
            expect(mockMessage.evictSession).toHaveBeenCalledWith('session-1');
        });

        it('should still call evictSession even if closeTab throws', () => {
            mockSessionTab.actions.closeTab.mockImplementation(() => {
                throw new Error('closeTab failed');
            });

            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: 'idle',
                newValue: 'closed',
            };

            // Should not throw (error is caught internally)
            expect(() => handleBusEvent(event, createDeps())).not.toThrow();

            // evictSession should still be called even when closeTab throws
            expect(mockMessage.evictSession).toHaveBeenCalledWith('session-1');
        });

        it('should not call evictSession for non-closed status changes', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: 'idle',
                newValue: 'active',
            };

            handleBusEvent(event, createDeps());

            expect(mockSessionTab.actions.closeTab).not.toHaveBeenCalled();
            expect(mockMessage.evictSession).not.toHaveBeenCalled();
            expect(mockSessionTab.actions.updateTabStatus).toHaveBeenCalledWith('session-1', 'active');
        });
    });

    describe('session reopen', () => {
        it('should call openOrActivate when session reopens from closed to idle', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: 'closed',
                newValue: 'idle',
            };

            handleBusEvent(event, createDeps());

            expect(mockSessionTab.actions.openOrActivate).toHaveBeenCalledWith('session-1', 'Session 1', { activate: false });
            expect(mockMessage.evictSession).not.toHaveBeenCalled();
        });

        it('should call openOrActivate when session reopens from closed to active', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: 'closed',
                newValue: 'active',
            };

            handleBusEvent(event, createDeps());

            expect(mockSessionTab.actions.openOrActivate).toHaveBeenCalledWith('session-1', 'Session 1', { activate: false });
        });

        it('should use default title if session not found in list', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'unknown-session',
                field: 'status',
                action: 'updated',
                oldValue: 'closed',
                newValue: 'idle',
            };

            handleBusEvent(event, createDeps());

            expect(mockSessionTab.actions.openOrActivate).toHaveBeenCalledWith('unknown-session', '未命名', { activate: false });
        });
    });

    describe('other status changes', () => {
        it('should call updateTabStatus for status changes that are not close or reopen', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: 'idle',
                newValue: 'active',
            };

            handleBusEvent(event, createDeps());

            expect(mockSessionTab.actions.updateTabStatus).toHaveBeenCalledWith('session-1', 'active');
            expect(mockSessionTab.actions.closeTab).not.toHaveBeenCalled();
            expect(mockMessage.evictSession).not.toHaveBeenCalled();
        });

        it('should do nothing if newValue is undefined', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: 'idle',
                newValue: undefined,
            };

            handleBusEvent(event, createDeps());

            expect(mockSessionTab.actions.updateTabStatus).not.toHaveBeenCalled();
            expect(mockSessionTab.actions.closeTab).not.toHaveBeenCalled();
            expect(mockMessage.evictSession).not.toHaveBeenCalled();
        });
    });

    describe('edge cases', () => {
        it('should handle session close without oldValue', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: undefined,
                newValue: 'closed',
            };

            handleBusEvent(event, createDeps());

            expect(mockSessionTab.actions.closeTab).toHaveBeenCalledWith('session-1');
            expect(mockMessage.evictSession).toHaveBeenCalledWith('session-1');
        });

        it('should handle session close with same oldValue and newValue', () => {
            const event: UIUpdateEvent = {
                entity: 'session',
                entityId: 'session-1',
                field: 'status',
                action: 'updated',
                oldValue: 'closed',
                newValue: 'closed',
            };

            handleBusEvent(event, createDeps());

            // Should still call closeTab and evictSession
            expect(mockSessionTab.actions.closeTab).toHaveBeenCalledWith('session-1');
            expect(mockMessage.evictSession).toHaveBeenCalledWith('session-1');
        });

        it('should not affect other entities', () => {
            const event: UIUpdateEvent = {
                entity: 'message',
                entityId: 'message-1',
                field: 'content',
                action: 'updated',
            };

            handleBusEvent(event, createDeps());

            expect(mockMessage.updateMessageFromBus).toHaveBeenCalledWith('message-1');
            expect(mockSessionTab.actions.closeTab).not.toHaveBeenCalled();
            expect(mockMessage.evictSession).not.toHaveBeenCalled();
        });
    });
});

describe('handleBusEvent - Turn events', () => {
    const createDeps = () => {
        const mockRefreshTurnCounts = vi.fn().mockResolvedValue(undefined);
        return {
            message: {
                updateMessageFromBus: vi.fn().mockResolvedValue(undefined),
                evictSession: vi.fn(),
            },
            session: {
                value: { state: { sessions: [] } },
            },
            sessionTab: {
                actions: {
                    closeTab: vi.fn(),
                    openOrActivate: vi.fn(),
                    updateTabStatus: vi.fn(),
                },
            },
            sessionTree: {},
            persistence: {
                layer: undefined,
                masterLock: undefined,
            },
            getRtcProcessor: () => undefined,
            sessionLoader: new DebouncedSessionLoader(vi.fn(), 50),
            refreshTurnCounts: mockRefreshTurnCounts,
            handleFileChange: vi.fn().mockResolvedValue(undefined),
            log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            _mockRefreshTurnCounts: mockRefreshTurnCounts,
        };
    };

    it('should call refreshTurnCounts when turn entity is created', () => {
        const deps = createDeps();
        const event: UIUpdateEvent = {
            entity: 'turn',
            entityId: 'turn-1',
            action: 'created',
        };

        handleBusEvent(event, deps);

        expect(deps._mockRefreshTurnCounts).toHaveBeenCalledTimes(1);
    });

    it('should call refreshTurnCounts when turn entity is updated', () => {
        const deps = createDeps();
        const event: UIUpdateEvent = {
            entity: 'turn',
            entityId: 'turn-1',
            field: 'status',
            action: 'updated',
            oldValue: 'pending',
            newValue: 'running',
        };

        handleBusEvent(event, deps);

        expect(deps._mockRefreshTurnCounts).toHaveBeenCalledTimes(1);
    });

    it('should call refreshTurnCounts when turn entity is deleted', () => {
        const deps = createDeps();
        const event: UIUpdateEvent = {
            entity: 'turn',
            entityId: 'turn-1',
            action: 'deleted',
        };

        handleBusEvent(event, deps);

        expect(deps._mockRefreshTurnCounts).toHaveBeenCalledTimes(1);
    });
});
