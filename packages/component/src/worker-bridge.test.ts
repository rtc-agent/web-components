/**
 * WorkerBridge Unit Tests — AbortController & Catch-up Cancellation
 *
 * Tests:
 * - destroy() aborts an ongoing catch-up
 * - Cancelled catch-up stops processing events (no further delivery)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WorkerPersistenceCore, WorkerCallbacks, UIUpdatePayload } from '@rtc-agent/worker';
import type { Remote } from 'comlink';

// Mock heavy dependencies before importing WorkerBridge
vi.mock('@rtc-agent/persistence', () => ({
    getUIUpdateBus: () => ({
        publish: vi.fn(),
    }),
    virtualFS: {
        read: vi.fn(),
        write: vi.fn(),
        ls: vi.fn(),
        find: vi.fn(),
    },
}));

vi.mock('@rtc-agent/client', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// Dynamic import after mocks
const { WorkerBridge } = await import('./worker-bridge.js');

describe('WorkerBridge - AbortController & Catch-up Cancellation', () => {
    let bridge: InstanceType<typeof WorkerBridge>;
    let mockAuth: any;
    let mockCore: any;
    let mockCallbacks: {
        onUIUpdate: ReturnType<typeof vi.fn>;
        onStateGap: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mockAuth = {
            getAccessTokenAsync: vi.fn().mockResolvedValue('mock-token'),
            handleTokenExpired: vi.fn().mockResolvedValue('refresh'),
        };

        mockCallbacks = {
            onUIUpdate: vi.fn(),
            onStateGap: vi.fn(),
        };

        mockCore = {
            getCatchUpEvents: vi.fn(),
            registerCallback: vi.fn(),
            unregisterCallback: vi.fn(),
            getConnectionState: vi.fn().mockResolvedValue('connected'),
        };

        // Create bridge instance
        bridge = new WorkerBridge(mockAuth);

        // Directly inject internal state to bypass full init() flow
        (bridge as any)._core = mockCore as unknown as Remote<WorkerPersistenceCore>;
        (bridge as any)._callbacks = mockCallbacks as unknown as WorkerCallbacks;
        (bridge as any)._initialized = true;
        (bridge as any)._lastProcessedSeq = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('destroy() aborts ongoing catch-up', () => {
        it('should cancel _catchUpAbortController when destroy() is called', async () => {
            // Track whether the signal was aborted
            let capturedSignal: AbortSignal | undefined;

            mockCore.getCatchUpEvents.mockImplementation(async (_fromSeq: number) => {
                // Capture the abort signal created inside _doCatchUp
                capturedSignal = (bridge as any)._catchUpAbortController?.signal;
                // Simulate a slow response to give destroy() time to abort
                await new Promise((resolve) => setTimeout(resolve, 50));
                return { entries: [], hasGap: false, hasMore: false };
            });

            // Start catch-up (do not await — it's in progress)
            const catchUpPromise = (bridge as any)._doCatchUp();

            // Wait for getCatchUpEvents to be called and signal to be created
            await vi.waitUntil(() => capturedSignal !== undefined);

            // Verify signal is not yet aborted
            expect(capturedSignal!.aborted).toBe(false);

            // Call destroy — should abort the catch-up
            await bridge.destroy();

            // Verify signal is now aborted
            expect(capturedSignal!.aborted).toBe(true);

            // Wait for catch-up to finish (should exit cleanly after abort)
            await catchUpPromise;
        });

        it('should not throw when destroy() is called without an ongoing catch-up', async () => {
            // No catch-up in progress — _catchUpAbortController is undefined
            await expect(bridge.destroy()).resolves.not.toThrow();
        });
    });

    describe('cancelled catch-up stops processing events', () => {
        it('should stop delivering events after abort signal is set', async () => {
            let callCount = 0;
            let resolveFirstCall: (() => void) | undefined;

            mockCore.getCatchUpEvents.mockImplementation(async (_fromSeq: number) => {
                callCount++;
                if (callCount === 1) {
                    // First call: return events but wait before resolving
                    // so destroy() can abort mid-processing
                    await new Promise<void>((resolve) => {
                        resolveFirstCall = resolve;
                    });
                    return {
                        entries: [
                            { seq: 1, event: { entity: 'file', action: 'updated', entityId: '1', field: 'title', oldValue: null, newValue: 'test' }, timestamp: 1 },
                            { seq: 2, event: { entity: 'file', action: 'updated', entityId: '2', field: 'title', oldValue: null, newValue: 'test2' }, timestamp: 2 },
                        ],
                        hasGap: false,
                        hasMore: true, // Would trigger a second call
                    };
                }
                // Second call should never happen if abort works
                return { entries: [], hasGap: false, hasMore: false };
            });

            // Start catch-up
            const catchUpPromise = (bridge as any)._doCatchUp();

            // Wait for getCatchUpEvents to be called
            await vi.waitUntil(() => callCount > 0);

            // Abort via destroy
            await bridge.destroy();

            // Resolve the first getCatchUpEvents call (after abort is set)
            resolveFirstCall!();

            // Wait for catch-up to complete
            await catchUpPromise;

            // The events should NOT have been delivered because the signal
            // was aborted before the loop could iterate over them.
            // (The signal.aborted check in the for-loop condition prevents delivery.)
            expect(mockCallbacks.onUIUpdate).not.toHaveBeenCalled();

            // Only one call to getCatchUpEvents (second page was skipped due to abort)
            expect(mockCore.getCatchUpEvents).toHaveBeenCalledTimes(1);
        });

        it('should not call onStateGap after abort', async () => {
            let resolveCall: (() => void) | undefined;

            mockCore.getCatchUpEvents.mockImplementation(async () => {
                await new Promise<void>((resolve) => {
                    resolveCall = resolve;
                });
                return {
                    entries: [],
                    hasGap: true, // Would normally trigger onStateGap
                    hasMore: false,
                };
            });

            const catchUpPromise = (bridge as any)._doCatchUp();

            // Wait for getCatchUpEvents to be called
            await vi.waitUntil(() => mockCore.getCatchUpEvents.mock.calls.length > 0);

            // Abort before the result is processed
            await bridge.destroy();

            // Now resolve the mock (after abort)
            resolveCall!();

            await catchUpPromise;

            // onStateGap should NOT be called because the catch-up was cancelled
            // before it could process the gap result
            expect(mockCallbacks.onStateGap).not.toHaveBeenCalled();
        });
    });
});
