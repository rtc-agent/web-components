/**
 * Function Debug Controller
 *
 * Manages the function debugger state: selected function, params, logs, history.
 * Handles function execution with log capture and history persistence.
 *
 * Consumed by: <rtc-function-tree>, <rtc-function-debugger>, <rtc-function-params>,
 *              <rtc-function-console>, <rtc-function-history>
 * Provided by: <rtc-agent> (root)
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {FunctionRegistry} from '../core/function-registry.js';
import type {FunctionDef} from '../types/skill.js';
import {
    DEFAULT_FUNCTION_DEBUG_STATE,
    type FunctionDebugActions,
    type FunctionDebugContextValue,
} from '../contexts/function-debug.js';
import type {
    FunctionDebugState,
    LogEntry,
    DebugHistoryItem,
    LogLevel,
} from '../types/functions-debug.js';
import {STORAGE_KEYS} from '../config/auth.js';
import {getExampleValue} from '../core/markdown-generator.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('FunctionDebugController');

/** Maximum number of history items to retain */
const MAX_HISTORY_ITEMS = 100;

export class FunctionDebugController implements ReactiveController {
    host: ReactiveControllerHost;

    private _registry: FunctionRegistry | null = null;
    private _state: FunctionDebugState = {...DEFAULT_FUNCTION_DEBUG_STATE};

    readonly actions: FunctionDebugActions;

    get value(): FunctionDebugContextValue {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            selectFunction: (fn: FunctionDef) => this._selectFunction(fn),
            updateParams: (params: string) => this._updateParams(params),
            execute: () => this._execute(),
            executeFromHistory: (item: DebugHistoryItem) => this._executeFromHistory(item),
            loadFromHistory: (item: DebugHistoryItem) => this._loadFromHistory(item),
            clearLogs: () => this._clearLogs(),
            clearHistory: () => this._clearHistory(),
        };

