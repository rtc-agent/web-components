/**
 * Functions Controller
 *
 * Manages the function registry state and provides it via Lit Context.
 *
 * Consumed by: <rtc-function-tree>, <rtc-functions-layout>
 * Provided by: <rtc-agent> (root)
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {FunctionRegistry} from '../core/function-registry.js';
import {DEFAULT_FUNCTIONS_STATE, type FunctionsState, type FunctionsActions, type FunctionsContextValue} from '../contexts/functions.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('FunctionsController');

export class FunctionsController implements ReactiveController {
    host: ReactiveControllerHost;

    private _registry: FunctionRegistry | null = null;
    private _state: FunctionsState = {...DEFAULT_FUNCTIONS_STATE};

    readonly actions: FunctionsActions;

    get value(): FunctionsContextValue {
        return {state: this._state, actions: this.actions};
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
            this._state = {...DEFAULT_FUNCTIONS_STATE};
            this.host.requestUpdate();
        }
    }

    /** Refresh function list from registry */
    private _refresh() {
        if (!this._registry) {
            this._state = {...DEFAULT_FUNCTIONS_STATE};
            this.host.requestUpdate();
            return;
        }

        try {
            const functions = this._registry.listFunctions();
            const groups = this._registry.listGroups();
            this._state = {functions, groups};
            log.debug('Refreshed function list:', functions.length, 'functions,', groups.length, 'groups');
            this.host.requestUpdate();
        } catch (err) {
            log.error('Failed to refresh function list:', err);
        }
    }
}
