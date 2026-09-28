/**
 * Function Debug Controller
 *
 * Manages the function debugger state: selected function, params, logs, history.
 * Handles function execution with log capture and history persistence via IndexedDB.
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
    HistoryPaginationState,
} from '../types/functions-debug.js';
import type {WorkerBridge} from '../worker-bridge.js';
import {getExampleValue} from '../core/markdown-generator.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('FunctionDebugController');

/** Default page size for history pagination */
const PAGE_SIZE = 20;

export class FunctionDebugController implements ReactiveController {
    host: ReactiveControllerHost;

    private _registry: FunctionRegistry | null = null;
    private _workerBridge: WorkerBridge | null = null;
    private _state: FunctionDebugState = {...DEFAULT_FUNCTION_DEBUG_STATE};
    /** Cursor cache for efficient pagination: page -> cursor */
    private _cursorCache = new Map<number, string | undefined>();

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
            loadHistoryPage: (page: number) => this._loadHistoryPage(page),
            setHistoryFilter: (functionName?: string) => this._setHistoryFilter(functionName),
        };
    }

    hostConnected() {
        // History loading is triggered by workerBridge setter, not here
    }

    hostDisconnected() {}

    /**
     * Set the function registry
     *
     * Called by <rtc-agent> when the registry is available.
     */
    setRegistry(registry: FunctionRegistry | null) {
        this._registry = registry;
    }

    /**
     * Set the worker bridge for IndexedDB access
     *
     * Called by <rtc-agent> when the worker bridge is available.
     * Automatically loads the first page of history when bridge becomes available.
     */
    set workerBridge(bridge: WorkerBridge | null) {
        this._workerBridge = bridge;
        if (bridge) {
            // Clear cursor cache when bridge changes
            this._cursorCache.clear();
            // Load first page of history
            void this._loadHistoryPage(1);
        }
    }

    get workerBridge(): WorkerBridge | null {
        return this._workerBridge;
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

        // Auto-set filter to the selected function's name
        void this._setHistoryFilter(fn.name);
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
            await this._addToHistory({
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
            await this._addToHistory({
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

    private async _clearHistory() {
        if (!this._workerBridge) return;

        // Batch delete current page items by ID
        const ids = this._state.historyPagination.items.map(item => item.id);
        if (ids.length > 0) {
            await this._workerBridge.core.batchDeleteDebugHistory(ids);
        }

        this._cursorCache.clear();
        this._state = {
            ...this._state,
            history: [],
            historyPagination: {
                items: [],
                page: 1,
                totalPages: 0,
                total: 0,
                filterFunctionName: this._state.historyPagination.filterFunctionName,
            },
        };
        this.host.requestUpdate();

        // Reload to reflect updated totals
        await this._loadHistoryPage(1);
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

    /* ── History persistence via IndexedDB ── */

    private async _addToHistory(item: Omit<DebugHistoryItem, 'id' | 'timestamp'>) {
        if (!this._workerBridge) return;

        const historyItem: DebugHistoryItem = {
            ...item,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
        };

        await this._workerBridge.core.addDebugHistoryItem(historyItem);

        // Reload first page to show the new item
        await this._loadHistoryPage(1);
    }

    private async _loadHistoryPage(page: number) {
        if (!this._workerBridge) return;

        const {filterFunctionName} = this._state.historyPagination;

        try {
            // Get total count
            const total = await this._workerBridge.core.countDebugHistory(filterFunctionName);
            const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

            // Clamp page to valid range
            const validPage = Math.max(1, Math.min(page, totalPages));

            // Use cursor cache for efficient pagination
            // For page 1, no cursor needed
            // For page N, we need the cursor from page N-1
            let cursor: string | undefined;
            if (validPage > 1) {
                // Check if we have the cursor for the previous page cached
                const prevPageCursor = this._cursorCache.get(validPage - 1);
                if (prevPageCursor !== undefined) {
                    cursor = prevPageCursor;
                } else {
                    // Cursor not cached, need to fetch it
                    // This happens when jumping directly to a page without navigating through previous pages
                    const skipCount = (validPage - 1) * PAGE_SIZE;
                    const skipResult = await this._workerBridge.core.queryDebugHistory(
                        filterFunctionName,
                        undefined,
                        skipCount
                    );
                    cursor = skipResult.nextCursor;
                }
            }

            // Fetch the target page
            const result = await this._workerBridge.core.queryDebugHistory(
                filterFunctionName,
                cursor,
                PAGE_SIZE
            );

            // Cache the cursor for the current page (used for next page navigation)
            this._cursorCache.set(validPage, result.nextCursor);

            // If filter changed, clear stale cache entries
            if (filterFunctionName !== this._state.historyPagination.filterFunctionName) {
                this._cursorCache.clear();
            }

            const pagination: HistoryPaginationState = {
                items: result.items,
                page: validPage,
                totalPages,
                total,
                filterFunctionName,
                error: undefined, // Clear any previous error
            };

            this._state = {
                ...this._state,
                history: result.items,
                historyPagination: pagination,
            };
            this.host.requestUpdate();
        } catch (err) {
            log.error('Failed to load history page:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            this._state = {
                ...this._state,
                historyPagination: {
                    ...this._state.historyPagination,
                    error: errorMessage,
                },
            };
            this.host.requestUpdate();
        }
    }

    private async _setHistoryFilter(functionName?: string) {
        this._state = {
            ...this._state,
            historyPagination: {
                ...this._state.historyPagination,
                filterFunctionName: functionName,
            },
        };
        // Reset to first page with new filter
        await this._loadHistoryPage(1);
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
