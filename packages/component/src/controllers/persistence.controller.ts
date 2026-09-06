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
import type {WorkerPersistenceCore} from '@rtc-agent/worker';
import type {AuthController} from './auth.controller.js';
import {AUTH_CONFIG} from '../config/auth.js';
import {getOrCreateDeviceId} from '../utils/device.js';
import {WorkerBridge} from '../worker-bridge.js';
import {MasterLock} from '../master-lock.js';

/**
 * 将 WorkerPersistenceAdapter 断言为 PersistenceLayer
 *
 * WorkerPersistenceAdapter 结构上匹配 PersistenceLayer，但以下方法语义不同：
 * - getClient(): throws（用 PersistenceController.onConnectionStateChange 替代）
 * - getEntityRepository(): throws（当前无调用方）
 * - getOffsetManager(): 返回仅含 reset() 的 shim
 *
 * 当修改 PersistenceLayer 公共 API 时，必须同步更新 WorkerPersistenceAdapter。
 * 集中在此函数，避免散落在代码中的 `as unknown as` 造成认知负担。
 */
function _asPersistenceLayer(adapter: WorkerPersistenceAdapter): PersistenceLayer {
    return adapter as unknown as PersistenceLayer;
}

/**
 * PersistenceLayer 的 Worker 适配器
 *
 * 实现 PersistenceLayer 的公共接口，内部通过 Comlink 代理转发到 SharedWorker。
 *
 * 注意：getClient() / getOffsetManager() / getEntityRepository() 无法直接工作
 * （这些对象在 Worker 内部），调用时会抛出错误。
 * 连接状态已通过 PersistenceController.onConnectionStateChange 统一接口解决。
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

    /**
     * 初始化虚拟文件系统
     *
     * virtualFS 在 Worker 内共享同一 IndexedDB，通过 Comlink 透传调用。
     */
    async initializeVirtualFS(config?: AgentMdConfig): Promise<void> {
        await this._core.initializeVirtualFS(config ?? {});
    }

    // ========== 受限的方法 ==========

    /**
     * @throws 不支持直接访问 RTCAgentClient，使用 PersistenceController.onConnectionStateChange 替代
     */
    getClient(): never {
        throw new Error(
            '[WorkerPersistenceAdapter] getClient() is not available. ' +
            'Use PersistenceController.onConnectionStateChange() instead.',
        );
    }

    /**
     * 返回一个 shim 对象，仅支持 reset() 操作。
     *
     * reset() 通过 Comlink 透传到 Worker 内的 getOffsetManager().reset()。
     */
    getOffsetManager(): { reset: () => Promise<void> } {
        return {
            reset: () => this._core.resetOffset(),
        };
    }

    /**
     * @throws 不支持直接访问 EntityRepository
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
     * Get the WorkerBridge instance.
     */
    get workerBridge(): WorkerBridge | undefined {
        return this._workerBridge;
    }

    /**
     * Get the MasterLock instance.
     *
     * MasterLock 封装 Web Locks API，用于 Master Tab 选举。
     * 每个 Tab 各自持有一个 MasterLock，自己判断是否为 Master。
     * 只有 Master Tab 的 RtcProcessor 会执行 RTC 工具调用。
     *
     * @see docs/shared-worker-proposal.md §4.3
     */
    get masterLock(): MasterLock | undefined {
        return this._masterLock;
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

        await this._connectWorker(config);
    }

    /**
     * Create SharedWorker + Comlink bridge.
     *
     * The WorkerPersistenceAdapter wraps the Comlink proxy, presenting a
     * PersistenceLayer-compatible interface to the rest of the application.
     */
    private async _connectWorker(config: PersistenceConfig): Promise<void> {
        // Worker URL 由 WorkerBridge 内部通过 `new URL(..., import.meta.url)` 解析
        // Vite 在 dev/build 时自动处理依赖打包
        this._workerBridge = new WorkerBridge(this._auth);

        // 剥离不可序列化的回调函数（Structured Clone 不支持函数）。
        // Worker 侧会在 init() 中用自己的 requestToken 桥接替换 getToken，
        // onTokenExpired 同理——Worker 不需要这些主线程回调。
        const { getToken: _gt, onTokenExpired: _ote, ...serializableClient } = config.client;
        const workerConfig: PersistenceConfig = {
            ...config,
            client: serializableClient as PersistenceConfig['client'],
        };

        // Initialize the Worker (creates PersistenceLayer inside Worker)
        await this._workerBridge.init(workerConfig);

        // 将主线程的 virtualFS 方法替换为 Comlink 代理
        // 主线程不可直接访问 IndexedDB，
        // 所有 virtualFS 操作（工具执行、script 读取等）自动路由到 Worker
        this._workerBridge.installVirtualFSProxy();

        // Create adapter that wraps the Comlink proxy
        // 断言语义见 _asPersistenceLayer 顶部注释
        this._layer = _asPersistenceLayer(new WorkerPersistenceAdapter(this._workerBridge.core));

        // Connect (starts Centrifuge WebSocket inside Worker)
        await this._workerBridge.core.connect();

        // 创建 MasterLock 并开始选举
        const userId = this._auth.state.userId;
        if (userId) {
            this._masterLock = new MasterLock(userId);
            this._masterLock.onAcquire = () => {
                console.info('[PersistenceController] this Tab became Master');
            };
            this._masterLock.onRelease = () => {
                console.info('[PersistenceController] this Tab lost Master');
            };
            // 开始尝试获取锁（可能排队）
            void this._masterLock.acquire();
        }
    }

    /**
     * Disconnect and tear down the PersistenceLayer.
     *
     * - 先 reset offset，再 close layer
     * - 额外释放 MasterLock + 销毁 WorkerBridge
     *
     * Call this on logout or when auth is lost.
     */
    async disconnect(): Promise<void> {
        if (this._layer) {
            try {
                // 重置 offset（通过 adapter shim 透传到 core.resetOffset()）
                await this._layer.getOffsetManager().reset();
                // 关闭 WS + DB（通过 adapter 委托到 core.close()）
                await this._layer.close();
            } catch (err) {
                console.error('[PersistenceController] disconnect error:', err);
            }
            this._layer = undefined;
        }

        // 额外清理
        if (this._workerBridge) {
            this._masterLock?.release();
            this._masterLock = undefined;
            try {
                await this._workerBridge.destroy();
            } catch (err) {
                console.error('[PersistenceController] WorkerBridge disconnect error:', err);
            }
            this._workerBridge = undefined;
        }
    }

    // ========== 连接状态统一接口 ==========

    /**
     * 获取当前连接状态
     *
     * 通过 WorkerBridge 获取连接状态。
     */
    async getConnectionState(): Promise<ConnectionState> {
        if (this._workerBridge) {
            return this._workerBridge.getConnectionState();
        }
        return 'disconnected';
    }

    /**
     * 监听连接状态变更
     *
     * 监听 WorkerBridge 广播的连接状态变更事件。
     * 返回取消监听的函数。
     */
    onConnectionStateChange(listener: (event: ConnectionStateEvent) => void): () => void {
        if (this._workerBridge) {
            return this._workerBridge.onConnectionStateChange(listener);
        }
        // 未连接时返回空取消函数
        return () => {};
    }
}
