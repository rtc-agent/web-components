/**
 * AsyncLock - Promise-based asynchronous lock for serializing operations.
 *
 * Provides a lightweight mechanism to ensure sequential execution of async operations
 * on the same resource (e.g., file, cache entry). Uses promise chaining to queue
 * operations without blocking the event loop.
 *
 * Key features:
 * - Per-resource locking (different resources run in parallel)
 * - Optional timeout to prevent indefinite hangs
 * - Optional AbortSignal support for external cancellation
 * - Chain length monitoring to detect memory leaks
 * - Automatic cleanup when chain becomes empty
 *
 * Use cases:
 * - File write operations (prevent TOCTOU races)
 * - Cache sync operations (prevent duplicate uploads)
 * - Any scenario requiring sequential access to a shared resource
 *
 * Performance:
 * - Zero overhead for uncontended resources (no lock acquisition delay)
 * - O(1) memory per active lock (cleaned up automatically)
 * - Chain length tracking helps detect unbounded growth (memory leaks)
 *
 * @example
 * ```typescript
 * const lock = new AsyncLock('FileLock');
 *
 * // Basic usage
 * await lock.acquire('file:/path/to/file', async () => {
 *   // Critical section - only one operation per key runs at a time
 *   await writeToFile();
 * });
 *
 * // With timeout
 * await lock.acquire('file:/path', async () => {
 *   await slowOperation();
 * }, { timeoutMs: 30000 });
 *
 * // With AbortSignal
 * const controller = new AbortController();
 * await lock.acquire('file:/path', async (signal) => {
 *   await cancellableOperation(signal);
 * }, { signal: controller.signal });
 * ```
 */

import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('AsyncLock');

/**
 * Options for acquiring a lock.
 */
export interface AsyncLockOptions {
  /**
   * Timeout in milliseconds. If the operation takes longer, it will be rejected.
   * Default: no timeout (wait indefinitely).
   */
  timeoutMs?: number;

  /**
   * External AbortSignal for cancellation. If aborted, the operation is cancelled.
   * The signal is passed to the callback function.
   */
  signal?: AbortSignal;
}

/**
 * AsyncLock: Promise-based asynchronous lock for serializing operations on shared resources.
 *
 * Implementation details:
 * - Uses promise chaining (not mutex) for sequential execution
 * - Each operation waits for the previous one to settle before starting
 * - Different keys (resources) run in parallel
 * - Automatic cleanup when chain becomes empty (prevents memory leaks)
 * - Chain length monitoring helps detect unbounded growth
 */
export class AsyncLock {
  /** Name for logging/debugging */
  private readonly name: string;

  /** Per-key promise chains for sequential execution */
  private readonly chains = new Map<string, Promise<unknown>>();

  /** Per-key chain length tracking for memory leak detection */
  private readonly chainLengths = new Map<string, number>();

  /** Threshold for warning about long chains (potential memory leak) */
  private readonly chainWarningThreshold: number;

  /** Hard limit to reject operations (prevent memory exhaustion) */
  private readonly chainHardLimit: number;

  /**
   * Create a new AsyncLock.
   *
   * @param name - Name for logging/debugging (e.g., 'FileLock', 'SyncLock')
   * @param chainWarningThreshold - Chain length threshold for warnings (default: 50)
   * @param chainHardLimit - Hard limit to reject operations (default: 100)
   */
  constructor(
    name: string,
    chainWarningThreshold: number = 50,
    chainHardLimit: number = 100,
  ) {
    if (!name) {
      throw new Error('[AsyncLock] name is required');
    }
    this.name = name;
    this.chainWarningThreshold = chainWarningThreshold;
    this.chainHardLimit = chainHardLimit;
  }

