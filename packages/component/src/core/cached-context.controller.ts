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
 * - Implement methods to mutate state (calling _invalidateCache when needed)
 * - Call _invalidateCache() when state changes
 *
 * @example
 * ```typescript
 * class ModeController extends CachedContextController<ModeState, ModeActions> {
 *   constructor(host: ReactiveControllerHost) {
 *     super(host, { currentMode: 'auto' }, { setMode: (mode) => this._setMode(mode) });
 *   }
 *
 *   private _setMode(mode: Mode) {
 *     this._state = { currentMode: mode };
 *     this._invalidateCache();
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
  protected readonly _actions: A;

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
    this._actions = actions;
    this.log = log;

    // Automatically register with host
    this.host.addController(this);
  }

  /**
   * Get the cached context value.
   * Only creates a new value object if state reference has changed.
   */
  get value(): { state: S; actions: A } {
    // Only create new value object if state reference changed
    if (this._cachedValue && this._cachedState === this._state) {
      return this._cachedValue;
    }
    this._cachedState = this._state;
    this._cachedValue = { state: this._state, actions: this._actions };
    return this._cachedValue;
  }

  /** Get current state (for internal use) */
  protected get state(): S {
    return this._state;
  }

  /** Get actions (for internal use) */
  protected get actions(): A {
    return this._actions;
  }

  /**
   * Invalidate the value cache.
   * Must be called whenever state changes.
   */
  protected _invalidateCache(): void {
    this._cachedState = undefined;
    this._cachedValue = undefined;
  }

  /**
   * Update state and invalidate cache.
   * Convenience method for subclasses.
   */
  protected _setState(newState: S): void {
    this._state = newState;
    this._invalidateCache();
  }

  /**
   * Partially update state (for object states).
   * Convenience method for subclasses.
   */
  protected _updateState(partial: Partial<S>): void {
    if (typeof this._state === 'object' && this._state !== null) {
      this._state = { ...this._state, ...partial };
      this._invalidateCache();
    }
  }

  // ReactiveController lifecycle hooks
  hostConnected?(): void;
  hostDisconnected?(): void;
}
