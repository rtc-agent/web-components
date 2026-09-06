/**
 * Persistence Controller
 *
 * Manages the PersistenceLayer lifecycle: creates it lazily, connects when
 * auth succeeds, disconnects on logout or host teardown.
 *
 * Supports two modes:
 * - Direct mode (default): creates PersistenceLayer in main thread
 * - Worker mode (useSharedWorker=true): creates SharedWorker + Comlink bridge,
 *   exposes a PersistenceLayer-compatible adapter
 *
 * Corresponds to: no context (infrastructure concern, not UI state).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: other controllers (via `persistence.layer`)
 */
import type {ReactiveController} from 'lit';
import type {Remote} from 'comlink';
import {
    createPersistenceLayer,
    type PersistenceLayer,
    type LocalSession,
    type LocalMessage,
    type LocalRtc,
} from '@rtc-agent/persistence';
import type {ContentData} from '@rtc-agent/protocol';
import type {WorkerPersistenceCore} from '@rtc-agent/worker';
import type {AuthController} from './auth.controller.js';
import {AUTH_CONFIG} from '../config/auth.js';
import {getOrCreateDeviceId} from '../utils/device.js';
import {WORKER_CONFIG} from '../config/worker.js';
import {WorkerBridge} from '../worker-bridge.js';

/**
 * Worker 模式下的 PersistenceLayer 适配器
 *
 * 实现 PersistenceLayer 的公共接口，内部通过 Comlink 代理转发到 Worker。
 * 使根组件代码无需修改即可在两种模式间切换。
 *
 * 注意：getClient() / getOffsetManager() / getEntityRepository() 在 Worker 模式下
 * 无法直接工作（这些对象在 Worker 内部），调用时会抛出错误。
 * 这是 Phase 2 的已知限制，后续阶段会通过 Worker 广播连接状态来解决。
 */
class WorkerPersistenceAdapter {
    private _core: Remote<WorkerPersistenceCore>;

    constructor(core: Remote<WorkerPersistenceCore>) {
        this._core = core;
    }

    // ========== 连接 ==========

    async connect(): Promise<void> {
        await this._core.connect();
    }

    disconnect(): void {
        this._core.disconnect();
    }

    async reconnect(): Promise<void> {
        await this._core.reconnect();
    }

    // ========== 查询 ==========

    async listSessions(cursor?: string, limit?: number): Promise<LocalSession[]> {
        return this._core.listSessions(cursor, limit);
    }

    async getSession(clientId: string): Promise<LocalSession | undefined> {
        return this._core.getSession(clientId);
    }

    async getSessionByClientId(clientId: string): Promise<LocalSession | undefined> {
        return this._core.getSession(clientId);
    }