        // Restore history from localStorage
        this._state = {
            ...this._state,
            history: this._restoreHistory(),
        };
    }

    hostConnected() {}
    hostDisconnected() {}

    /**
     * Set the function registry
     *
     * Called by <rtc-agent> when the registry is available.
     */
    setRegistry(registry: FunctionRegistry | null) {
        this._registry = registry;
    }

    /* ── Actions ── */

    private _selectFunction(fn: FunctionDef) {
        // Generate default params from function definition
        const defaultParams = this._generateDefaultParams(fn);

        this._state = {
            ...this._state,
            selectedFunction: fn,
            currentParams: JSON.stringify(defaultParams, null, 2),
            logs: [],
            executionStatus: 'idle',
        };
        this.host.requestUpdate();
    }

    private _updateParams(params: string) {
        this._state = {...this._state, currentParams: params};
        this.host.requestUpdate();
    }

    /**
     * Execute the currently selected function
     *
     * @param clearLogs - Whether to clear logs before execution (default: true)
     */
    private async _execute(clearLogs = true) {
        const fn = this._state.selectedFunction;
        if (!fn) {
            log.warn('No function selected');
            return;
        }
        if (!this._registry) {
            log.warn('No registry available');
            return;
        }

        // Parse params
        let params: Record<string, unknown>;
        try {
            params = JSON.parse(this._state.currentParams || '{}');
        } catch {
            this._addLog('error', '参数 JSON 解析失败，请检查格式');
            return;
        }

        // Clear logs if requested
        if (clearLogs) {
            this._state = {...this._state, logs: []};
        }

        // Set running status
        this._state = {...this._state, executionStatus: 'running'};
        this.host.requestUpdate();

        const startTime = performance.now();
        this._addLog('info', `开始执行 ${fn.name}`);

        try {
            const result = await this._registry.execute(fn.name, params);
            const durationMs = Math.round(performance.now() - startTime);

            this._addLog('info', `执行成功 (${durationMs}ms)`, result);

            this._state = {
                ...this._state,
                executionStatus: 'success',
            };
            this.host.requestUpdate();

            // Record to history
            this._addToHistory({
                functionName: fn.name,
                params: this._state.currentParams,
                success: true,
                durationMs,
                logs: [...this._state.logs],
                result,
            });
        } catch (err) {
            const durationMs = Math.round(performance.now() - startTime);
            const errorMessage = err instanceof Error ? err.message : String(err);

            this._addLog('error', `执行失败 (${durationMs}ms): ${errorMessage}`);

            this._state = {
                ...this._state,
                executionStatus: 'error',
            };
            this.host.requestUpdate();

            // Record to history
            this._addToHistory({
                functionName: fn.name,
                params: this._state.currentParams,
                success: false,
                durationMs,
                logs: [...this._state.logs],
                errorMessage,
            });
        }
    }

    /** Execute from a history item: restore params and re-run (append logs, don't clear) */
    private async _executeFromHistory(item: DebugHistoryItem) {
        const fn = this._state.selectedFunction;
        if (!fn || fn.name !== item.functionName) {
            // Need to select the function first
            const registryFn = this._registry?.resolve(item.functionName);
            if (registryFn) {
                this._selectFunction(registryFn);
            } else {
                log.warn('Function not found in registry:', item.functionName);
                return;
            }
        }

        // Restore params from history item
        this._state = {...this._state, currentParams: item.params};
        this.host.requestUpdate();

        // Execute without clearing logs (append mode)
        await this._execute(false);
    }

    /** Load a history item's params and logs to the current view (without executing) */
    private _loadFromHistory(item: DebugHistoryItem) {
        const fn = this._registry?.resolve(item.functionName);
        if (!fn) {
            log.warn('Function not found in registry:', item.functionName);
            return;
        }

        this._state = {
            ...this._state,
            selectedFunction: fn,
            currentParams: item.params,
            logs: [...item.logs],
            executionStatus: item.success ? 'success' : 'error',
        };
        this.host.requestUpdate();
    }

    private _clearLogs() {
        this._state = {...this._state, logs: []};
        this.host.requestUpdate();
    }

    private _clearHistory() {
        this._state = {...this._state, history: []};
        this._persistHistory();
        this.host.requestUpdate();
    }

    /* ── Log helpers ── */

    private _addLog(level: LogLevel, message: string, data?: unknown) {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            message,
            ...(data !== undefined ? {data} : {}),
        };
        this._state = {
            ...this._state,
            logs: [...this._state.logs, entry],
        };
        this.host.requestUpdate();
    }

    /* ── History persistence ── */

    private _addToHistory(item: Omit<DebugHistoryItem, 'id' | 'timestamp'>) {
        const historyItem: DebugHistoryItem = {
            ...item,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
        };

        // Prepend (most recent first) and cap at MAX_HISTORY_ITEMS
        const history = [historyItem, ...this._state.history].slice(0, MAX_HISTORY_ITEMS);

        this._state = {...this._state, history};
        this._persistHistory();
        this.host.requestUpdate();
    }

    private _persistHistory() {
        try {
            localStorage.setItem(
                STORAGE_KEYS.functionDebugHistory,
                JSON.stringify(this._state.history)
            );
        } catch (err) {
            log.debug('Failed to persist debug history:', err);
        }
    }

    private _restoreHistory(): DebugHistoryItem[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.functionDebugHistory);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
        } catch (err) {
            log.debug('Failed to restore debug history:', err);
        }
        return [];
    }

    /* ── Default params generation ── */

    /**
     * Generate default parameter values from function definition
     *
     * Reuses `getExampleValue` from markdown-generator to produce
     * meaningful defaults from OpenAPI schema (example > default > type-based).
     */
    private _generateDefaultParams(fn: FunctionDef): Record<string, unknown> {
        const defaults: Record<string, unknown> = {};

        if (!fn.parameters) return defaults;

        for (const param of fn.parameters) {
            if (!param.schema) {
                defaults[param.name] = null;
                continue;
            }
            try {
                defaults[param.name] = JSON.parse(getExampleValue(param.schema));
            } catch {
                defaults[param.name] = getExampleValue(param.schema);
            }
        }

        return defaults;
    }
}
