/**
 * Persistence Controller
 *
 * Manages the PersistenceLayer lifecycle: creates it lazily, connects when
 * auth succeeds, disconnects on logout or host teardown.
 *
 * Uses SharedWorker + Comlink architecture:
 * - SharedWorker hosts PersistenceLayer, Centrifuge WebSocket, IndexedDB
 * - Comlink bridge exposes a PersistenceLayer-compatible adapter (WorkerPersistenceAdapter)
 * - MasterLock: Master Tab election via Web Locks API
 *
 * Corresponds to: no context (infrastructure concern, not UI state).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: other controllers (via `persistence.layer`)
 */
import type {ReactiveController} from 'lit';
import type {Remote} from 'comlink';
import {
    type PersistenceLayer,
    type PersistenceConfig,
    type LocalSession,
    type LocalMessage,
    type LocalRtc,
    type AgentMdConfig,
} from '@rtc-agent/persistence';
import type {ContentData} from '@rtc-agent/protocol';
import type {ConnectionState, ConnectionStateEvent} from '@rtc-agent/client';
import {createLogger} from '@rtc-agent/client';
import type {WorkerPersistenceCore} from '@rtc-agent/worker';
import type {AuthController} from './auth.controller.js';
import {AUTH_CONFIG} from '../config/auth.js';

const log = createLogger('PersistenceController');
import {getOrCreateDeviceId} from '../utils/device.js';
import {WorkerBridge} from '../worker-bridge.js';
import {MasterLock} from '../master-lock.js';
import {FileStorage} from '../utils/file-storage.js';

/**
 * Assert WorkerPersistenceAdapter as PersistenceLayer.
 *
 * WorkerPersistenceAdapter structurally matches PersistenceLayer, but the following methods differ in semantics:
 * - getClient(): throws (use PersistenceController.onConnectionStateChange instead)
 * - getEntityRepository(): throws (no current callers)
 * - getOffsetManager(): returns a shim with only reset()
 *
 * When modifying the PersistenceLayer public API, WorkerPersistenceAdapter must be updated accordingly.
 * Centralized in this function to avoid scattered `as unknown as` casts causing cognitive burden.
 */
function _asPersistenceLayer(adapter: WorkerPersistenceAdapter): PersistenceLayer {
    return adapter as unknown as PersistenceLayer;
}

/**
 * Worker adapter for PersistenceLayer
 *
 * Implements the PersistenceLayer public interface, internally proxying calls to SharedWorker via Comlink.
 *
 * Note: getClient() / getOffsetManager() / getEntityRepository() cannot work directly
 * (these objects live inside the Worker) and will throw when called.
 * Connection state is handled via the unified PersistenceController.onConnectionStateChange interface.
 */
class WorkerPersistenceAdapter {
    private _core: Remote<WorkerPersistenceCore>;

    constructor(core: Remote<WorkerPersistenceCore>) {
        this._core = core;
    }

    // ========== Connection ==========

    async connect(): Promise<void> {
        log.info('connect() called');
        await this._core.connect();
        log.info('connect() completed, worker state:', await this._core.getConnectionState());
    }

    disconnect(): void {
        this._core.disconnect();
    }

    async reconnect(): Promise<void> {
        await this._core.reconnect();
    }

    // ========== Query ==========

    async listSessions(cursor?: string, limit?: number): Promise<LocalSession[]> {
        return this._core.listSessions(cursor, limit);
    }

    async getSession(clientId: string): Promise<LocalSession | undefined> {
        return this._core.getSession(clientId);
    }

    async listMessages(
        sessionClientId: string,
        cursor?: string,
        limit?: number,
        direction?: 'backward' | 'forward',
    ): Promise<LocalMessage[]> {
        return this._core.listMessages(sessionClientId, cursor, limit, direction);
    }

    async getMessage(clientId: string): Promise<LocalMessage | undefined> {
        return this._core.getMessage(clientId);
    }

    async listRtc(
        sessionClientId: string,
        cursor?: number,
        limit?: number,
    ): Promise<LocalRtc[]> {
        return this._core.listRtc(sessionClientId, cursor, limit);
    }

