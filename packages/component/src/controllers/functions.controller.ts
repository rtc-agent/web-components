/**
 * Functions Controller
 *
 * Manages the function registry state and provides it via Lit Context.
 *
 * Consumed by: <rtc-function-tree>, <rtc-functions-layout>
 * Provided by: <rtc-agent> (root)
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { FunctionRegistry } from '../core/function-registry.js';
import {
  DEFAULT_FUNCTIONS_STATE,
  type FunctionsState,
  type FunctionsActions,
  type FunctionsContextValue,
} from '../contexts/functions.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('FunctionsController');

export class FunctionsController implements ReactiveController {
  host: ReactiveControllerHost;

  private _registry: FunctionRegistry | null = null;
  private _state: FunctionsState = { ...DEFAULT_FUNCTIONS_STATE };

  readonly actions: FunctionsActions;

  /**
   * CRITICAL FIX: Value cache to prevent unnecessary Context consumer re-renders.
   * @lit/context uses `===` comparison, so creating new objects every time triggers
   * consumers even when the state hasn't changed. Cache the value object and only
   * recreate when state reference changes.
   */
  private _cachedValue?: FunctionsContextValue;
  private _cachedState?: FunctionsState;

  get value(): FunctionsContextValue {
    // Only create new value object if state reference changed
    if (this._cachedValue && this._cachedState === this._state) {
      return this._cachedValue;
    }
    this._cachedState = this._state;
    this._cachedValue = { state: this._state, actions: this.actions };
    return this._cachedValue;
  }

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    this.host.addController(this);
    this.actions = {
      refresh: () => this._refresh(),
    };
  }

  hostConnected() {}
  hostDisconnected() {}

  /**
   * Set the function registry
   *
   * Called by <rtc-agent> when the registry is available.
   * Triggers a refresh of the function list.
   */
  setRegistry(registry: FunctionRegistry | null) {
    this._registry = registry;
    if (registry) {
      this._refresh();
    } else {
      this._state = { ...DEFAULT_FUNCTIONS_STATE };
      this.host.requestUpdate();
    }
  }

  /** Refresh function list from registry */
  private _refresh() {
    if (!this._registry) {
      this._state = { ...DEFAULT_FUNCTIONS_STATE };
      this.host.requestUpdate();
      return;
    }

    try {
      const functions = this._registry.listFunctions();
      const groups = this._registry.listGroups();
      this._state = { functions, groups };
      log.debug(
        'Refreshed function list:',
        functions.length,
        'functions,',
        groups.length,
        'groups',
      );
      this.host.requestUpdate();
    } catch (err) {
      log.error('Failed to refresh function list:', err);
    }
  }
}