    async listMessages(
        sessionClientId: string,
        cursor?: number,
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

    // ========== 操作 ==========

    async sendMessage(params: {
        content: ContentData;
        messageClientId: string;
        sessionClientId: string;
    }): Promise<{ session: LocalSession; message: LocalMessage }> {
        return this._core.sendMessage(params);
    }

    async stopTurn(sessionClientId: string): Promise<void> {
        return this._core.stopTurn(sessionClientId);
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

    // ========== 生命周期 ==========

    async close(): Promise<void> {
        await this._core.close();
    }

    async flushAll(): Promise<void> {
        return this._core.flushAll();
    }

    // ========== Worker 模式下不支持的方法 ==========

    /**
     * TODO(Phase 3): Worker 模式下需要通过 Worker 广播连接状态事件来替代直接访问 RTCAgentClient。
     * 当前根组件的 `_setupConnectionListener()` 会调用 getClient()，
     * 在 Worker 模式下会抛出错误。需要：
     * 1. WorkerCore 暴露连接状态变更事件
     * 2. WorkerBridge 桥接该事件到主线程
     * 3. 根组件根据模式选择监听方式
     *
     * @throws Worker 模式下不支持直接访问 RTCAgentClient
     */
    getClient(): never {
        throw new Error(
            '[WorkerPersistenceAdapter] getClient() is not available in Worker mode. ' +
            'TODO(Phase 3): Worker should broadcast connection state events instead.',
        );
    }

    /**
     * TODO(Phase 3+): 如果根组件需要在 Worker 模式下访问 OffsetManager，
     * 需要通过 Worker 暴露相关方法或事件。当前 disconnect() 中会调用
     * getOffsetManager().reset()，但在 Worker 模式下走的是 _workerBridge.destroy() 分支，
     * 不会触发此方法。
     *
     * @throws Worker 模式下不支持直接访问 OffsetManager
     */
    getOffsetManager(): never {
        throw new Error(
            '[WorkerPersistenceAdapter] getOffsetManager() is not available in Worker mode. ' +
            'TODO(Phase 3+): Expose offset management via Worker if needed.',
        );
    }

    /**
     * TODO(Phase 3+): 如果根组件需要在 Worker 模式下访问 EntityRepository，
     * 需要通过 Worker 暴露相关方法。当前根组件不直接调用此方法，
     * 但如果未来有需要，需要 Worker 侧支持。
     *
     * @throws Worker 模式下不支持直接访问 EntityRepository
     */
    getEntityRepository(): never {
        throw new Error(
            '[WorkerPersistenceAdapter] getEntityRepository() is not available in Worker mode. ' +
            'TODO(Phase 3+): Expose entity repository methods via Worker if needed.',
        );
    }
}

export class PersistenceController implements ReactiveController {
    private _layer?: PersistenceLayer;
    private _auth: AuthController;
    private _workerBridge?: WorkerBridge;

    constructor(host: {addController(c: ReactiveController): void}, auth: AuthController) {
        this._auth = auth;
        host.addController(this);
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
     * Get the WorkerBridge instance (only available in Worker mode).
     *
     * Useful for Phase 3+ (Master election) where the root component
     * needs direct access to the Worker core.
     */
    get workerBridge(): WorkerBridge | undefined {
        return this._workerBridge;
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
     * In direct mode (default): creates PersistenceLayer in main thread.
     * In Worker mode (useSharedWorker=true): creates SharedWorker + Comlink bridge.
     *
     * Call this after auth succeeds (tokens are set in AuthController).
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    async connect(): Promise<void> {
        if (this._layer) return;

        const deviceId = getOrCreateDeviceId();
        const userId = this._auth.state.userId;

        if (!userId) {
            throw new Error('[PersistenceController] connect() called without userId; refusing to open a shared database');
        }

        const config = {
            databaseName: `rtc-agent-${userId}`,
            client: {
                endpoint: AUTH_CONFIG.wsEndpoint,
                getToken: () => {
                    const token = this._auth.getAccessToken();
                    if (!token) {
                        console.warn('[PersistenceController] getToken → no access token available');
                        throw new Error('No access token available');
                    }
                    return token;
                },
                onTokenExpired: () => this._auth.handleTokenExpired(),
                deviceId,
                userId,
            },
        };

        if (WORKER_CONFIG.useSharedWorker) {
            await this._connectWorker(config);
        } else {
            await this._connectDirect(config);
        }
    }

    /**
     * Direct mode: create PersistenceLayer in main thread.
     */
    private async _connectDirect(config: Parameters<typeof createPersistenceLayer>[0]): Promise<void> {
        this._layer = createPersistenceLayer(config);
        await this._layer.connect();
    }

    /**
     * Worker mode: create SharedWorker + Comlink bridge.
     *
     * The WorkerPersistenceAdapter wraps the Comlink proxy, presenting a
     * PersistenceLayer-compatible interface to the rest of the application.
     */
    private async _connectWorker(config: Parameters<typeof createPersistenceLayer>[0]): Promise<void> {
        // Resolve worker URL
        // In dev mode with Vite, the worker script needs to be served separately.
        // For now, use a relative URL that assumes the worker script is at the
        // same origin (typical for bundled deployments).
        const workerUrl = this._resolveWorkerUrl();

        this._workerBridge = new WorkerBridge(workerUrl, this._auth);

        // Initialize the Worker (creates PersistenceLayer inside Worker)
        await this._workerBridge.init(config);

        // Create adapter that wraps the Comlink proxy
        // Type assertion: WorkerPersistenceAdapter has the same public interface
        // as PersistenceLayer (except getClient/getOffsetManager/getEntityRepository).
        this._layer = new WorkerPersistenceAdapter(this._workerBridge.core) as unknown as PersistenceLayer;

        // Connect (starts Centrifuge WebSocket inside Worker)
        await this._workerBridge.core.connect();
    }

    /**
     * Resolve the SharedWorker script URL.
     *
     * The worker script is in @rtc-agent/worker/dist/shared-worker.js.
     * In a Vite dev server, this would be served from node_modules.
     * In production, it should be bundled and served from the same origin.
     *
     * TODO(Phase 2): 当前是硬编码路径，需要与 Vite 构建系统集成：
     * 1. Dev 模式：使用 Vite 的 `?worker&inline` 或手动配置 worker 入口
     * 2. Prod 模式：确保 worker 脚本被正确打包并复制到 dist 目录
     * 3. 考虑使用 import.meta.url + new URL() 模式来让 bundler 自动处理
     */
    private _resolveWorkerUrl(): string {
        // Try to use Vite's dev server URL for the worker
        // In production, this would need to be a proper bundled URL
        try {
            // @rtc-agent/worker exports "./shared-worker" → "./dist/shared-worker.js"
            // Use import.meta.env to detect dev mode
            if (import.meta.env?.DEV) {
                // In dev mode, try the node_modules path (Vite should handle this)
                return '/node_modules/@rtc-agent/worker/dist/shared-worker.js';
            }
        } catch {
            // import.meta.env not available
        }

        // Production: assume worker script is served from /shared-worker.js
        // This should be configured via build tooling
        return '/shared-worker.js';
    }

    /**
     * Disconnect and tear down the PersistenceLayer.
     *
     * In Worker mode: destroys the WorkerBridge (unregister callbacks + close port).
     * In direct mode: closes the PersistenceLayer directly.
     *
     * Call this on logout or when auth is lost.
     */
    async disconnect(): Promise<void> {
        if (this._workerBridge) {
            try {
                await this._workerBridge.destroy();
            } catch (err) {
                console.error('[PersistenceController] WorkerBridge disconnect error:', err);
            }
            this._workerBridge = undefined;
            this._layer = undefined;
        } else if (this._layer) {
            try {
                // 先重置 offset
                await this._layer.getOffsetManager().reset();
                // 关闭 WS + DB
                await this._layer.close();
            } catch (err) {
                console.error('[PersistenceController] disconnect error:', err);
            }
            this._layer = undefined;
        }
    }
}