    async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
        return this._core.getNextRtcToProcess(sessionClientId);
    }

    // ========== Operations ==========

    async sendMessage(params: {
        content: ContentData;
        messageClientId: string;
        sessionClientId: string;
    }): Promise<{ session: LocalSession; message: LocalMessage }> {
        return this._core.sendMessage(params);
    }

    async insertLocalMessage(params: {
        sessionClientId: string;
        role: 'user' | 'assistant' | 'tool' | 'system';
        content: string;
        creatorKind?: string;
        creatorRefId?: string;
    }): Promise<LocalMessage> {
        return this._core.insertLocalMessage(params);
    }

    async stopTurn(sessionClientId: string): Promise<void> {
        return this._core.stopTurn(sessionClientId);
    }

    async closeSession(sessionClientId: string): Promise<void> {
        return this._core.closeSession(sessionClientId);
    }

    async openSession(sessionClientId: string): Promise<void> {
        return this._core.openSession(sessionClientId);
    }

    async compactSession(sessionClientId: string, customInstruction?: string): Promise<void> {
        return this._core.compactSession(sessionClientId, customInstruction);
    }

    async submitRtcResult(params: {
        rtcClientId: string;
        success: boolean;
        result?: unknown;
        error?: string;
    }): Promise<void> {
        return this._core.submitRtcResult(params);
    }

    async forkSession(params: {
        oldSessionClientId: string;
        oldMessageClientId: string;
        newSessionClientId: string;
        newMessageClientId: string;
        content: ContentData;
        limit?: number;
    }): Promise<{ session: LocalSession; message: LocalMessage }> {
        return this._core.forkSession(params);
    }

    async deleteSession(sessionClientId: string): Promise<void> {
        return this._core.deleteSession(sessionClientId);
    }

    async updateSessionTitle(sessionClientId: string, title: string): Promise<void> {
        return this._core.updateSessionTitle(sessionClientId, title);
    }

    // ========== Lifecycle ==========

    async close(): Promise<void> {
        await this._core.close();
    }

    async flushAll(): Promise<void> {
        return this._core.flushAll();
    }

    /**
     * Initialize the virtual file system.
     *
     * virtualFS shares a single IndexedDB inside the Worker and is accessed via Comlink pass-through calls.
     */
    async initializeVirtualFS(config?: AgentMdConfig): Promise<void> {
        await this._core.initializeVirtualFS(config ?? {});
    }

    // ========== Restricted methods ==========

    /**
     * @throws Direct RTCAgentClient access is not supported; use PersistenceController.onConnectionStateChange instead
     */
    getClient(): never {
        throw new Error(
            '[WorkerPersistenceAdapter] getClient() is not available. ' +
            'Use PersistenceController.onConnectionStateChange() instead.',
        );
    }

    /**
     * Returns a shim object that only supports the reset() operation.
     *
     * reset() is passed through via Comlink to getOffsetManager().reset() inside the Worker.
     */
    getOffsetManager(): { reset: () => Promise<void> } {
        return {
            reset: () => this._core.resetOffset(),
        };
    }

    /**
     * @throws Direct EntityRepository access is not supported
     */
    getEntityRepository(): never {
        throw new Error(
            '[WorkerPersistenceAdapter] getEntityRepository() is not available.',
        );
    }
}

export class PersistenceController implements ReactiveController {
    private _layer?: PersistenceLayer;
    private _auth: AuthController;
    private _workerBridge?: WorkerBridge;
    private _masterLock?: MasterLock;
    private _databaseNameOverride?: string;
    private _workerURL?: string;
    private _fileStorage?: FileStorage;

    /**
     * In-flight connection promise — prevents concurrent `connect()` calls from
     * racing to create multiple SharedWorker / Centrifuge connections.
     *
     * Cleared on success (layer is set) or failure (so a retry can proceed).
     */
    private _connecting?: Promise<void>;