  /**
   * Acquire the lock and execute an operation.
   *
   * The operation is queued behind any existing operations for the same key.
   * Different keys run in parallel.
   *
   * @param key - Resource identifier (e.g., file path, cache key)
   * @param fn - Async function to execute under the lock. Receives an AbortSignal if provided.
   * @param options - Optional timeout and signal
   * @returns Result of the operation
   * @throws Error if timeout expires, signal is aborted, or chain length exceeds hard limit
   */
  async acquire<T>(
    key: string,
    fn: (signal: AbortSignal) => Promise<T>,
    options: AsyncLockOptions = {},
  ): Promise<T> {
    // IMPORTANT: Add a no-op catch handler to the previous promise to prevent
    // unhandled rejection warnings. The error is still propagated through the
    // chain via the two-argument .then() below.
    const prev = (this.chains.get(key) ?? Promise.resolve()).catch(() => {});

    // Create internal AbortController, merge with external signal
    const controller = new AbortController();
    const externalSignal = options.signal;

    // Link external signal to internal controller
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    // Wrap operation with timeout (if specified)
    const fnWithTimeout = (): Promise<T> => {
      const timeoutMs = options.timeoutMs;

      if (!timeoutMs) {
        // No timeout, just execute
        return fn(controller.signal);
      }

      // Race between operation and timeout
      return Promise.race([
        fn(controller.signal),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            const err = new Error(
              `${this.name} timeout: ${key} locked for >${timeoutMs}ms`,
            );
            controller.abort(err); // Abort underlying operation
            reject(err);
          }, timeoutMs);

          // Clean up timer if operation completes first
          controller.signal.addEventListener(
            'abort',
            () => clearTimeout(timer),
            { once: true },
          );
        }),
      ]);
    };

    // Chain this operation after the previous one settles
    const next = prev.then(
      () => fnWithTimeout(),
      () => fnWithTimeout(), // Even if prev failed, run this operation
    );

    // Track chain position for cleanup
    const settled = next.then(
      (v) => v,
      (e) => {
        throw e;
      },
    );

    // Detect if this is the first operation in the chain
    const isFirstInChain = prev === this.chains.get(key);

    // Update chain length tracking
    const currentChainLength = this.chainLengths.get(key) ?? 0;
    const newChainLength = isFirstInChain ? 1 : currentChainLength + 1;

    // Enforce hard limit to prevent memory exhaustion
    if (newChainLength > this.chainHardLimit) {
      // Clean up external signal listener before throwing
      externalSignal?.removeEventListener('abort', onExternalAbort);

      throw new Error(
        `${this.name}: Promise chain length for ${key} exceeded hard limit ` +
          `(${newChainLength} > ${this.chainHardLimit}). ` +
          `Rejecting operation to prevent memory exhaustion. ` +
          `This indicates a serious memory leak or extremely high concurrency. ` +
          `Investigate why cleanup is not working correctly.`,
      );
    }

    this.chainLengths.set(key, newChainLength);

    // Warn about long chains (potential memory leak)
    if (newChainLength > this.chainWarningThreshold) {
      log.warn(
        `${this.name}: Promise chain length for ${key} is ${newChainLength} ` +
          `(threshold: ${this.chainWarningThreshold}). ` +
          `This may indicate a memory leak if cleanup is not working correctly.`,
      );
    }

    // Update chain and set up cleanup
    // IMPORTANT: Add .catch(() => {}) to prevent unhandled rejection warnings.
    // The error is already propagated to the caller via the returned `next` promise.
    // The stored promise is only used for chaining, not for error handling.
    this.chains.set(
      key,
      settled.finally(() => {
        // Clean up map entry when chain is empty or this is the last operation
        const currentHead = this.chains.get(key);

        if (isFirstInChain || currentHead === settled) {
          // Check if a new operation has queued behind us
          if (currentHead === settled) {
            // No new operations, safe to delete
            this.chains.delete(key);
            this.chainLengths.delete(key);
          }
        } else {
          // Decrement chain length when operation completes but chain continues
          const currentLength = this.chainLengths.get(key) ?? 0;
          if (currentLength > 0) {
            this.chainLengths.set(key, currentLength - 1);
          }
        }

        // Clean up external signal listener
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }).catch(() => {}),
    );

    return next;
  }

  /**
   * Check if a key is currently locked.
   *
   * @param key - Resource identifier
   * @returns True if an operation is in progress for this key
   */
  isLocked(key: string): boolean {
    return this.chains.has(key);
  }

  /**
   * Get the current chain length for a key.
   *
   * Useful for monitoring and debugging.
   *
   * @param key - Resource identifier
   * @returns Number of operations in the chain (0 if not locked)
   */
  getChainLength(key: string): number {
    return this.chainLengths.get(key) ?? 0;
  }

  /**
   * Get the number of active locks (keys with operations in progress).
   *
   * @returns Number of active locks
   */
  getActiveLockCount(): number {
    return this.chains.size;
  }

  /**
   * Clear all locks (for testing/cleanup).
   *
   * WARNING: This does not cancel in-progress operations. It only clears the
   * tracking maps. Use with caution in production code.
   */
  clear(): void {
    this.chains.clear();
    this.chainLengths.clear();
  }
}
