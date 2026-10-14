/**
 * CachedContextController - Base class for context controllers with caching
 *
 * Provides a generic caching mechanism for context values to prevent unnecessary
 * re-renders. @lit/context uses `===` comparison, so creating new objects every
 * time triggers consumers even when state hasn't changed.
 *
 * This base class:
 * - Caches the context value object
 * - Only recreates when state reference changes
 * - Provides type-safe getters and setters
 *
 * Subclasses should:
 * - Define their own state type S and actions type A
 * - Use _setState() or _updateState() to mutate state (cache invalidation is automatic)
 * - Avoid directly manipulating _state without using the provided methods
 *
 * @example
 * ```typescript
 * class ModeController extends CachedContextController<ModeState, ModeActions> {
 *   constructor(host: ReactiveControllerHost) {
 *     super(host, { currentMode: 'auto' }, { setMode: (mode) => this._setMode(mode) });
 *   }
 *
 *   private _setMode(mode: Mode) {
 *     this._setState({ currentMode: mode });  // Cache invalidation is automatic
 *     this.host.requestUpdate();
 *   }
 * }
 * ```
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** Logger interface - subset of Console methods */
export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export abstract class CachedContextController<
  S extends object,
  A extends object,
> implements ReactiveController
{
  protected host: ReactiveControllerHost;

  /** Current state - protected so subclasses can access directly */
  protected _state: S;

  /** Actions object - readonly for consumers */
  public readonly actions: A;

  /**
   * Value cache to prevent unnecessary Context consumer re-renders.
   * Only recreated when state reference changes.
   */
  private _cachedValue?: { state: S; actions: A };
  private _cachedState?: S;

  /** Logger instance (optional, subclasses may override) */
  protected readonly log?: Logger;

  constructor(
    host: ReactiveControllerHost,
    initialState: S,
    actions: A,
    log?: Logger,
  ) {
    this.host = host;
    this._state = initialState;
    this.actions = actions;
    this.log = log;

    // Automatically register with host
    this.host.addController(this);
  }

  /**
   * Get the cached context value.
   * Only creates a new value object if state reference has changed.
   *
   * **Cache Invalidation Design**:
   * This method uses reference equality (`===`) to detect state changes. This means:
   * - _setState() MUST create a new object reference (e.g., `{ ...oldState, ...updates }`)
   * - Mutating properties of the existing state object will NOT trigger cache invalidation
   * - This is intentional: it enforces immutable state updates and prevents subtle bugs
   *
   * @see _setState() - the intended way to update state
   * @see _updateState() - convenience method for partial updates
   */
  get value(): { state: S; actions: A } {
    // Only create new value object if state reference changed
    if (this._cachedValue && this._cachedState === this._state) {
      return this._cachedValue;
    }
    this._cachedState = this._state;
    this._cachedValue = { state: this._state, actions: this.actions };
    return this._cachedValue;
  }

  /** Get current state (for internal use) */
  protected get state(): S {
    return this._state;
  }

  /**
   * Invalidate the value cache.
   * Called automatically by _setState() and _updateState().
   * Not intended for direct use by subclasses — they should use the state
   * mutation methods instead to ensure cache consistency.
   */
  private _invalidateCache(): void {
    this._cachedState = undefined;
    this._cachedValue = undefined;
  }

  /**
   * Update state and invalidate cache.
   *
   * **IMPORTANT**: This method MUST be called with a new object reference.
   * The cache uses reference equality (`===`) to detect changes, so mutating
   * the existing state object will not trigger cache invalidation.
   *
   * **IMPORTANT**: This method does NOT call `this.host.requestUpdate()`.
   * Callers MUST call `this.host.requestUpdate()` after calling this method
   * to trigger a re-render of the host element.
   *
   * Correct usage:
   * ```typescript
   * this._setState({ ...this._state, someProperty: newValue });
   * this.host.requestUpdate();  // Required to trigger re-render
   * ```
   *
   * Incorrect usage (will NOT trigger re-render):
   * ```typescript
   * this._setState({ ...this._state, someProperty: newValue });
   * // Forgot to call this.host.requestUpdate()
   * ```
   *
   * Incorrect usage (will NOT trigger cache invalidation):
   * ```typescript
   * this._state.someProperty = newValue; // ❌ Mutates existing object
   * this._setState(this._state);          // ❌ Same reference
   * ```
   */
  protected _setState(newState: S): void {
    this._state = newState;
    this._invalidateCache();
  }

  /**
   * Partially update state (for object states).
   * Convenience method for subclasses.
   *
   * **IMPORTANT**: This method does NOT call `this.host.requestUpdate()`.
   * Callers MUST call `this.host.requestUpdate()` after calling this method
   * to trigger a re-render of the host element.
   */
  protected _updateState(partial: Partial<S>): void {
    if (typeof this._state === 'object' && this._state !== null) {
      this._state = { ...this._state, ...partial };
      this._invalidateCache();
    }
  }

  // ReactiveController lifecycle hooks

  /**
   * Called when the host element connects to the DOM.
   *
   * Override this method to perform initialization logic, such as
   * subscribing to events or starting async operations.
   */
  hostConnected?(): void;

  /**
   * Called when the host element disconnects from the DOM.
   *
   * Override this method to perform cleanup, such as unsubscribing
   * from events, clearing timers, or aborting in-flight operations.
   */
  hostDisconnected?(): void;
}
