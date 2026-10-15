/**
 * WorkerCore Callback Management Tests
 *
 * Tests for:
 * - registerCallback
 * - unregisterCallback
 * - broadcastUIUpdate
 * - broadcastGapFillState
 * - broadcastAccountBanned
 * - broadcastConnectionState
 * - Zombie state detection and recovery
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerCore } from './worker-core.js';
import type { WorkerCallbacks } from './core-interface.js';

// Mock dependencies
vi.mock('@rtc-agent/persistence', () => ({
  virtualFS: {
    write: vi.fn(),
    writeBatch: vi.fn(),
    remove: vi.fn(),
  },
  getDatabase: vi.fn(),
  initializeVirtualFS: vi.fn(),
}));

vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('WorkerCore - Callback Management', () => {
  let workerCore: WorkerCore;

  beforeEach(() => {
    vi.clearAllMocks();
    workerCore = new WorkerCore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerCallback()', () => {
    it('should add callback to callbacks set', () => {
      const callback = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      workerCore.registerCallback(callback);

      // @ts-expect-error - accessing private field for testing
      expect(workerCore.callbacks.has(callback)).toBe(true);
    });

    it('should increment callbackCount', () => {
      const callback = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      expect(workerCore.callbackCount).toBe(0);
      workerCore.registerCallback(callback);
      expect(workerCore.callbackCount).toBe(1);
    });
  });

  describe('unregisterCallback()', () => {
    it('should remove callback from callbacks set', () => {
      const callback = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      workerCore.registerCallback(callback);
      expect(workerCore.callbackCount).toBe(1);

      workerCore.unregisterCallback(callback);
      // @ts-expect-error - accessing private field for testing
      expect(workerCore.callbacks.has(callback)).toBe(false);
      expect(workerCore.callbackCount).toBe(0);
    });

    it('should handle unregistering non-existent callback gracefully', () => {
      const callback = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      // Should not throw
      expect(() => workerCore.unregisterCallback(callback)).not.toThrow();
    });
  });

  describe('broadcastUIUpdate()', () => {
    it('should call onUIUpdate on all registered callbacks', () => {
      const callback1 = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };
      const callback2 = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      workerCore.registerCallback(callback1);
      workerCore.registerCallback(callback2);

      // Access private method for testing
      // @ts-expect-error - accessing private method for testing
      workerCore.broadcastUIUpdate({
        entity: 'test',
        action: 'updated',
        entityId: '1',
        field: 'test',
        oldValue: undefined,
        newValue: 'test',
      });

      expect(callback1.onUIUpdate).toHaveBeenCalled();
      expect(callback2.onUIUpdate).toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', () => {
      const callback = {
        onUIUpdate: vi.fn().mockImplementation(() => {
          throw new Error('Callback error');
        }),
        requestToken: vi.fn(),
      };

      workerCore.registerCallback(callback);

      // Should not throw even if callback throws
      // @ts-expect-error - accessing private method for testing
      expect(() => workerCore.broadcastUIUpdate({
        entity: 'test',
        action: 'updated',
        entityId: '1',
        field: 'test',
        oldValue: undefined,
        newValue: 'test',
      })).not.toThrow();
    });
  });

  describe('Zombie State Detection', () => {
    /**
     * Helper: create a mock callback that can be configured to succeed or fail.
     */
    function createMockCallback(
      shouldFailSync = false,
      shouldFailAsync = false,
    ): WorkerCallbacks {
      return {
        onUIUpdate: vi.fn().mockImplementation(() => {
          if (shouldFailSync) throw new Error('Sync failure');
          if (shouldFailAsync) return Promise.reject(new Error('Async failure'));
          return Promise.resolve();
        }),
        onGapFillState: vi.fn().mockImplementation(() => {
          if (shouldFailSync) throw new Error('Sync failure');
          if (shouldFailAsync) return Promise.reject(new Error('Async failure'));
          return Promise.resolve();
        }),
        onAccountBanned: vi.fn().mockImplementation(() => {
          if (shouldFailSync) throw new Error('Sync failure');
          if (shouldFailAsync) return Promise.reject(new Error('Async failure'));
          return Promise.resolve();
        }),
        onConnectionStateChange: vi.fn().mockImplementation(() => {
          if (shouldFailSync) throw new Error('Sync failure');
          if (shouldFailAsync) return Promise.reject(new Error('Async failure'));
          return Promise.resolve();
        }),
        requestToken: vi.fn().mockResolvedValue('mock-token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('relogin' as const),
      };
    }

    /**
     * Helper: access private callbacks set for assertions.
     */
    function getPrivateCallbacks(core: WorkerCore): Set<WorkerCallbacks> {
      // @ts-expect-error - accessing private field for testing
      return core.callbacks;
    }

    /**
     * Helper: access private failure counts map for assertions.
     */
    function getPrivateFailureCounts(
      core: WorkerCore,
    ): Map<WorkerCallbacks, number> {
      // @ts-expect-error - accessing private field for testing
      return core._callbackFailureCounts;
    }

    describe('broadcastUIUpdate zombie state', () => {
      it('should clear all callbacks when ALL callbacks fail synchronously', async () => {
        const cb1 = createMockCallback(true, false);
        const cb2 = createMockCallback(true, false);

        workerCore.registerCallback(cb1);
        workerCore.registerCallback(cb2);

        expect(getPrivateCallbacks(workerCore).size).toBe(2);

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastUIUpdate({
          entity: 'test',
          action: 'updated',
          entityId: '1',
          field: 'test',
        });

        // Wait for async operations to settle
        await vi.waitFor(() => {
          expect(getPrivateCallbacks(workerCore).size).toBe(0);
        });
      });

      it('should clear all callbacks when ALL callbacks fail asynchronously', async () => {
        const cb1 = createMockCallback(false, true);
        const cb2 = createMockCallback(false, true);

        workerCore.registerCallback(cb1);
        workerCore.registerCallback(cb2);

        expect(getPrivateCallbacks(workerCore).size).toBe(2);

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastUIUpdate({
          entity: 'test',
          action: 'updated',
          entityId: '1',
          field: 'test',
        });

        // Wait for async operations to settle
        await vi.waitFor(
          () => {
            expect(getPrivateCallbacks(workerCore).size).toBe(0);
          },
          { timeout: 100 },
        );
      });

      it('should NOT trigger zombie state when only SOME callbacks fail', async () => {
        const failingCb = createMockCallback(true, false);
        const successCb = createMockCallback(false, false);

        workerCore.registerCallback(failingCb);
        workerCore.registerCallback(successCb);

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastUIUpdate({
          entity: 'test',
          action: 'updated',
          entityId: '1',
          field: 'test',
        });

        // Wait a bit to ensure async operations complete
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Successful callback should remain, failing callback should be removed
        // (either by zombie state if all fail, or by individual failure tracking)
        // Since one succeeded, zombie state should NOT trigger
        expect(getPrivateCallbacks(workerCore).has(successCb)).toBe(true);
      });

      it('should NOT abort file operations during zombie recovery', async () => {
        const cb = createMockCallback(true, false);
        workerCore.registerCallback(cb);

        // Simulate an ongoing file operation
        // @ts-expect-error - accessing private field for testing
        const operationControllers = workerCore._operationControllers;
        const mockAbortController = new AbortController();
        const abortSpy = vi.spyOn(mockAbortController, 'abort');
        operationControllers.set('test-op-id', mockAbortController);

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastUIUpdate({
          entity: 'test',
          action: 'updated',
          entityId: '1',
          field: 'test',
        });

        // Wait for zombie state detection
        await vi.waitFor(() => {
          expect(getPrivateCallbacks(workerCore).size).toBe(0);
        });

        // File operation should NOT be aborted
        expect(abortSpy).not.toHaveBeenCalled();
        // But the operation controller should still exist (not cleared)
        expect(operationControllers.has('test-op-id')).toBe(true);
      });

      it('should clear failure counts during zombie recovery', async () => {
        const cb = createMockCallback(true, false);
        workerCore.registerCallback(cb);

        // Trigger one failure to populate failure count
        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastUIUpdate({
          entity: 'test',
          action: 'updated',
          entityId: '1',
          field: 'test',
        });

        // Wait for zombie state detection (all failed -> cleared)
        await vi.waitFor(() => {
          expect(getPrivateCallbacks(workerCore).size).toBe(0);
          expect(getPrivateFailureCounts(workerCore).size).toBe(0);
        });
      });
    });

    describe('broadcastGapFillState zombie state', () => {
      it('should clear callbacks when all callbacks fail', async () => {
        const cb1 = createMockCallback(true, false);
        const cb2 = createMockCallback(true, false);

        workerCore.registerCallback(cb1);
        workerCore.registerCallback(cb2);

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastGapFillState(true);

        // Wait for async operations
        await vi.waitFor(() => {
          expect(getPrivateCallbacks(workerCore).size).toBe(0);
        });
      });

      it('should NOT trigger zombie state when some callbacks succeed', async () => {
        const failingCb = createMockCallback(true, false);
        const successCb = createMockCallback(false, false);

        workerCore.registerCallback(failingCb);
        workerCore.registerCallback(successCb);

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastGapFillState(false);

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(getPrivateCallbacks(workerCore).has(successCb)).toBe(true);
      });
    });

    describe('broadcastAccountBanned zombie state', () => {
      it('should clear callbacks when all callbacks fail', async () => {
        const cb1 = createMockCallback(true, false);
        const cb2 = createMockCallback(true, false);

        workerCore.registerCallback(cb1);
        workerCore.registerCallback(cb2);

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastAccountBanned('test-reason');

        await vi.waitFor(() => {
          expect(getPrivateCallbacks(workerCore).size).toBe(0);
        });
      });

      it('should NOT trigger zombie state when some callbacks succeed', async () => {
        const failingCb = createMockCallback(true, false);
        const successCb = createMockCallback(false, false);

        workerCore.registerCallback(failingCb);
        workerCore.registerCallback(successCb);

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastAccountBanned('test-reason');

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(getPrivateCallbacks(workerCore).has(successCb)).toBe(true);
      });
    });

    describe('broadcastConnectionState zombie state', () => {
      it('should clear callbacks when all callbacks fail', async () => {
        const cb1 = createMockCallback(true, false);
        const cb2 = createMockCallback(true, false);

        workerCore.registerCallback(cb1);
        workerCore.registerCallback(cb2);

        const mockEvent = {
          state: 'connected' as const,
          reason: 'test',
        };

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastConnectionState(mockEvent);

        await vi.waitFor(() => {
          expect(getPrivateCallbacks(workerCore).size).toBe(0);
        });
      });

      it('should NOT trigger zombie state when some callbacks succeed', async () => {
        const failingCb = createMockCallback(true, false);
        const successCb = createMockCallback(false, false);

        workerCore.registerCallback(failingCb);
        workerCore.registerCallback(successCb);

        const mockEvent = {
          state: 'disconnected' as const,
          reason: 'test',
        };

        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastConnectionState(mockEvent);

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(getPrivateCallbacks(workerCore).has(successCb)).toBe(true);
      });
    });

    describe('_checkZombieState helper', () => {
      it('should clear callbacks when failCount equals totalCallbacks', () => {
        const cb1 = createMockCallback();
        const cb2 = createMockCallback();

        workerCore.registerCallback(cb1);
        workerCore.registerCallback(cb2);

        expect(getPrivateCallbacks(workerCore).size).toBe(2);

        // @ts-expect-error - accessing private method for testing
        workerCore._checkZombieState(2, 2, 'test-context');

        expect(getPrivateCallbacks(workerCore).size).toBe(0);
        expect(getPrivateFailureCounts(workerCore).size).toBe(0);
      });

      it('should NOT clear callbacks when failCount < totalCallbacks', () => {
        const cb1 = createMockCallback();
        const cb2 = createMockCallback();

        workerCore.registerCallback(cb1);
        workerCore.registerCallback(cb2);

        // @ts-expect-error - accessing private method for testing
        workerCore._checkZombieState(2, 1, 'test-context');

        expect(getPrivateCallbacks(workerCore).size).toBe(2);
      });

      it('should NOT clear callbacks when totalCallbacks is 0', () => {
        // Edge case: no callbacks registered
        // @ts-expect-error - accessing private method for testing
        workerCore._checkZombieState(0, 0, 'test-context');

        // Should not throw or cause issues
        expect(getPrivateCallbacks(workerCore).size).toBe(0);
      });
    });

    describe('Failure count reset on success', () => {
      it('should reset failure count after successful broadcast', async () => {
        const cb = createMockCallback(false, false);
        workerCore.registerCallback(cb);

        // Manually set failure count
        getPrivateFailureCounts(workerCore).set(cb, 2);

        // Successful broadcast should reset the count
        // @ts-expect-error - accessing private method for testing
        workerCore.broadcastUIUpdate({
          entity: 'test',
          action: 'updated',
          entityId: '1',
          field: 'test',
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(getPrivateFailureCounts(workerCore).has(cb)).toBe(false);
      });
    });
  });
});
