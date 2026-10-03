/**
 * Visibility Manager - Visibility state machine
 *
 * Manages virtual scroll visibility state, ensuring operations are paused when not visible,
 * and state is synchronously rebuilt when visibility is restored.
 *
 * Problems addressed:
 * - Virtual scroll continues operating during tab switches (visibility: hidden)
 * - Inconsistent state when browser window loses focus (document.hidden)
 * - Skeletons fail to restore when transitioning from hidden back to visible
 */

import {createLogger} from '@rtc-agent/client';

const log = createLogger('VisibilityManager');

/**
 * Visibility state
 */
export enum VisibilityState {
    /** Visible and active */
    VISIBLE = 'visible',
    /** Not visible (tab switch or window out of focus) */
    HIDDEN = 'hidden',
    /** Transitioning (transition period from hidden to visible) */
    TRANSITIONING = 'transitioning'
}

/**
 * Visibility state change listener
 */
export type VisibilityChangeListener = (state: VisibilityState) => void;

/**
 * Visibility manager
 *
 * Responsibilities:
 * 1. Maintain the visibility state machine (VISIBLE <-> HIDDEN <-> TRANSITIONING)
 * 2. Notify listeners of state changes
 * 3. Provide operation permission check (shouldPerformOperations)
 *
 * Usage:
 * ```typescript
 * const manager = new VisibilityManager();
 *
 * // Listen for state changes
 * manager.onStateChange(state => {
 *     console.log('Visibility changed:', state);
 * });
 *
 * // Update visibility (called externally)
 * manager.update(true);  // Become visible
 * manager.update(false); // Become hidden
 *
 * // Check whether operations should be performed
 * if (manager.shouldPerformOperations()) {
 *     // Execute virtual scroll operations
 * }
 * ```
 */
export class VisibilityManager {
    private _state: VisibilityState = VisibilityState.VISIBLE;
    private _listeners: Set<VisibilityChangeListener> = new Set();

    /**
     * Get current state
     */
    get state(): VisibilityState {
        return this._state;
    }

    /**
     * Update visibility state
     *
     * State transition rules:
     * - VISIBLE -> HIDDEN: direct transition
     * - HIDDEN -> VISIBLE: via TRANSITIONING intermediate state
     * - TRANSITIONING -> VISIBLE: auto-transition (after one frame)
     * - If in TRANSITIONING and receives opposite direction update, cancel transition
     *
     * @param isVisible Whether it is visible
     */
    update(isVisible: boolean): void {
        const newState = isVisible ? VisibilityState.VISIBLE : VisibilityState.HIDDEN;

        // No state change, skip
        if (this._state === newState) {
            return;
        }

        // P1 Fix: Handle TRANSITIONING state with better boundary checks
        // If we're transitioning and receive a new update, handle it carefully
        if (this._state === VisibilityState.TRANSITIONING) {
            // If transitioning to VISIBLE but now receiving HIDDEN, cancel transition
            // and go directly to HIDDEN
            if (!isVisible) {
                log.debug(`Visibility update: canceling transition to VISIBLE, going directly to HIDDEN`);
                this._transitionTo(VisibilityState.HIDDEN);
                return;
            }
            // If transitioning and receiving VISIBLE again (duplicate), ignore
            // We're already on our way to VISIBLE
            if (isVisible) {
                log.debug(`Visibility update: already transitioning to VISIBLE, ignoring duplicate`);
                return;
            }
        }

        log.debug(`Visibility update: ${this._state} → ${newState}`);

        // HIDDEN to VISIBLE must go through TRANSITIONING state
        if (this._state === VisibilityState.HIDDEN && newState === VisibilityState.VISIBLE) {
            this._transitionTo(VisibilityState.TRANSITIONING);

            // Give browser one frame to complete layout, then transition to VISIBLE
            requestAnimationFrame(() => {
                // P1 Fix: Check state again before transitioning, as it may have changed
                if (this._state === VisibilityState.TRANSITIONING) {
                    this._transitionTo(VisibilityState.VISIBLE);
                }
            });
        } else {
            this._transitionTo(newState);
        }
    }

    /**
     * Transition to the specified state and notify listeners
     */
    private _transitionTo(state: VisibilityState): void {
        if (this._state === state) {
            return;
        }

        const oldState = this._state;
        this._state = state;

        log.debug(`Visibility state changed: ${oldState} → ${state}`);

        // Notify all listeners
        for (const listener of this._listeners) {
            try {
                listener(state);
            } catch (err) {
                log.error('Visibility change listener failed:', err);
            }
        }
    }

    /**
     * Register a state change listener
     *
     * @param listener Listener function
     * @returns Unregister function
     */
    onStateChange(listener: VisibilityChangeListener): () => void {
        this._listeners.add(listener);

        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * Check whether virtual scroll operations should be performed
     *
     * Only VISIBLE state allows operations (skeletonize, restore, etc.).
     * HIDDEN and TRANSITIONING states should pause all operations.
     *
     * @returns Whether operations should be performed
     */
    shouldPerformOperations(): boolean {
        return this._state === VisibilityState.VISIBLE;
    }

    /**
     * Check whether currently visible
     *
     * @returns Whether visible (VISIBLE or TRANSITIONING)
     */
    isVisible(): boolean {
        return this._state === VisibilityState.VISIBLE ||
               this._state === VisibilityState.TRANSITIONING;
    }

    /**
     * Clear all listeners (for dispose)
     */
    dispose(): void {
        this._listeners.clear();
        this._state = VisibilityState.VISIBLE;
    }
}
