// FileSyncTransaction — Atomic file sync state transitions

import { FileCacheRepository, type CachedFileInfo, type FileSyncStatus } from './file-cache-repository.js';
import { FileOpCoordinator } from './file-op-coordinator.js';
import { LifecycleGuard, LifecycleClosedError } from './lifecycle-guard.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('FileSyncTransaction');

/**
 * FileSyncTransaction — Atomic file sync state transitions.
 *
 * Solves P1-001, P1-002: Ensures state transition succeeds before proceeding.
 * Solves P1-003: Re-fetches entry inside transaction to avoid stale references.
 * Solves P1-R5-01: Error type discrimination — AbortError/LifecycleClosedError
 *   do NOT transition to failure state.
 * Solves P1-R5-03: Protected success transition with retry.
 *
 * Error type discrimination:
 *
 * | Error Class | Semantics | State Action |
 * |---|---|---|
 * | AbortError | Caller cancelled or lifecycle closed | Leave state unchanged |
 * | LifecycleClosedError | DB is closed | Leave state unchanged, stop retrying |
 * | OperationalError | Network failure, S3 error | Transition to onFailure |
 *
 * Flow:
 * 1. Re-fetch entry from DB (avoids stale blob reference)
 * 2. Check abort signal before transition
 * 3. Transition to intermediate state (e.g., 'syncing') — checked, returns boolean
 * 4. If transition fails, abort and return error
 * 5. Execute action with fresh entry + signal
 * 6. On AbortError/LifecycleClosedError: leave state unchanged, return aborted
 * 7. On OperationalError: transition to failure state
 * 8. On success: protected transition to success state (with retry)
 *
 * Usage:
 * ```typescript
 * const tx = new FileSyncTransaction(repo, coordinator, lifecycleGuard);
 * const result = await tx.run(md5, ext, {
 *   from: ['pending', 'failed'],
 *   to: 'syncing',
 *   signal: abortSignal,
 *   action: async (freshEntry, signal) => {
 *     await s3Client.upload(freshEntry.blob, { signal });
 *   },
 *   onSuccess: 'synced',
 *   onFailure: 'failed',
 * });
 * if (result.aborted) {
 *   console.log('Transaction was cancelled');
 * } else if (!result.success) {
 *   console.log('Transaction failed:', result.error);
 * }
 * ```
 */
export class FileSyncTransaction {
  constructor(
    private repo: FileCacheRepository,
    private coordinator: FileOpCoordinator,
    private guard?: LifecycleGuard,
  ) {}

  /**
   * Execute an atomic file sync transaction.
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param spec Transaction specification
   * @returns Result: success boolean + optional error/aborted
   */
  async run(
    md5: string,
    ext: string,
    spec: {
      /** Allowed precondition state(s) */
      from: FileSyncStatus | FileSyncStatus[];
      /** Intermediate state to transition to before action */
      to: FileSyncStatus;
      /** Action to execute with the fresh entry. Throw on failure. */
      action: (entry: CachedFileInfo, signal?: AbortSignal) => Promise<void>;
      /** State to transition to on success */
      onSuccess: FileSyncStatus;
      /** State to transition to on failure */
      onFailure: FileSyncStatus;
      /** Optional abort signal for cancellation */
      signal?: AbortSignal;
    },
  ): Promise<{ success: boolean; error?: string; aborted?: boolean }> {
    // 1. Re-fetch entry (avoids stale reference — P1-003 fix)
    const entry = await this.repo.get(md5, ext);
    if (!entry) {
      log.warn(`FileSyncTransaction: entry not found for ${md5}.${ext}`);
      return { success: false, error: 'Entry not found' };
    }

    // 2. Check abort before transition
    if (spec.signal?.aborted) {
      return { success: false, aborted: true };
    }

    // 3. Transition to intermediate state (checked — P1-001/002 fix)
    const transitioned = await this.coordinator.transitionAndNotify(
      this.repo, md5, ext, spec.from, spec.to,
    );
    if (!transitioned) {
      log.debug(
        `FileSyncTransaction: transition precondition not met for ${md5}.${ext} ` +
        `(from [${Array.isArray(spec.from) ? spec.from.join(',') : spec.from}] to ${spec.to})`
      );
      return { success: false, error: 'Transition precondition not met' };
    }

    // 4. Execute action with fresh entry
    try {
      await spec.action(entry, spec.signal);
    } catch (err) {
      // ── P1-R5-01: Error type discrimination ──

      // AbortError: caller cancelled. Leave state in 'syncing' (unchanged).
      // recoverStaleSyncing() on next startup will reset to 'pending'.
      if (err instanceof Error && err.name === 'AbortError') {
        log.info(`FileSyncTransaction: aborted for ${md5}.${ext}, state unchanged`);
        return { success: false, aborted: true };
      }

      // LifecycleClosedError: DB closed. Cannot transition at all.
      // State stays in 'syncing'. recoverStaleSyncing() will recover.
      if (err instanceof LifecycleClosedError) {
        log.debug(`FileSyncTransaction: lifecycle closed for ${md5}.${ext}, state unchanged`);
        return { success: false, aborted: true };
      }

      // OperationalError: genuine failure. Transition to onFailure.
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.coordinator.transitionAndNotify(
        this.repo, md5, ext, spec.to, spec.onFailure,
        { errorMessage },
      );
      return { success: false, error: errorMessage };
    }

    // 5. ── P1-R5-03: Protected success transition ──
    // The S3 upload succeeded. We MUST transition to 'synced' even if
    // lifecycle is closing. The action already completed on S3.
    const successTransitioned = await this._protectedSuccessTransition(
      md5, ext, spec.to, spec.onSuccess,
    );

    if (!successTransitioned) {
      // File is stuck in 'syncing' on disk, but S3 has the data.
      // recoverStaleSyncing() on next startup will reset to 'pending',
      // and the next sync will succeed via syncWithDedup (S3 put is idempotent).
      log.warn(
        `FileSyncTransaction: success transition could not complete for ${md5}.${ext}, ` +
        `will recover on next startup`
      );
    }

    return { success: true };
  }

  /**
   * Protected success transition with lifecycle-aware retry.
   *
   * Unlike failure transitions, success transitions MUST eventually complete
   * because the external system (S3) already has the data. We attempt:
   * 1. Direct transition (fast path)
   * 2. LifecycleGuard.run() with short retry (covers transient close delay)
   * 3. Return false if all attempts fail (recoverStaleSyncing is the safety net)
   */
  private async _protectedSuccessTransition(
    md5: string,
    ext: string,
    fromState: FileSyncStatus,
    toState: FileSyncStatus,
  ): Promise<boolean> {
    // Attempt 1: direct transition
    try {
      const result = await this.coordinator.transitionAndNotify(
        this.repo, md5, ext, fromState, toState,
      );
      if (result) return true;
    } catch (err) {
      if (!(err instanceof LifecycleClosedError)) {
        log.warn(`FileSyncTransaction: success transition error for ${md5}.${ext}:`, err);
      }
    }

    // Attempt 2: lifecycleGuard.run() retry (3 attempts, 100ms apart)
    if (this.guard) {
      for (let i = 0; i < 3; i++) {
        const result = await this.guard.run(async () => {
          return await this.coordinator.transitionAndNotify(
            this.repo, md5, ext, fromState, toState,
          );
        });
        if (result) return true;
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return false;
  }
}
