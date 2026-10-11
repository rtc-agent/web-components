/**
 * MasterLock Unit Tests — Master Tab Election Logic
 *
 * Tests:
 * - acquire() idempotency (repeated calls are ignored)
 * - Fallback to "always Master" when Web Locks API is unavailable
 * - abort() cancels the queue when release() is called before acquiring
 * - release() branches: "queueing" vs "already held"
 * - onAcquire/onRelease callback timing
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger to avoid noise
vi.mock('@rtc-agent/protocol', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Dynamic import after mocks
const { MasterLock } = await import('./master-lock.js');

describe('MasterLock', () => {
  let originalNavigatorLocks: any;

  beforeEach(() => {
    // Save original navigator.locks
    originalNavigatorLocks = navigator.locks;
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original navigator.locks
    Object.defineProperty(navigator, 'locks', {
      value: originalNavigatorLocks,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  /** Helper to mock navigator.locks.request */
  const mockLocksRequest = (
    impl?: (
      name: string,
      options: any,
      callback: () => Promise<void>,
    ) => Promise<void>,
  ) => {
    const requestMock = vi.fn(
      async (
        name: string,
        options: any,
        callback: () => Promise<void>,
      ): Promise<void> => {
        if (impl) {
          return impl(name, options, callback);
        }
        // Default: invoke callback immediately (lock acquired)
        await callback();
      },
    );

    Object.defineProperty(navigator, 'locks', {
      value: { request: requestMock },
      writable: true,
      configurable: true,
    });

    return requestMock;
  };

  const removeLocksAPI = () => {
    // Delete the property entirely so 'locks' in navigator returns false
    Object.defineProperty(navigator, 'locks', {
      value: undefined,
      writable: true,
      configurable: true,
      enumerable: false, // 'in' operator checks existence, not enumerability
    });
    // Actually delete it
    delete (navigator as any).locks;
  };

  describe('acquire() — basic behavior', () => {
    it('acquires lock immediately and triggers onAcquire', async () => {
      const requestMock = mockLocksRequest();
      const lock = new MasterLock('user-123');
      const onAcquire = vi.fn();
      lock.onAcquire = onAcquire;

      await lock.acquire();

      expect(lock.isMaster).toBe(true);
      expect(lock.isControlled).toBe(true);
      expect(onAcquire).toHaveBeenCalledTimes(1);
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(requestMock).toHaveBeenCalledWith(
        'rtc-agent-master-user-123',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        expect.any(Function),
      );
    });

    it('lock name includes userId for multi-user isolation', async () => {
      const requestMock = mockLocksRequest();
      const lock = new MasterLock('user-456');

      await lock.acquire();

      expect(requestMock).toHaveBeenCalledWith(
        'rtc-agent-master-user-456',
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('acquire() — idempotency', () => {
    it('ignores repeated acquire() calls', async () => {
      const requestMock = mockLocksRequest();
      const lock = new MasterLock('user-123');
      const onAcquire = vi.fn();
      lock.onAcquire = onAcquire;

      await lock.acquire();
      await lock.acquire();
      await lock.acquire();

      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(onAcquire).toHaveBeenCalledTimes(1);
      expect(lock.isMaster).toBe(true);
    });
  });

  describe('Web Locks unavailable — fallback', () => {
    it('falls back to "always Master" mode when navigator.locks is undefined', async () => {
      removeLocksAPI();
      const lock = new MasterLock('user-123');
      const onAcquire = vi.fn();
      lock.onAcquire = onAcquire;

      await lock.acquire();

      expect(lock.isMaster).toBe(true);
      expect(lock.isControlled).toBe(true);
      expect(onAcquire).toHaveBeenCalledTimes(1);
    });

    it('release() resets isMaster and isControlled in fallback mode', async () => {
      removeLocksAPI();
      const lock = new MasterLock('user-123');
      const onRelease = vi.fn();
      lock.onRelease = onRelease;

      await lock.acquire();
      expect(lock.isMaster).toBe(true);

      lock.release();
      // In fallback mode, release() should still reset controlled state
      expect(lock.isControlled).toBe(false);
    });
  });

  describe('release() — queueing vs held', () => {
    it('aborts the queue when release() is called before lock is acquired', async () => {
      let capturedCallback: (() => Promise<void>) | undefined;
      let capturedSignal: AbortSignal | undefined;

      const requestMock = mockLocksRequest(
        async (_name, options, callback) => {
          capturedCallback = callback;
          capturedSignal = options.signal;
          // Simulate lock never acquired (promise never resolves until abort)
          return new Promise<void>((_, reject) => {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        },
      );

      const lock = new MasterLock('user-123');
      const onAcquire = vi.fn();
      const onRelease = vi.fn();
      lock.onAcquire = onAcquire;
      lock.onRelease = onRelease;

      // Start acquire (will queue)
      const acquirePromise = lock.acquire();

      // Give it a tick to set up
      await Promise.resolve();

      expect(lock.isMaster).toBe(false);
      expect(lock.isControlled).toBe(true);

      // Release while queueing
      lock.release();

      // Wait for abort to propagate
      await acquirePromise;

      expect(capturedSignal?.aborted).toBe(true);
      expect(onAcquire).not.toHaveBeenCalled();
      expect(onRelease).not.toHaveBeenCalled();
      expect(lock.isMaster).toBe(false);
      expect(lock.isControlled).toBe(false);
    });

    it('releases the lock when release() is called after acquiring', async () => {
      let heldCallback: (() => Promise<void>) | undefined;

      const requestMock = mockLocksRequest(
        async (_name, _options, callback) => {
          heldCallback = callback;
          // Invoke callback (lock acquired)
          await callback();
        },
      );

      const lock = new MasterLock('user-123');
      const onAcquire = vi.fn();
      const onRelease = vi.fn();
      lock.onAcquire = onAcquire;
      lock.onRelease = onRelease;

      // Start acquire
      const acquirePromise = lock.acquire();

      // Wait for callback to be invoked
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(lock.isMaster).toBe(true);
      expect(onAcquire).toHaveBeenCalledTimes(1);

      // Release the lock
      lock.release();

      // Wait for the callback's promise to resolve
      await acquirePromise;

      expect(lock.isMaster).toBe(false);
      expect(lock.isControlled).toBe(false);
      expect(onRelease).toHaveBeenCalledTimes(1);
    });

    it('is no-op if acquire() was never called', () => {
      const lock = new MasterLock('user-123');
      const onRelease = vi.fn();
      lock.onRelease = onRelease;

      lock.release();

      expect(lock.isMaster).toBe(false);
      expect(lock.isControlled).toBe(false);
      expect(onRelease).not.toHaveBeenCalled();
    });
  });

  describe('onAcquire/onRelease callbacks', () => {
    it('onAcquire is called exactly once when lock is acquired', async () => {
      mockLocksRequest();
      const lock = new MasterLock('user-123');
      const onAcquire = vi.fn();
      lock.onAcquire = onAcquire;

      await lock.acquire();

      expect(onAcquire).toHaveBeenCalledTimes(1);
    });

    it('onRelease is called when lock is actively released', async () => {
      let heldCallback: (() => Promise<void>) | undefined;

      mockLocksRequest(async (_name, _options, callback) => {
        heldCallback = callback;
        await callback();
      });

      const lock = new MasterLock('user-123');
      const onRelease = vi.fn();
      lock.onRelease = onRelease;

      const acquirePromise = lock.acquire();
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(lock.isMaster).toBe(true);

      lock.release();
      await acquirePromise;

      expect(onRelease).toHaveBeenCalledTimes(1);
    });

    it('callbacks are optional (undefined does not throw)', async () => {
      mockLocksRequest();
      const lock = new MasterLock('user-123');
      // No callbacks set

      await expect(lock.acquire()).resolves.toBeUndefined();
      expect(lock.isMaster).toBe(true);

      lock.release();
      // Should not throw
    });
  });

  describe('error handling', () => {
    it('logs non-AbortError exceptions from lock.request', async () => {
      const requestMock = vi.fn().mockRejectedValue(new Error('Lock failed'));

      Object.defineProperty(navigator, 'locks', {
        value: { request: requestMock },
        writable: true,
        configurable: true,
      });

      const lock = new MasterLock('user-123');
      await lock.acquire();

      // Should not throw, and lock should remain controlled
      expect(lock.isControlled).toBe(true);
      expect(lock.isMaster).toBe(false);
    });

    it('silently ignores AbortError from lock.request', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      const requestMock = vi.fn().mockRejectedValue(abortError);

      Object.defineProperty(navigator, 'locks', {
        value: { request: requestMock },
        writable: true,
        configurable: true,
      });

      const lock = new MasterLock('user-123');
      await lock.acquire();

      // Should not throw
      expect(lock.isControlled).toBe(true);
    });
  });

  describe('state transitions', () => {
    it('transitions: initial -> controlled -> master -> released', async () => {
      let heldCallback: (() => Promise<void>) | undefined;

      mockLocksRequest(async (_name, _options, callback) => {
        heldCallback = callback;
        await callback();
      });

      const lock = new MasterLock('user-123');

      // Initial state
      expect(lock.isMaster).toBe(false);
      expect(lock.isControlled).toBe(false);

      // Start acquire
      const acquirePromise = lock.acquire();
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      // Controlled + Master
      expect(lock.isControlled).toBe(true);
      expect(lock.isMaster).toBe(true);

      // Release
      lock.release();
      await acquirePromise;

      // Released
      expect(lock.isControlled).toBe(false);
      expect(lock.isMaster).toBe(false);
    });
  });
});
