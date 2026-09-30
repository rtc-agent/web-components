/**
 * WorkerBridge — Comlink bridge between the main thread and a SharedWorker.
 *
 * Responsibilities:
 * 1. Create a SharedWorker instance.
 * 2. Use Comlink.wrap() to obtain a WorkerPersistenceCore proxy.
 * 3. Register callback: Worker's UIUpdateEvent -> main-thread UIUpdateBus.publish().
 * 4. Register callback: Worker's token request -> AuthController.getAccessToken() (with dedup).
 * 5. Register callback: Worker's connection state change -> main-thread listeners.
 *
 * Design notes:
 * - The main thread retains the UIUpdateBus singleton (existing UI code continues to subscribe).
 * - When the Worker broadcasts events, WorkerBridge re-publishes them on the main-thread UIUpdateBus.
 * - Only one SharedWorker instance per page (multi-tab sharing managed by the browser).
 * - Token request dedup: concurrent requests share the same Promise.
 */
import {wrap, proxy, type Remote} from 'comlink';
import {getUIUpdateBus, virtualFS} from '@rtc-agent/persistence';
import type {PersistenceConfig, UIUpdateEvent, FileSystemMetadataOverride} from '@rtc-agent/persistence';
import type {ConnectionState, ConnectionStateEvent} from '@rtc-agent/client';
import {createLogger} from '@rtc-agent/client';
import type {WorkerPersistenceCore, WorkerCallbacks, UIUpdatePayload} from '@rtc-agent/worker';
import type {AuthController} from './controllers/auth.controller.js';

const log = createLogger('WorkerBridge');

// Worker script loading strategy
//
// Background: the component may be loaded from a CDN, in which case the component
// scripts are cross-origin relative to the host page.
// SharedWorker requires same-origin scripts (data: URLs get an opaque origin,
// blob: URLs inherit the creating page's origin).
//
// Vite's `?sharedworker` import compiles the worker and emits a **factory function**
// (not a URL string). The factory function internally uses
// `new URL("assets/shared-worker-<hash>.js", import.meta.url)` to reference the compiled
// worker chunk. Calling it at runtime would construct a cross-origin SharedWorker on the
// CDN, causing a SecurityError.
//
// Solution:
//   1. toString() the factory function and extract the embedded worker chunk relative path.
//   2. Resolve an absolute URL on the CDN via `new URL(relativePath, import.meta.url)`.
//   3. fetch() that URL (CDN must return CORS headers) to get the compiled worker script.
//   4. Create a blob: URL via Blob + URL.createObjectURL -> inherits page origin.
//   5. Construct SharedWorker with the blob: URL -> same-origin, can access IndexedDB.
import workerFactory from '../../worker/src/shared-worker.ts?sharedworker';

/**
 * Vite's ?sharedworker import type definition.
 *
 * Vite's type definition for ?sharedworker imports marks it as a constructor with options,
 * but at runtime it is a plain function that returns a SharedWorker instance.
 * The factory function accepts an optional WorkerOptions parameter (name, type).
 */
type WorkerFactoryFunction = (options?: WorkerOptions) => SharedWorker;

/**
 * Extract the worker chunk URL from a Vite-generated worker factory function source.
 *
 * Vite generates different factory function formats depending on the mode:
 *
 * - Dev mode (plain string):
 *     function WorkerWrapper(options) {
 *       return new SharedWorker("/@fs/.../shared-worker.ts?worker_file&type=module", ...)
 *     }
 *
 * - Production mode (new URL):
 *     function CM(t) {
 *       return new SharedWorker("" + new URL("assets/shared-worker-<hash>.js", import.meta.url).href, ...)
 *     }
 *
 * Tries the new URL(...) pattern first (production), then plain string (dev).
 */
