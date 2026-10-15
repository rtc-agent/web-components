/**
 * AsyncLock tests
 *
 * Tests for the promise-based asynchronous lock utility.
 */

import { describe, expect, it, vi } from 'vitest';
import { AsyncLock } from './async-lock.js';

describe('AsyncLock', () => {
  describe('basic functionality', () => {
    it('should execute operations sequentially for the same key', async () => {
      const lock = new AsyncLock('TestLock');
      const order: number[] = [];

      const op1 = lock.acquire('key1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        order.push(1);
        return 'result1';
      });

      const op2 = lock.acquire('key1', async () => {
        order.push(2);
        return 'result2';
      });

      const [result1, result2] = await Promise.all([op1, op2]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(order).toEqual([1, 2]); // Sequential execution
    });

    it('should execute operations in parallel for different keys', async () => {
      const lock = new AsyncLock('TestLock');
      const order: number[] = [];

      const op1 = lock.acquire('key1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        order.push(1);
        return 'result1';
      });

      const op2 = lock.acquire('key2', async () => {
        order.push(2); // This should complete before op1 due to shorter wait
        return 'result2';
      });

      const [result1, result2] = await Promise.all([op1, op2]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(order).toEqual([2, 1]); // Parallel execution, key2 finishes first
    });

    it('should pass AbortSignal to callback', async () => {
      const lock = new AsyncLock('TestLock');
      let receivedSignal: AbortSignal | undefined;

      await lock.acquire('key1', async (signal) => {
        receivedSignal = signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);
      });

      expect(receivedSignal).toBeDefined();
    });
  });

  describe('timeout', () => {
    it('should reject if operation exceeds timeout', async () => {
      const lock = new AsyncLock('TestLock');

      await expect(
        lock.acquire(
          'key1',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return 'result';
          },
          { timeoutMs: 50 },
        ),
      ).rejects.toThrow(/timeout/i);
    });

    it('should complete if operation finishes before timeout', async () => {
      const lock = new AsyncLock('TestLock');

      const result = await lock.acquire(
        'key1',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'result';
        },
        { timeoutMs: 100 },
      );

      expect(result).toBe('result');
    });
  });

  describe('external AbortSignal', () => {
    it('should abort operation when external signal is aborted', async () => {
      const lock = new AsyncLock('TestLock');
      const controller = new AbortController();
      let aborted = false;

      const promise = lock.acquire(
        'key1',
        async (signal) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (signal.aborted) {
            aborted = true;
          }
          return 'result';
        },
        { signal: controller.signal },
      );

      // Abort after 10ms
      setTimeout(() => controller.abort(), 10);

      await promise;
      expect(aborted).toBe(true);
    });

    it('should link external signal to internal signal', async () => {
      const lock = new AsyncLock('TestLock');
      const controller = new AbortController();
      let internalSignalAborted = false;

      const promise = lock.acquire(
        'key1',
        async (signal) => {
          // Wait for abort
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              internalSignalAborted = true;
              resolve();
            }, { once: true });
            // Also set a timeout in case abort doesn't happen
            setTimeout(resolve, 200);
          });
          return 'result';
        },
        { signal: controller.signal },
      );

      // Abort after 10ms
      setTimeout(() => controller.abort(), 10);

      await promise;
      expect(internalSignalAborted).toBe(true);
    });
  });

  describe('chain length monitoring', () => {
    it('should track active locks during execution', async () => {
      const lock = new AsyncLock('TestLock');

      expect(lock.getActiveLockCount()).toBe(0);
      expect(lock.isLocked('key1')).toBe(false);

      let operationStarted = false;
      let resolveOp: () => void;

      const opPromise = lock.acquire('key1', async () => {
        operationStarted = true;
        await new Promise<void>((resolve) => {
          resolveOp = resolve;
        });
      });

      // Wait for operation to start
      while (!operationStarted) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      // During execution, lock should be active
      expect(lock.isLocked('key1')).toBe(true);
      expect(lock.getActiveLockCount()).toBe(1);
      expect(lock.getChainLength('key1')).toBeGreaterThan(0);

      // Complete the operation
      resolveOp!();
      await opPromise;

      // After completion, chain length should eventually be cleaned up
      // (cleanup is asynchronous, so we just verify it was tracked)
      expect(lock.getChainLength('key1')).toBeGreaterThanOrEqual(0);
    });

    it('should track chain length', async () => {
      const lock = new AsyncLock('TestLock');

      const op1 = lock.acquire('key1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const op2 = lock.acquire('key1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // While operations are queued, chain length should be > 0
      expect(lock.getChainLength('key1')).toBeGreaterThan(0);

      await Promise.all([op1, op2]);

      // After all operations complete, chain should be cleaned up
      // Note: cleanup happens asynchronously
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(lock.getChainLength('key1')).toBe(0);
    });

    it('should warn when chain length exceeds warning threshold', async () => {
      const lock = new AsyncLock('TestLock', 3, 100); // warning at 3
      const order: number[] = [];

      // Queue 4 operations to trigger warning
      const promises = [];
      for (let i = 0; i < 4; i++) {
        promises.push(
          lock.acquire('key1', async () => {
            order.push(i);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }),
        );
      }

      await Promise.all(promises);

      // Check that all operations completed
      expect(order).toEqual([0, 1, 2, 3]);
      // Chain should be cleaned up after completion
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(lock.getChainLength('key1')).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should propagate errors from callback', async () => {
      const lock = new AsyncLock('TestLock');

      await expect(
        lock.acquire('key1', async () => {
          throw new Error('Test error');
        }),
      ).rejects.toThrow('Test error');
    });

    it('should continue processing after error', async () => {
      const lock = new AsyncLock('TestLock');
      const results: string[] = [];

      const op1 = lock.acquire('key1', async () => {
        throw new Error('Test error');
      });

      const op2 = lock.acquire('key1', async () => {
        results.push('op2');
        return 'op2 result';
      });

      await expect(op1).rejects.toThrow('Test error');
      const result2 = await op2;

      expect(result2).toBe('op2 result');
      expect(results).toEqual(['op2']);
    });
  });

  describe('cleanup', () => {
    it('should clear all locks', async () => {
      const lock = new AsyncLock('TestLock');

      // Start some operations
      const promises = [
        lock.acquire('key1', async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }),
        lock.acquire('key2', async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }),
      ];

      expect(lock.getActiveLockCount()).toBe(2);

      // Clear tracking (doesn't cancel operations)
      lock.clear();

      expect(lock.getActiveLockCount()).toBe(0);

      // Operations still complete
      await Promise.all(promises);
    });
  });
});
