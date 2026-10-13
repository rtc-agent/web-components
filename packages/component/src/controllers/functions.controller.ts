/**
 * Functions Controller
 *
 * Manages the function registry state and provides it via Lit Context.
 *
 * Consumed by: <rtc-function-tree>, <rtc-functions-layout>
 * Provided by: <rtc-agent> (root)
 */
import type { ReactiveControllerHost } from 'lit';
import type { FunctionRegistry } from '../core/function-registry.js';
import {
  DEFAULT_FUNCTIONS_STATE,
  type FunctionsState,
  type FunctionsActions,
  type FunctionsContextValue,
} from '../contexts/functions.js';
import { createLogger } from '@rtc-agent/protocol';
import { CachedContextController } from '../core/cached-context.controller.js';

const log = createLogger('FunctionsController');

export class FunctionsController extends CachedContextController<
  FunctionsState,
  FunctionsActions
> {
  private _registry: FunctionRegistry | null = null;

  constructor(host: ReactiveControllerHost) {
    const actions: FunctionsActions = {
      refresh: () => this._refresh(),
    };

    super(host, { ...DEFAULT_FUNCTIONS_STATE }, actions, log);
  }

  /** Override value getter to return FunctionsContextValue type */
  get value(): FunctionsContextValue {
    return super.value as FunctionsContextValue;
  }

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
      this._setState({ ...DEFAULT_FUNCTIONS_STATE });
      this.host.requestUpdate();
    }
  }

  /** Refresh function list from registry */
  private _refresh() {
    if (!this._registry) {
      this._setState({ ...DEFAULT_FUNCTIONS_STATE });
      this.host.requestUpdate();
      return;
    }

    try {
      const functions = this._registry.listFunctions();
      const groups = this._registry.listGroups();
      this._setState({ functions, groups });
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
