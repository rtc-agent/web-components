/**
 * WorkerBridge: 主线程与 SharedWorker 之间的 Comlink 桥接
 *
 * 职责：
 * 1. 创建 SharedWorker 实例
 * 2. 用 Comlink.wrap() 获取 WorkerPersistenceCore 的代理
 * 3. 注册回调：Worker 的 UIUpdateEvent → 主线程 UIUpdateBus.publish()
 * 4. 注册回调：Worker 的 token 请求 → AuthController.getAccessToken()
 *
 * 设计要点：
 * - 主线程保留 UIUpdateBus 单例（现有 UI 代码继续订阅它）
 * - Worker 广播事件时，WorkerBridge 在主线程 UIUpdateBus 上重新发布
 * - 一个页面只有一个 SharedWorker 实例（多 Tab 共享由浏览器管理）
 */
import {wrap, type Remote} from 'comlink';
import {getUIUpdateBus} from '@rtc-agent/persistence';
import type {PersistenceConfig, UIUpdateEvent} from '@rtc-agent/persistence';
import type {WorkerPersistenceCore, WorkerCallbacks} from '@rtc-agent/worker';
import type {AuthController} from './controllers/auth.controller.js';

export class WorkerBridge {
    private _worker: SharedWorker;
    private _core: Remote<WorkerPersistenceCore>;
    private _callbacks: WorkerCallbacks;
    private _initialized = false;

    constructor(workerUrl: string, auth: AuthController) {
        // 1. 创建 SharedWorker 实例
        this._worker = new SharedWorker(workerUrl, {
            name: 'rtc-agent-worker',
            type: 'module',
        });

        // 2. Comlink.wrap 获取代理
        // SharedWorker 通过 port 通信，Comlink.wrap 接受 MessagePort
        this._core = wrap<WorkerPersistenceCore>(this._worker.port);

        // 3. 准备回调（稍后注册到 Worker）
        this._callbacks = {
            // Worker 广播 UIUpdateEvent → 主线程 UIUpdateBus.publish()
            onUIUpdate: (event: UIUpdateEvent) => {
                const bus = getUIUpdateBus();
                bus.publish(event);
            },
            // Worker 请求 token → AuthController.getAccessToken()
            // TODO(Phase 3): Token 请求去重 — 提案 §7 要求"并发 token 请求去重：缓存最新 Promise"。
            // 当前实现每次都直接调用 getAccessToken()，如果多个 Tab 同时请求 token
            // 会导致多次 AuthController 调用。需要加 Promise 缓存机制。
            requestToken: async (): Promise<string> => {
                const token = auth.getAccessToken();
                if (!token) {
                    throw new Error('[WorkerBridge] no access token available');
                }
                return token;
            },
        };

        // 4. 错误处理
        this._worker.onerror = (event) => {
            // TODO(Phase 6): Worker crash recovery — 当前仅打印错误。
            // 需要根据 shared-worker-proposal.md §9 的错误处理方案：
            // 1. 检测到 Worker 崩溃后重建 SharedWorker 实例
            // 2. 重新调用 init() 初始化
            // 3. 重新触发 Master 选举
            console.error('[WorkerBridge] SharedWorker error:', event);
        };

        this._worker.port.onmessageerror = (event) => {
            console.error('[WorkerBridge] port message error:', event);
        };
    }

    /**
     * 获取 Comlink 代理的 WorkerPersistenceCore
     *
     * 所有方法调用都会通过 postMessage 转发到 Worker 执行。
     * 返回的对象接口与 WorkerPersistenceCore 完全一致。
     */
    get core(): Remote<WorkerPersistenceCore> {
        return this._core;
    }

    /**
     * 初始化桥接
     *
     * 1. 调用 Worker 的 core.init() 初始化共享状态
     * 2. 注册本 Tab 的回调（onUIUpdate + requestToken）
     * 3. 打开 port 开始通信
     *
     * 幂等：多次调用只有第一次生效。
     */
    async init(config: PersistenceConfig): Promise<void> {
        if (this._initialized) {
            console.warn('[WorkerBridge] already initialized');
            return;
        }

        // 打开 port（必须在首次通信前调用）
        this._worker.port.start();

        // 初始化 Worker 侧的共享状态
        await this._core.init(config);

        // 注册本 Tab 的回调
        await this._core.registerCallback(this._callbacks);

        this._initialized = true;
    }

    /**
     * 销毁桥接
     *
     * 1. 取消注册回调
     * 2. 关闭 port
     * 3. 终止 Worker（注意：SharedWorker 只有在所有 port 关闭后才会终止）
     */
    async destroy(): Promise<void> {
        if (!this._initialized) {
            return;
        }

        try {
            await this._core.unregisterCallback(this._callbacks);
        } catch (err) {
            console.warn('[WorkerBridge] unregisterCallback failed:', err);
        }

        this._worker.port.close();
        this._initialized = false;
    }
}
