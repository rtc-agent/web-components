// TrackedBackgroundTask — Lifecycle-aware background task wrapper

import { SyncTaskTracker } from './sync-task-tracker.js';
import { LifecycleGuard, LifecycleClosedError } from './lifecycle-guard.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('TrackedBackgroundTask');

/**
 * TrackedBackgroundTask — Lifecycle-aware background task wrapper.
 *
 * Solves P2-005, P2-006: All fire-and-forget tasks are tracked and cancellable.
 * Solves P3-001: Retry delays are cancellable via AbortController.
 *
 * Features:
 * - Task is tracked in SyncTaskTracker (close() waits for completion)
 * - LifecycleGuard prevents DB operations after close
 * - Optional retry with exponential backoff
 * - Cancellable delays (no waiting full delay after lifecycle close)
 *
 * Usage:
 * ```typescript
 * const task = new TrackedBackgroundTask(syncTaskTracker, lifecycleGuard);
 * task.run('session-sync', async (signal) => {
 *   await rpc();
 *   await markSessionSynced();
 * }, { retries: 3, baseDelay: 1000 });
 * ```
 */
export class TrackedBackgroundTask {
  constructor(
    private tracker: SyncTaskTracker,
    private guard: LifecycleGuard,
    private closeSignal?: AbortSignal,
  ) {}

  /**
   * Run a tracked background task.
   *
   * The task is immediately tracked in the SyncTaskTracker. If the lifecycle
   * closes, the task will be gracefully stopped (no further retries).
   *
   * Returns a Promise<void> for chaining .catch() — but callers are not required
   * to await it (fire-and-forget is still supported).
   *
   * @param label Descriptive label for tracking
   * @param action Async action to execute. Receives an AbortSignal.
   * @param options Retry options
   * @returns Promise that resolves when all retries are exhausted or action succeeds
   */
  run(
    label: string,
    action: (signal: AbortSignal) => Promise<void>,
    options?: {
      /** Maximum retry attempts (0 = no retry) */
      retries?: number;
      /** Base delay in ms for exponential backoff (default: 1000) */
      baseDelay?: number;
      /** Use exponential backoff (default: true) */
      exponentialBackoff?: boolean;
    },
  ): Promise<void> {
    const ac = new AbortController();
    const maxRetries = options?.retries ?? 0;
    const baseDelay = options?.baseDelay ?? 1000;
    const exponential = options?.exponentialBackoff ?? true;

    // P1-R5-02: Wire lifecycle close signal to abort controller.
    // When lifecycle closes, abort the task so it stops gracefully.
    // P2-R6-01: Track listener reference so it can be removed after task completes.
    let onCloseAbort: (() => void) | undefined;
    if (this.closeSignal) {
      if (this.closeSignal.aborted) {
        ac.abort();
      } else {
        onCloseAbort = () => ac.abort();
        this.closeSignal.addEventListener('abort', onCloseAbort, { once: true });
      }
    }

    const task = this._attempt(ac.signal, action, 0, maxRetries, baseDelay, exponential, label);
    // P2-R6-01: Clean up listener when task finishes (success, error, or cancel)
    // to prevent listener accumulation on long-lived closeSignal.
    task.finally(() => {
      if (onCloseAbort && this.closeSignal) {
        this.closeSignal.removeEventListener('abort', onCloseAbort);
      }
    });
    this.tracker.track(task, label);
    return task;
  }

  private async _attempt(
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<void>,
    retry: number,
    maxRetries: number,
    baseDelay: number,
    exponential: boolean,
    label: string,
  ): Promise<void> {
    try {
      // Check lifecycle before each attempt
      this.guard.assertActive();
      await action(signal);
    } catch (err) {
      // Lifecycle closed: stop gracefully
      if (err instanceof LifecycleClosedError) {
        log.debug(`TrackedBackgroundTask: lifecycle closed for ${label}, stopping`);
        return;
      }

      // Cancelled: stop gracefully
      if (signal.aborted) {
        log.debug(`TrackedBackgroundTask: cancelled for ${label}`);
        return;
      }

      // Retry if under limit
      if (retry < maxRetries) {
        const delay = exponential ? baseDelay * Math.pow(2, retry) : baseDelay;
        log.debug(`TrackedBackgroundTask: retry ${retry + 1}/${maxRetries} for ${label} after ${delay}ms`);

        // P3-001 fix: cancellable delay
        await this._cancellableDelay(delay, signal);

        // P2-R7-01: Check abort AFTER delay — _cancellableDelay resolves (not rejects)
        // on abort, so without this check the recursive _attempt would execute the
        // action one final unwanted time after cancellation.
        if (signal.aborted) {
          log.debug(`TrackedBackgroundTask: cancelled during delay for ${label}`);
          return;
        }

        return this._attempt(signal, action, retry + 1, maxRetries, baseDelay, exponential, label);
      }

      // Max retries reached: log error and re-throw so caller can handle
      log.error(`TrackedBackgroundTask: ${label} failed after ${maxRetries + 1} attempts:`, err);
      throw err;
    }
  }

  /**
   * Cancellable delay — resolves early if signal is aborted.
   *
   * Unlike `setTimeout`, this delay can be interrupted by the signal,
   * allowing graceful shutdown instead of waiting the full duration.
   */
  private _cancellableDelay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        resolve(); // Resolve instead of reject for graceful shutdown
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