function extractWorkerRelativePath(factory: Function): string {
    const src = factory.toString();

    // 1. Production mode: new URL("...", import.meta.url)
    const urlMatch = src.match(/new URL\(\s*(["'`])([^"'`]+)\1/);
    if (urlMatch) return urlMatch[2];

    // 2. Dev mode: new SharedWorker("literal-string", ...)
    const literalMatch = src.match(/new SharedWorker\(\s*(["'`])([^"'`]+)\1/);
    if (literalMatch) return literalMatch[2];

    throw new Error(
        '[WorkerBridge] Cannot extract worker URL from factory. Source: ' + src.slice(0, 300)
    );
}

export interface WorkerBridgeConfig {
    /**
     * Custom SharedWorker URL.
     *
     * When not provided, uses Vite's factory function to determine the worker URL.
     * This is useful when the component is loaded from NPM and the worker file
     * needs to be served from a different location (e.g., /rtc-agent/shared-worker.js).
     *
     * @example
     * ```ts
     * new WorkerBridge(authController, {
     *   workerUrl: '/rtc-agent/shared-worker.js'
     * });
     * ```
     */
    workerUrl?: string;
}

export class WorkerBridge {
    private _worker: SharedWorker | null = null;
    private _core: Remote<WorkerPersistenceCore> | null = null;
    private _callbacks: WorkerCallbacks;
    /** Comlink-proxied callbacks (for cross-Worker transfer). */
    private _proxiedCallbacks: WorkerCallbacks;
    private _initialized = false;
    /** Promise-based dedup guard: concurrent init() calls share the same initialization. */
    private _initPromise: Promise<void> | null = null;
    /** AbortController for cancelling ongoing catch-up */
    private _catchUpAbortController?: AbortController;
    private _config: WorkerBridgeConfig;

    /** Connection state listeners (main-thread side). */
    private _connectionListeners = new Set<(event: ConnectionStateEvent) => void>();

    /**
     * Whether sessionStorage cursor has been restored (only once per instance lifetime).
     * Prevents destroy(false) + init() from re-loading a stale sessionStorage cursor.
     */
    private _hasRestoredFromStorage = false;

    /**
     * Last processed UI update sequence number (for catch-up after page refresh).
     * Persisted in sessionStorage to survive page refreshes within the same tab.
     * Updated during both catch-up and real-time broadcasts to minimize redundant replays.
     */
    private _lastProcessedSeq: number;
    /** Database name for scoping sessionStorage key (prevents cross-instance collisions). */
    private _databaseName: string;
    private static readonly SESSION_STORAGE_KEY_PREFIX = 'rtc-ui-update-seq';

    private static readonly MAX_INIT_RETRIES = 3;
    private static readonly INIT_RETRY_DELAY_MS = 1000;
    /** Timeout for worker liveness verification (ping/pong). */
    private static readonly VERIFICATION_TIMEOUT_MS = 5000;

    /**
     * Generate a worker name for SharedWorker construction.
     *
     * In dev mode, appends a timestamp suffix to avoid connecting to stale workers
     * from previous sessions (e.g., after force-killing a tab during debugging).
     * SharedWorkers persist across tab closures, so a stale worker in a bad state
     * can cause verification timeouts on subsequent page loads.
     *
     * In production mode, uses a fixed name for predictable multi-tab sharing.
     */
    private static _getWorkerName(): string {
        const baseName = 'rtc-agent-worker';
        // Use import.meta.env.DEV for Vite dev mode detection
        if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
            return `${baseName}-dev-${Date.now()}`;
        }
        return baseName;
    }

    constructor(
        private readonly _auth: AuthController,
        config: WorkerBridgeConfig = {}
    ) {
        this._config = config;
        // databaseName is not available yet (set in init()). Use a placeholder key.
        // sessionStorage restore is deferred to init() when the actual databaseName is known.
        this._databaseName = 'default';
        this._lastProcessedSeq = 0;

        // 1. Prepare callbacks (registered in the Worker during init()).
        this._callbacks = {
            // Worker broadcasts UIUpdateEvent -> main-thread UIUpdateBus.publish().
            // Also updates _lastProcessedSeq so catch-up won't re-deliver this event.
            // skipPersist: true — Worker already persisted this event, avoid duplicate writes.
            // seqOverride: pass the original seq so listeners receive the correct persisted seq
            // (not 0, which would break the API contract).
            onUIUpdate: (payload: UIUpdatePayload) => {
                const bus = getUIUpdateBus();
                bus.publish(payload.event, { skipPersist: true, seqOverride: payload.seq });
                // Advance cursor on real-time delivery to minimize redundant catch-up replays.
                if (payload.seq > this._lastProcessedSeq) {
                    this._updateLastProcessedSeq(payload.seq);
                }
            },
            // Worker requests token -> AuthController.getAccessTokenAsync().
            requestToken: async (): Promise<string> => {
                const token = await this._auth.getAccessTokenAsync();
                if (!token) {
                    throw new Error('[WorkerBridge] no access token available');
                }
                return token;
            },
            // Worker requests token refresh -> AuthController.handleTokenExpired().
            // Returns 'refresh' if refreshed, 'relogin' if re-login is required.
            requestTokenRefresh: (): Promise<'refresh' | 'relogin'> => {
                return this._auth.handleTokenExpired();
            },
            // Worker broadcasts connection state change -> notify main-thread listeners.
            onConnectionStateChange: (event: ConnectionStateEvent) => {
                for (const listener of this._connectionListeners) {
                    try {
                        listener(event);
                    } catch (err) {
                        log.error('connection listener error:', err);
                    }
                }
            },
            // Worker broadcasts gap fill state -> main-thread UIUpdateBus.emitGapFillStart/End().
            onGapFillState: (isSyncing: boolean) => {
                log.debug('[BulkUpdate] WorkerBridge.onGapFillState called, isSyncing:', isSyncing);
                const bus = getUIUpdateBus();
                if (isSyncing) {
                    bus.emitGapFillStart();
                } else {
                    bus.emitGapFillEnd();
                }
            },
            // Catch-up detected a gap in events (TTL cleanup deleted missed events).
            // Reset cursor and trigger a full state refresh via gap fill mechanism.
            onStateGap: () => {
                log.warn('catchUp: state gap detected — events were lost (likely TTL cleanup)');
                this._lastProcessedSeq = 0;
                this._saveLastProcessedSeq();
                // 只调用 end 触发 reload，不调用 start（不显示遮罩）
                const bus = getUIUpdateBus();
                bus.emitGapFillEnd();
            },
        };

        // 2. Create Comlink-proxied callbacks (for cross-Worker transfer).
        // Structured Clone cannot handle functions; proxy() bridges via MessagePort.
        this._proxiedCallbacks = proxy(this._callbacks);

        // Note: SharedWorker instance, Comlink wrap, and error handling are created in
        // initWorker(), because the worker script must first be async-fetched to produce
        // a blob URL.
    }

    /**
     * Asynchronously create a SharedWorker instance.
     *
     * Flow:
     * 1. Extract the worker chunk's relative path from the Vite factory function.
     * 2. Resolve the absolute CDN URL and fetch the compiled worker script (requires CORS).
     * 3. Create a same-origin blob: URL via Blob + createObjectURL.
     * 4. Construct SharedWorker with the blob: URL -> inherits page origin.
     * 5. Verify the Worker started successfully (via ping test).
     *
     * Must be called before init().
     * Supports retry: on failure, automatically retries up to MAX_INIT_RETRIES times.
     */
    async initWorker(): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= WorkerBridge.MAX_INIT_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    log.warn(`Retrying worker initialization (attempt ${attempt + 1}/${WorkerBridge.MAX_INIT_RETRIES + 1})...`);
                    await this._delay(WorkerBridge.INIT_RETRY_DELAY_MS * attempt);
                }

                await this._initWorkerOnce();
                // Verify the Worker actually started.
                await this._verifyWorkerAlive();

                return;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                log.error(`Worker initialization attempt ${attempt + 1} failed:`, lastError.message);

                // Clean up the failed Worker instance.
                this._cleanupFailedWorker();
            }
        }

        // All retries exhausted.
        throw new Error(
            `[WorkerBridge] Failed to initialize SharedWorker after ${WorkerBridge.MAX_INIT_RETRIES + 1} attempts: ${lastError?.message}`
        );
    }

    /**
     * Single Worker initialization attempt.
     */
    private async _initWorkerOnce(): Promise<void> {
        const workerName = WorkerBridge._getWorkerName();

        // If custom workerUrl is provided, use it directly
        if (this._config.workerUrl) {
            log.info('Using custom workerUrl:', this._config.workerUrl);
            this._worker = new SharedWorker(this._config.workerUrl, {
                name: workerName,
                type: 'module',
            });
        } else {
            // 1. Extract worker chunk path (from Vite factory function source).
            const workerPath = extractWorkerRelativePath(workerFactory);

            // 2. Resolve the worker's absolute URL.
            const here = import.meta.url;
            const workerUrl = new URL(workerPath, here).href;

            // 3. Determine if cross-origin.
            const pageOrigin = window.location.origin;
            let workerOrigin: string;
            try {
                workerOrigin = new URL(workerUrl).origin;
            } catch (err) {
                // Malformed URL — assume same-origin as fallback
                log.debug('Failed to parse worker URL origin, assuming same-origin:', err);
                workerOrigin = pageOrigin;
            }
            const isCrossOrigin = workerOrigin !== pageOrigin;

            log.info('worker init:', {
                workerUrl,
                pageOrigin,
                workerOrigin,
                isCrossOrigin,
            });

            if (!isCrossOrigin) {
                // Same-origin: use the factory function directly (simplest, most reliable).
                // Used for local dev and same-origin deployments.
                // Vite's type definition is incorrect (marks ?sharedworker import as a constructor);
                // at runtime it is a plain function that returns a SharedWorker instance.
                // Call it without 'new' since it's a factory function, not a constructor.
                // Pass workerName to control the SharedWorker's name (important for dev mode
                // to avoid connecting to stale workers from previous sessions).
                this._worker = (workerFactory as unknown as WorkerFactoryFunction)({
                    name: workerName,
                    type: 'module',
                });
            } else {
                // Cross-origin (CDN deployment): fetch worker script -> create same-origin blob: URL
                // -> construct SharedWorker.
                // CDN must return CORS headers (Access-Control-Allow-Origin) or fetch will fail.
                let script: string;
                try {
                    const response = await fetch(workerUrl, {
                        cache: 'no-store', // Avoid using stale cached scripts.
                    });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status} ${response.statusText}`);
                    }
                    script = await response.text();
                } catch (err) {
                    throw new Error(
                        `[WorkerBridge] failed to fetch worker script from ${workerUrl}: ${err instanceof Error ? err.message : err}`
                    );
                }

                const blob = new Blob([script], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);

                try {
                    this._worker = new SharedWorker(blobUrl, {
                        name: workerName,
                        type: 'module',
                    });
                } finally {
                    // Blob URL has been passed to SharedWorker — can be revoked immediately
                    // (the worker already holds the script content).
                    URL.revokeObjectURL(blobUrl);
                }
            }
        }

        // 4. Comlink.wrap to obtain the proxy (needed for both paths).
        this._core = wrap<WorkerPersistenceCore>(this._worker!.port);

        // 5. Error handling.
        this._worker!.onerror = (event) => {
            log.error('SharedWorker error:', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error,
            });
        };

        this._worker!.port.onmessageerror = (event) => {
            log.error('port message error:', event);
        };
    }

    /**
     * Verify the Worker actually started and can respond.
     *
     * Calls a lightweight method (ping) to verify the Worker is alive.
     * ping() does not require init() and is suitable for startup verification.
     * If the Worker failed to start or crashed immediately, this call will time out or throw.
     */
    private async _verifyWorkerAlive(): Promise<void> {
        if (!this._core) {
            throw new Error('[WorkerBridge] No core available for verification');
        }

        // Timeout: if the Worker doesn't respond within 5 seconds, consider it failed.
        // The timer MUST be cleared in finally to prevent:
        // 1. Unhandled rejection when ping() wins the race (timer fires reject() on settled Promise)
        // 2. Useless timer occupying the event loop for 5s after successful verification
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                const staleWorkerHint = `Worker verification timed out after ${WorkerBridge.VERIFICATION_TIMEOUT_MS}ms. ` +
                    `This may indicate a stale SharedWorker from a previous browser session ` +
                    `(e.g., after force-killing a tab during debugging). ` +
                    `To resolve: visit chrome://inspect/#workers, find and terminate the stale ` +
                    `'rtc-agent-worker' instance, then reload the page.`;
                reject(new Error(staleWorkerHint));
            }, WorkerBridge.VERIFICATION_TIMEOUT_MS);
        });

        try {
            const result = await Promise.race([
                this._core.ping(),
                timeoutPromise,
            ]);
            if (result !== 'pong') {
                throw new Error(`Unexpected ping response: ${result}`);
            }
            log.info('Worker verification successful');
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'unknown error';
            throw new Error(
                `[WorkerBridge] Worker verification failed: ${errorMessage}`
            );
        } finally {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
        }
    }

    /**
     * Clean up a failed Worker instance.
     */
    private _cleanupFailedWorker(): void {
        if (this._worker) {
            try {
                this._worker.port.close();
            } catch {
                // Ignore close errors.
            }
            this._worker = null;
        }
        this._core = null;
    }

    /**
     * Delay for the specified number of milliseconds.
     */
    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get the Comlink-proxied WorkerPersistenceCore.
     *
     * All method calls are forwarded to the Worker via postMessage.
     * The returned object has the same interface as WorkerPersistenceCore.
     *
     * Must be accessed after initWorker().
     */
    get core(): Remote<WorkerPersistenceCore> {
        return this._core!;
    }

    /**
     * Initialize the bridge.
     *
     * 1. Call Worker's core.init() to initialize shared state.
     * 2. Register this tab's callbacks (onUIUpdate + requestToken + onConnectionStateChange).
     * 3. Open the port to start communication.
     * 4. Catch up on missed UI update events (persisted in Worker's IndexedDB).
     *    Callbacks are registered first so real-time events arriving during catch-up
     *    update _lastProcessedSeq, preventing both loss and duplication.
     *
     * Idempotent: only the first call takes effect.
     * Concurrent calls share the same initialization Promise (no double catch-up).
     * Must call initWorker() first.
     */
    async init(config: PersistenceConfig): Promise<void> {
        if (this._initialized) {
            log.warn('already initialized');
            return;
        }
        // Promise-based dedup: concurrent init() calls share the same initialization
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = this._doInit(config);
        try {
            await this._initPromise;
            this._initialized = true;
        } finally {
            this._initPromise = null;
        }
    }

    /**
     * Internal initialization logic.
     */
    private async _doInit(config: PersistenceConfig): Promise<void> {
        if (!this._worker || !this._core) {
            throw new Error('[WorkerBridge] init() called before initWorker()');
        }

        // Store databaseName for sessionStorage key scoping.
        // Detect databaseName change: if the name differs from the previous init(),
        // re-load the cursor from the new sessionStorage key to avoid using a stale cursor.
        const newDatabaseName = config.databaseName ?? 'default';
        const databaseNameChanged = newDatabaseName !== this._databaseName;
        this._databaseName = newDatabaseName;

        if (!this._hasRestoredFromStorage || databaseNameChanged) {
            this._lastProcessedSeq = this._loadLastProcessedSeq();
            this._hasRestoredFromStorage = true;
        }

        // Open the port (must be called before any communication).
        this._worker.port.start();

        // Initialize the Worker-side shared state.
        await this._core.init(config);

        // Register callback FIRST so real-time events update _lastProcessedSeq during catch-up.
        // Catch-up then queries seq > _lastProcessedSeq, automatically skipping events
        // that were already delivered in real-time — preventing both loss and duplication.
        await this._core.registerCallback(this._proxiedCallbacks);

        // Catch up on missed UI update events AFTER registering real-time callbacks.
        // Paginated: handles >1000 missed events. Detects gaps from TTL cleanup.
        await this._doCatchUp();
    }

    /**
     * Destroy the bridge.
     *
     * 1. Unregister callbacks.
     * 2. Close the port.
     * 3. Terminate the Worker (note: SharedWorker only terminates after all ports are closed).
     *
     * @param clearStorage - If true, clear sessionStorage cursor (use when tab is closing).
     *                       If false (default), keep cursor so component remount doesn't trigger
     *                       redundant catch-up. Only clear on actual tab close (beforeunload).
     */
    async destroy(clearStorage = false): Promise<void> {
        // Cancel ongoing catch-up
        this._catchUpAbortController?.abort();

        if (!this._initialized) {
            return;
        }
        if (!this._worker || !this._core) {
            return;
        }

        try {
            await this._core.unregisterCallback(this._proxiedCallbacks);
        } catch (err) {
            log.warn('unregisterCallback failed:', err);
        }

        this._connectionListeners.clear();
        this._worker.port.close();
        this._initialized = false;

        // Only clear cursor state when explicitly requested (e.g., tab close).
        // Component unmount/remount (clearStorage=false) should keep the cursor
        // to avoid redundant catch-up on next init().
        if (clearStorage) {
            this._lastProcessedSeq = 0;
            this._hasRestoredFromStorage = false;
            try {
                sessionStorage.removeItem(this._getSessionStorageKey());
            } catch {
                // sessionStorage may be unavailable
            }
        }
    }

    // ========== Connection State Monitoring ==========

    /**
     * Get the current connection state of RTCAgentClient in the Worker.
     *
     * Calls the Worker's getConnectionState() via Comlink.
     */
    async getConnectionState(): Promise<ConnectionState> {
        return this._core!.getConnectionState();
    }

    /**
     * Listen for connection state changes.
     *
     * Returns an unsubscribe function.
     */
    onConnectionStateChange(listener: (event: ConnectionStateEvent) => void): () => void {
        this._connectionListeners.add(listener);
        return () => {
            this._connectionListeners.delete(listener);
        };
    }

    // ========== virtualFS Proxy ==========

    /**
     * Replace the main-thread's virtualFS singleton methods with Comlink proxies.
     *
     * The main thread cannot directly access IndexedDB.
     * After replacement, all operations via virtualFS (tool execution, script reading,
     * function-registry doc writing, scenario-loader, etc.) are automatically routed
     * to the Worker.
     *
     * Note: virtualFS is a module-level singleton; the replacement is global.
     */
    installVirtualFSProxy(): void {
        const core = this._core!;

        // Save original implementation for potential restoration
        // (currently one-way; restoration is not needed yet).
        // const original = { ...virtualFS };

        virtualFS.read = ((path: string, offset?: number, limit?: number) =>
            core.virtualFSRead(path, offset, limit)) as typeof virtualFS.read;

        virtualFS.write = ((
            path: string,
            content: string,
            mode: 'overwrite' | 'append' = 'overwrite',
            metadataOverride?: FileSystemMetadataOverride,
        ) =>
            core.virtualFSWrite(path, content, mode, metadataOverride)) as typeof virtualFS.write;

        virtualFS.ls = ((path?: string) =>
            core.virtualFSLs(path)) as typeof virtualFS.ls;

        virtualFS.find = ((pattern: string, path?: string) =>
            core.virtualFSFind(pattern, path)) as typeof virtualFS.find;

        virtualFS.grep = ((
            pattern: string,
            path?: string,
            caseSensitive?: boolean,
            maxResults?: number,
        ) =>
            core.virtualFSGrep(pattern, path, caseSensitive, maxResults)) as typeof virtualFS.grep;

        virtualFS.queryByType = ((type: string) =>
            core.virtualFSQueryByType(type)) as typeof virtualFS.queryByType;

        virtualFS.exists = ((path: string) =>
            core.virtualFSExists(path)) as typeof virtualFS.exists;

        virtualFS.remove = ((path: string) =>
            core.virtualFSRemove(path)) as typeof virtualFS.remove;
    }

    // ========== UI Update Catch-Up ==========

    /**
     * Catch up on missed UI update events from the Worker's persistent queue.
     *
     * Called AFTER registerCallback(), so real-time events arriving during catch-up
     * will update _lastProcessedSeq via the onUIUpdate callback. The catch-up query
     * uses `seq > _lastProcessedSeq`, so it automatically skips events already
     * delivered in real-time — preventing both loss and duplication.
     *
     * Paginated: handles >1000 missed events by looping until hasMore is false.
     * Idempotent: skips entries with seq <= _lastProcessedSeq (guards against
     * events delivered in real-time between the query and the loop iteration).
     * Gap-aware: if hasGap is true, stops and signals onStateGap for full refresh.
     */
    private async _doCatchUp(): Promise<void> {
        if (!this._core) return;

        this._catchUpAbortController = new AbortController();
        const signal = this._catchUpAbortController.signal;

        try {
            let fromSeq = this._lastProcessedSeq;
            let totalDelivered = 0;
            let hasMore = true;

            while (hasMore && !signal.aborted) {
                const result = await this._core.getCatchUpEvents(fromSeq);

                if (signal.aborted) break;

                // Gap detection: events were deleted before we could catch up
                if (result.hasGap) {
                    log.warn('catchUp: gap detected, triggering state refresh');
                    this._callbacks.onStateGap();
                    return;
                }

                if (result.entries.length === 0) {
                    if (totalDelivered === 0) {
                        log.debug('catchUp: no missed events');
                    }
                    return;
                }

                log.debug(`catchUp: replaying ${result.entries.length} events from seq ${fromSeq}`);

                // Time-slicing: yield to the main thread when a time budget is exhausted.
                // This adapts to actual event processing cost (fast events → fewer yields,
                // slow events → more yields) and works consistently across browsers
                // (no dependency on requestIdleCallback which Safari lacks).
                const FRAME_BUDGET_MS = 8; // ~half a 16ms frame, leaves headroom for rendering
                let sliceStart = performance.now();

                for (let i = 0; i < result.entries.length && !signal.aborted; i++) {
                    const entry = result.entries[i];
                    const entrySeq = entry.seq;

                    // Idempotency guard: skip events already delivered in real-time
                    // (real-time callback updated _lastProcessedSeq between query and now)
                    if (entrySeq <= this._lastProcessedSeq) {
                        continue;
                    }

                    // Runtime type validation: ensure event structure is valid before processing
                    // (guards against corrupted IndexedDB data or schema changes)
                    if (!this._isValidUIUpdateEvent(entry.event)) {
                        log.warn('catchUp: skipping entry with invalid event structure');
                        continue;
                    }

                    try {
                        this._callbacks.onUIUpdate({
                            event: entry.event as UIUpdateEvent,
                            seq: entrySeq,
                        });
                        // onUIUpdate callback already calls _updateLastProcessedSeq and persists to sessionStorage
                        totalDelivered++;
                    } catch (err) {
                        log.error('catchUp: failed to deliver event, stopping:', err);
                        return; // Stop at first failure, next catchUp will retry
                    }

                    // Yield to main thread when time budget is exhausted
                    if (performance.now() - sliceStart > FRAME_BUDGET_MS) {
                        await this._yieldToMain();
                        sliceStart = performance.now();
                    }
                }

                // Advance cursor for next page
                fromSeq = result.entries[result.entries.length - 1].seq;

                // Check if there are more pages
                hasMore = result.hasMore;
            }

            if (signal.aborted) {
                log.debug('catchUp: cancelled');
                return;
            }

            if (totalDelivered > 0) {
                log.debug(`catchUp: delivered ${totalDelivered} total events`);
            }
        } catch (err) {
            if (!signal.aborted) {
                log.error('catchUp: failed to query events (non-fatal):', err);
            }
        } finally {
            this._catchUpAbortController = undefined;
        }
    }

    /**
     * Yield control to the main thread to allow UI rendering and user interaction.
     *
     * Uses MessageChannel to schedule a macrotask without setTimeout's 4ms minimum
     * delay floor (imposed by HTML spec for deeply-nested setTimeout calls).
     * MessageChannel.postMessage() enqueues a 'message' event as a macrotask,
     * which fires on the next event-loop turn with ~0ms latency.
     *
     * Combined with time-slicing in _doCatchUp, this prevents UI jank regardless
     * of browser (works on Safari which lacks requestIdleCallback).
     */
    private _yieldToMain(): Promise<void> {
        return new Promise(resolve => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                resolve();
            };
            channel.port2.postMessage(null);
        });
    }

    /**
     * Runtime type validation for UIUpdateEvent.
     *
     * Ensures the event structure is valid before processing (guards against
     * corrupted IndexedDB data or schema mismatches after upgrades).
     */
    private _isValidUIUpdateEvent(event: unknown): event is UIUpdateEvent {
        if (!event || typeof event !== 'object') return false;
        const e = event as Record<string, unknown>;
        return typeof e.entity === 'string' &&
               typeof e.action === 'string' &&
               typeof e.entityId === 'string';
    }

    /**
     * Update the last processed seq and persist to sessionStorage.
     */
    private _updateLastProcessedSeq(seq: number): void {
        this._lastProcessedSeq = seq;
        this._saveLastProcessedSeq();
    }

    /**
     * Get the sessionStorage key for this instance (scoped by databaseName).
     */
    private _getSessionStorageKey(): string {
        return `${WorkerBridge.SESSION_STORAGE_KEY_PREFIX}-${this._databaseName}`;
    }

    /**
     * Load last processed seq from sessionStorage.
     */
    private _loadLastProcessedSeq(): number {
        try {
            const stored = sessionStorage.getItem(this._getSessionStorageKey());
            if (stored !== null) {
                const seq = parseInt(stored, 10);
                if (!isNaN(seq) && seq >= 0) {
                    return seq;
                }
            }
        } catch {
            // sessionStorage may be unavailable (private browsing, etc.)
        }
        return 0;
    }

    /**
     * Save last processed seq to sessionStorage.
     */
    private _saveLastProcessedSeq(): void {
        try {
            sessionStorage.setItem(this._getSessionStorageKey(), String(this._lastProcessedSeq));
        } catch {
            // sessionStorage may be unavailable or full
            log.debug('Failed to save lastProcessedSeq to sessionStorage (non-fatal)');
        }
    }
}
