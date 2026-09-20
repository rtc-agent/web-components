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
import type {PersistenceConfig, UIUpdateEvent} from '@rtc-agent/persistence';
import type {ConnectionState, ConnectionStateEvent} from '@rtc-agent/client';
import {createLogger} from '@rtc-agent/client';
import type {WorkerPersistenceCore, WorkerCallbacks} from '@rtc-agent/worker';
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

export class WorkerBridge {
    private _worker: SharedWorker | null = null;
    private _core: Remote<WorkerPersistenceCore> | null = null;
    private _callbacks: WorkerCallbacks;
    /** Comlink-proxied callbacks (for cross-Worker transfer). */
    private _proxiedCallbacks: WorkerCallbacks;
    private _initialized = false;

    /** Connection state listeners (main-thread side). */
    private _connectionListeners = new Set<(event: ConnectionStateEvent) => void>();

    private static readonly MAX_INIT_RETRIES = 3;
    private static readonly INIT_RETRY_DELAY_MS = 1000;
    /** Timeout for worker liveness verification (ping/pong). */
    private static readonly VERIFICATION_TIMEOUT_MS = 5000;

    constructor(private readonly _auth: AuthController) {
        // 1. Prepare callbacks (registered in the Worker during init()).
        this._callbacks = {
            // Worker broadcasts UIUpdateEvent -> main-thread UIUpdateBus.publish().
            onUIUpdate: (event: UIUpdateEvent) => {
                const bus = getUIUpdateBus();
                bus.publish(event);
            },
            // Worker requests token -> AuthController.getAccessToken().
            requestToken: async (): Promise<string> => {
                const token = this._auth.getAccessToken();
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
        } catch {
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
            // at runtime it is a plain function.
            this._worker = new (workerFactory as any)();
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
                    name: 'rtc-agent-worker',
                    type: 'module',
                });
            } finally {
                // Blob URL has been passed to SharedWorker — can be revoked immediately
                // (the worker already holds the script content).
                URL.revokeObjectURL(blobUrl);
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
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Worker verification timed out')), WorkerBridge.VERIFICATION_TIMEOUT_MS);
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
            throw new Error(
                `[WorkerBridge] Worker verification failed: ${err instanceof Error ? err.message : 'unknown error'}`
            );
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
     *
     * Idempotent: only the first call takes effect.
     * Must call initWorker() first.
     */
    async init(config: PersistenceConfig): Promise<void> {
        if (this._initialized) {
            log.warn('already initialized');
            return;
        }
        if (!this._worker || !this._core) {
            throw new Error('[WorkerBridge] init() called before initWorker()');
        }

        // Open the port (must be called before any communication).
        this._worker.port.start();

        // Initialize the Worker-side shared state.
        await this._core.init(config);

        // Register this tab's callbacks (using the proxy-wrapped version).
        await this._core.registerCallback(this._proxiedCallbacks);

        this._initialized = true;
    }

    /**
     * Destroy the bridge.
     *
     * 1. Unregister callbacks.
     * 2. Close the port.
     * 3. Terminate the Worker (note: SharedWorker only terminates after all ports are closed).
     */
    async destroy(): Promise<void> {
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
            metadataOverride?: any,
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

        virtualFS.queryByType = ((type: any) =>
            core.virtualFSQueryByType(type)) as typeof virtualFS.queryByType;

        virtualFS.exists = ((path: string) =>
            core.virtualFSExists(path)) as typeof virtualFS.exists;

        virtualFS.remove = ((path: string) =>
            core.virtualFSRemove(path)) as typeof virtualFS.remove;
    }
}
