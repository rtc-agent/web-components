/**
 * MasterLock: Master Tab election based on Web Locks API.
 *
 * Design principles:
 * - Each Tab holds its own MasterLock; the Tab itself decides whether it is the Master.
 * - Workers do not participate in the election — they neither know nor care who the Master is.
 * - Tab closes -> browser auto-releases the lock -> other Tabs acquire it in queue order -> auto-upgrade.
 * - Lock name contains userId for multi-user isolation.
 *
 * Usage:
 * ```ts
 * const lock = new MasterLock('user-123');
 * lock.onAcquire = () => { console.log('became master'); };
 * lock.onRelease = () => { console.log('lost master'); };
 * await lock.acquire();  // Start trying to acquire the lock (may queue)
 * // ... later
 * lock.release();        // Actively release (browser auto-releases when Tab closes)
 * ```
 *
 * @see docs/shared-worker-proposal.md §4.3
 */

/** MasterLock event callbacks */
import {createLogger} from '@rtc-agent/client';

const log = createLogger('MasterLock');

export interface MasterLockCallbacks {
    /** Acquired lock -> become Master */
    onAcquire?: () => void;
    /** Lost lock -> demote to non-Master */
    onRelease?: () => void;
}

export class MasterLock {
    private _lockName: string;
    private _isMaster = false;
    private _controlled = false;
    private _abortController?: AbortController;

    /** Callback invoked when the lock is acquired */
    onAcquire?: () => void;
    /** Callback invoked when the lock is lost */
    onRelease?: () => void;

    constructor(userId: string) {
        this._lockName = `rtc-agent-master-${userId}`;
    }

    /**
     * Whether the current Tab is the Master.
     */
    get isMaster(): boolean {
        return this._isMaster;
    }

    /**
     * Whether the election process has started (i.e. acquire() was called).
     */
    get isControlled(): boolean {
        return this._controlled;
    }

    /**
     * Start attempting to acquire the Master lock.
     *
     * - If no other Master exists, the lock is acquired immediately.
     * - If a Master already exists, queue and wait (browser-scheduled, zero polling).
     * - Calls onAcquire callback once the lock is obtained.
     * - Tab closes -> browser auto-releases -> queued Tab acquires the lock.
     *
     * Idempotent: only the first call takes effect; subsequent calls are ignored.
     */
    async acquire(): Promise<void> {
        if (this._controlled) {
            log.warn('already acquiring/acquired, ignoring');
            return;
        }

        if (!this._isWebLocksAvailable()) {
            // Web Locks not available -> fall back to "always Master"
            // Compatible with older browsers or special environments (e.g. privacy mode)
            log.warn('Web Locks API not available, acting as always-master');
            this._isMaster = true;
            this._controlled = true;
            this.onAcquire?.();
            return;
        }

        this._controlled = true;
        this._abortController = new AbortController();

        // The callback of navigator.locks.request is invoked when the lock is acquired.
        // The lock is released when the callback's returned Promise resolves.
        // We make the callback never resolve -> the lock is held until the Tab closes.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        navigator.locks.request(
            this._lockName,
            { signal: this._abortController.signal },
            async () => {
                // Acquired lock -> become Master
                this._isMaster = true;
                log.info('acquired lock → became Master');
                this.onAcquire?.();

                // Never resolve -> lock stays held.
                // When the Tab closes, the browser auto-releases it and the next queued Tab acquires it.
                await new Promise<void>((resolve) => {
                    // Store resolve so release() can actively release the lock
                    this._releaseResolve = resolve;
                });

                // Lock released -> demote
                this._isMaster = false;
                log.info('released lock → lost Master');
                this.onRelease?.();
            },
        ).catch((err: unknown) => {
            // AbortError is caused by an explicit release() call; no need to report it.
            if (err instanceof DOMException && err.name === 'AbortError') {
                return;
            }
            log.error('lock request error:', err);
        });
    }

    /**
     * Actively release the Master lock.
     *
     * - If currently Master -> release the lock -> trigger onRelease.
     * - If still queuing -> cancel the queue (abort).
     * - If already not Master -> no-op.
     */
    release(): void {
        if (!this._controlled) {
            return;
        }

        // Unblock the callback -> lock is released -> callback continuation executes.
        if (this._releaseResolve) {
            this._releaseResolve();
            this._releaseResolve = undefined;
        }

        // If still queuing (lock not yet acquired), abort to cancel the queue.
        if (!this._isMaster && this._abortController) {
            this._abortController.abort();
        }

        this._controlled = false;
    }

    /**
     * Check whether the Web Locks API is available.
     */
    private _isWebLocksAvailable(): boolean {
        return typeof navigator !== 'undefined' && 'locks' in navigator;
    }

    /** Used to unblock the acquire callback's await */
    private _releaseResolve?: () => void;
}
