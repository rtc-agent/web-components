import { createLogger } from '@rtc-agent/client';

const log = createLogger('LifecycleGuard');

/**
 * Lifecycle closed error.
 *
 * Thrown when a DB operation is attempted after the PersistenceLayer
 * has been closed. This replaces the opaque `DatabaseClosedError` from Dexie
 * with a controlled, semantically meaningful error that callers can
 * distinguish and handle gracefully.
 */
export class LifecycleClosedError extends Error {
  constructor(resource: string) {
    super(`LifecycleGuard: ${resource} is closed, operation rejected`);
    this.name = 'LifecycleClosedError';
  }
}

/**
 * Resource lifecycle guard.
 *
 * Solves P1-A: After `close()` drains active tasks and before `closeDatabase()`
 * runs, any background task that attempts a DB operation (e.g. `updateSyncStatus`)
 * would trigger a `DatabaseClosedError` from Dexie. LifecycleGuard intercepts
 * these operations early, converting them into a controlled `LifecycleClosedError`.
 *
 * Usage:
 * 1. Create guard with a descriptive name
 * 2. Call `assertActive()` before every DB operation
 * 3. Call `close()` during shutdown sequence
 */
export class LifecycleGuard {
  private _closed = false;
  private _name: string;

  constructor(name: string) {
    this._name = name;
  }

  /** Mark the guarded resource as closed. Subsequent `assertActive()` calls will throw. */
  close(): void {
    this._closed = true;
    log.debug(`LifecycleGuard "${this._name}" closed`);
  }

  /** Whether the resource has been closed. */
  get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Guard check — call before every DB operation.
   *
   * @throws LifecycleClosedError if the resource has been closed
   */
  assertActive(): void {
    if (this._closed) {
      throw new LifecycleClosedError(this._name);
    }
  }

  /**
   * Safe execution wrapper.
   *
   * Runs `operation()` if the guard is still active. If closed, returns `fallback`
   * (or `undefined`) without throwing. Re-throws non-lifecycle errors.
   *
   * @param operation The async operation to guard
   * @param fallback  Value to return when the guard rejects the operation
   */
  async run<T>(operation: () => Promise<T>, fallback?: T): Promise<T | undefined> {
    try {
      this.assertActive();
      return await operation();
    } catch (err) {
      if (err instanceof LifecycleClosedError) {
        log.debug(`LifecycleGuard: operation rejected due to closed state`);
        return fallback;
      }
      throw err;
    }
  }
}