    /**
     * Connection generation counter for race-condition prevention.
     *
     * When disconnect() clears `_connecting` while the underlying Promise is still
     * in-flight, a subsequent connect() can set a new `_connecting`. When the OLD
     * Promise finally resolves, its `finally` block would wrongly clear the NEW
     * `_connecting`, leaving the new connection attempt invisible to the concurrency
     * guard — leading to duplicate connection attempts and inconsistent state.
     *
     * Fix: each connection attempt captures the current generation; in `finally`,
     * we only clear `_connecting` if the generation still matches. Any code path
     * that invalidates an in-flight connection (disconnect) bumps the generation
     * instead of just clearing `_connecting`, so stale Promises self-inhibit.
     */
    private _connectGeneration = 0;

    private static readonly MAX_CONNECT_RETRIES = 2;
    private static readonly CONNECT_RETRY_DELAY_MS = 2000;

    constructor(
        host: {addController(c: ReactiveController): void},
        auth: AuthController,
    ) {
        this._auth = auth;
        host.addController(this);
    }

    /** Set custom database name prefix. Must be called before connect(). */
    set databaseName(value: string | undefined) {
        this._databaseNameOverride = value;
    }

    /**
     * Set custom SharedWorker URL.
     *
     * When the component is loaded from NPM, the worker file may not be accessible
     * from the default location. Use this to specify a custom URL where the worker
     * file is served (e.g., '/rtc-agent/shared-worker.js').
     *
     * Must be called before connect().
     */
    set workerURL(value: string | undefined) {
        this._workerURL = value;
    }

    /** The PersistenceLayer instance. Only available after connect(). */
    get layer(): PersistenceLayer | undefined {
        return this._layer;
    }

    /** Whether the persistence layer is connected. */
    get isConnected(): boolean {
        return this._layer !== undefined;
    }

    /**
     * Get the WorkerBridge instance.
     */
    get workerBridge(): WorkerBridge | undefined {
        return this._workerBridge;
    }

    /**
     * Get the MasterLock instance.
     *
     * MasterLock wraps the Web Locks API for Master Tab election.
     * Each Tab holds its own MasterLock and determines whether it is the Master.
     * Only the Master Tab's RtcProcessor will execute RTC tool calls.
     *
     * @see docs/shared-worker-proposal.md §4.3
     */
    get masterLock(): MasterLock | undefined {
        return this._masterLock;
    }

    /**
     * Get the FileStorage instance for high-level file operations.
     *
     * FileStorage provides intelligent file upload/download with automatic MD5 calculation,
     * caching, and progress tracking. Requires an active connection (after connect()).
     *
     * @throws Error if not connected or userId is not available
     */
    get fileStorage(): FileStorage {
        if (!this._fileStorage) {
            if (!this._workerBridge) {
                throw new Error(
                    '[PersistenceController] fileStorage requires an active connection. Call connect() first.'
                );
            }
            const userId = this._auth.state.userId;
            if (!userId) {
                throw new Error(
                    '[PersistenceController] fileStorage requires userId from auth state.'
                );
            }
            this._fileStorage = new FileStorage(this._workerBridge, userId);
        }
        return this._fileStorage;
    }

    hostConnected() {
        // No-op: connection is driven by auth state, not host lifecycle.
    }

    hostDisconnected() {
        this.disconnect();
    }

    /**
     * Create the PersistenceLayer and connect.
     *
     * Creates SharedWorker + Comlink bridge.
     * The WorkerPersistenceAdapter wraps the Comlink proxy, presenting a
     * PersistenceLayer-compatible interface to the rest of the application.
     *
     * Call this after auth succeeds (tokens are set in AuthController).
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    async connect(): Promise<void> {
        if (this._layer) {
            return;
        }
        if (this._connecting) {
            return this._connecting;
        }

        const deviceId = getOrCreateDeviceId();
        const userId = this._auth.state.userId;

        if (!userId) {
            throw new Error('[PersistenceController] connect() called without userId; refusing to open a shared database');
        }

        const config = {
            databaseName: this._databaseNameOverride
                ? `${this._databaseNameOverride}-${userId}`
                : `rtc-agent-${userId}`,
            deviceId,
            userId,
            serverURL: AUTH_CONFIG.serverURL,
            client: {
                endpoint: AUTH_CONFIG.wsEndpoint,
                getToken: async () => {
                    const token = await this._auth.getAccessTokenAsync();
                    if (!token) {
                        log.warn('getToken: no access token available');
                        throw new Error('No access token available');
                    }
                    return token;
                },
                onTokenExpired: () => this._auth.handleTokenExpired(),
                deviceId,
                userId,
            },
        };

        // Capture the current generation so we can detect stale resolution
        const gen = this._connectGeneration;

        this._connecting = this._connectWorker(config).finally(() => {
            // Only clear _connecting if no newer attempt has superseded us
            if (this._connectGeneration === gen) {
                this._connecting = undefined;
            }
        });
        return this._connecting;
    }

    /**
     * Create SharedWorker + Comlink bridge.
     *
     * The WorkerPersistenceAdapter wraps the Comlink proxy, presenting a
     * PersistenceLayer-compatible interface to the rest of the application.
     *
     * Supports retries: if Worker initialization or connection fails, it will automatically retry.
     */
    private async _connectWorker(config: PersistenceConfig): Promise<void> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= PersistenceController.MAX_CONNECT_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    log.warn(`Retrying connection (attempt ${attempt + 1}/${PersistenceController.MAX_CONNECT_RETRIES + 1})...`);
                    await this._delay(PersistenceController.CONNECT_RETRY_DELAY_MS * attempt);
                }

                await this._connectWorkerOnce(config);
                return;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                log.error(`Connection attempt ${attempt + 1} failed:`, lastError);

                // Clean up failed connection
                await this._cleanupFailedConnection();
            }
        }

        // All retries failed
        throw new Error(
            `[PersistenceController] Failed to connect after ${PersistenceController.MAX_CONNECT_RETRIES + 1} attempts: ${lastError?.message}`
        );
    }

    /**
     * Single connection attempt
     */
    private async _connectWorkerOnce(config: PersistenceConfig): Promise<void> {
        // Capture bridge instance in a local variable to avoid accessing this._workerBridge after await, which may have been modified by disconnect()
        const bridge = new WorkerBridge(this._auth, {
            workerURL: this._workerURL,
        });

        this._workerBridge = bridge;

        // Asynchronously load worker script: extract URL from Vite factory function -> fetch -> blob URL -> SharedWorker.
        // This way SharedWorker inherits the page origin, avoiding cross-origin errors in CDN deployments.
        // See the top comment in worker-bridge.ts for details.
        await bridge.initWorker();

        // Checkpoint: if disconnect() was called during await, exit gracefully.
        // disconnect() will have set this._workerBridge to undefined or a new bridge.
        if (this._workerBridge !== bridge) {
            await bridge.destroy().catch(() => {}); // Ignore cleanup errors
            return;
        }

        // Strip non-serializable callback functions (Structured Clone does not support functions).
        // The Worker side replaces getToken with its own requestToken bridge in init(),
        // and the same applies to onTokenExpired — the Worker does not need these main-thread callbacks.
        const { getToken: _gt, onTokenExpired: _ote, ...serializableClient } = config.client;
        const workerConfig: PersistenceConfig = {
            ...config,
            client: serializableClient as PersistenceConfig['client'],
        };

        // Initialize the Worker (creates PersistenceLayer inside Worker)
        await bridge.init(workerConfig);

        // Checkpoint: if disconnect() was called during await, exit gracefully.
        if (this._workerBridge !== bridge) {
            await bridge.destroy().catch(() => {});
            return;
        }

        // Replace the main-thread virtualFS methods with a Comlink proxy.
        // The main thread cannot directly access IndexedDB,
        // so all virtualFS operations (tool execution, script reads, etc.) are automatically routed to the Worker.
        bridge.installVirtualFSProxy();

        // Create adapter that wraps the Comlink proxy
        // See the top comment of _asPersistenceLayer for cast semantics
        this._layer = _asPersistenceLayer(new WorkerPersistenceAdapter(bridge.core));

        // Connect (starts Centrifuge WebSocket inside Worker)
        await bridge.core.connect();

        // Create MasterLock and start election
        const userId = this._auth.state.userId;
        if (userId) {
            this._masterLock = new MasterLock(userId);
            this._masterLock.onAcquire = () => {
                log.info('this Tab became Master');
            };
            this._masterLock.onRelease = () => {
                log.info('this Tab lost Master');
            };
            // Start trying to acquire the lock (may queue)
            void this._masterLock.acquire();
        }
    }

    /**
     * Clean up a failed connection
     */
    private async _cleanupFailedConnection(): Promise<void> {
        if (this._workerBridge) {
            try {
                await this._workerBridge.destroy();
            } catch (err) {
                log.debug('Cleanup after failed connection (non-critical):', err);
            }
            this._workerBridge = undefined;
        }
        this._layer = undefined;
        this._fileStorage = undefined;
    }

    /**
     * Delay for the specified number of milliseconds
     */
    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Disconnect and tear down the PersistenceLayer.
     *
     * - Increment the generation counter to invalidate the finally block of any old _connecting promise
     * - Clear the _connecting promise to allow a new connection attempt
     * - Reset offset first, then close the layer
     * - Additionally release the MasterLock and destroy the WorkerBridge
     *
     * Call this on logout or when auth is lost.
     */
    async disconnect(): Promise<void> {
        // Increment the generation counter to invalidate the finally block of any old _connecting promise.
        // This is critical: if disconnect() interrupts an in-flight connection, the old promise's finally block
        // must not clear the new _connecting.
        this._connectGeneration++;
        const gen = this._connectGeneration;

        // Clear the _connecting promise to allow a new connection attempt.
        // This is critical: if disconnect() interrupts an in-flight connection, a subsequent connect()
        // should create a new connection rather than waiting for the already-interrupted old promise.
        if (this._connecting) {
            this._connecting = undefined;
        }

        // Capture layer and workerBridge in local variables to avoid clearing new instances during await
        const layer = this._layer;
        const workerBridge = this._workerBridge;

        // P1 Fix: Clear references immediately to prevent new operations from using them during disconnect.
        // This prevents race conditions where connect() is called during disconnect()'s await operations.
        this._layer = undefined;
        this._workerBridge = undefined;

        if (layer) {
            try {
                // Reset offset (passed through via the adapter shim to core.resetOffset())
                await layer.getOffsetManager().reset();
                // Close WS + DB (delegated via the adapter to core.close())
                await layer.close();
            } catch (err) {
                log.error('disconnect error:', err);
            }
        }

        // Additional cleanup
        if (workerBridge) {
            this._masterLock?.release();
            this._masterLock = undefined;
            this._fileStorage = undefined;
            try {
                await workerBridge.destroy();
            } catch (err) {
                log.error('WorkerBridge disconnect error:', err);
            }
        }

        // P1 Fix: Verify that no new connection was started during our cleanup
        // If generation changed, a new connect() was called, and we should not interfere
        if (this._connectGeneration !== gen) {
            log.warn('disconnect interrupted by new connect, generation changed');
        }
    }

    // ========== Unified connection state interface ==========

    /**
     * Get the current connection state.
     *
     * Retrieves the connection state via WorkerBridge.
     */
    async getConnectionState(): Promise<ConnectionState> {
        if (this._workerBridge) {
            return this._workerBridge.getConnectionState();
        }
        return 'disconnected';
    }

    /**
     * Listen for connection state changes.
     *
     * Subscribes to connection state change events broadcast by WorkerBridge.
     * Returns a function that unsubscribes the listener.
     */
    onConnectionStateChange(listener: (event: ConnectionStateEvent) => void): () => void {
        if (this._workerBridge) {
            return this._workerBridge.onConnectionStateChange(listener);
        }
        // Return a no-op unsubscribe function when not connected
        return () => {};
    }
}
