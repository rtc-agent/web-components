/**
 * WorkerBridge: 主线程与 SharedWorker 之间的 Comlink 桥接
 *
 * 职责：
 * 1. 创建 SharedWorker 实例
 * 2. 用 Comlink.wrap() 获取 WorkerPersistenceCore 的代理
 * 3. 注册回调：Worker 的 UIUpdateEvent → 主线程 UIUpdateBus.publish()
 * 4. 注册回调：Worker 的 token 请求 → AuthController.getAccessToken()（带去重）
 * 5. 注册回调：Worker 的连接状态变更 → 主线程监听器
 *
 * 设计要点：
 * - 主线程保留 UIUpdateBus 单例（现有 UI 代码继续订阅它）
 * - Worker 广播事件时，WorkerBridge 在主线程 UIUpdateBus 上重新发布
 * - 一个页面只有一个 SharedWorker 实例（多 Tab 共享由浏览器管理）
 * - Token 请求去重：并发请求共享同一个 Promise（提案 §7）
 */
import {wrap, proxy, type Remote} from 'comlink';
import {getUIUpdateBus, virtualFS} from '@rtc-agent/persistence';
import type {PersistenceConfig, UIUpdateEvent} from '@rtc-agent/persistence';
import type {ConnectionState, ConnectionStateEvent} from '@rtc-agent/client';
import type {WorkerPersistenceCore, WorkerCallbacks} from '@rtc-agent/worker';
import type {AuthController} from './controllers/auth.controller.js';

// Worker 脚本加载策略
//
// 背景：组件可能从 CDN 加载，此时组件脚本与宿主页面跨源。
// SharedWorker 要求脚本同源（data: URL 分配 opaque origin，blob: URL 继承创建页面 origin）。
//
// Vite 的 `?sharedworker` 导入会编译 worker 并生成一个**工厂函数**（不是 URL 字符串）。
// 工厂函数内部用 `new URL("assets/shared-worker-<hash>.js", import.meta.url)` 引用编译后的
// worker chunk，运行时调用它会在 CDN 上构造跨源 SharedWorker → SecurityError。
//
// 解决方案：
//   1. 把工厂函数 toString()，用正则提取内嵌的 worker chunk 相对路径
//   2. 用 `new URL(相对路径, import.meta.url)` 解析出 CDN 上的绝对 URL
//   3. fetch 该 URL（CDN 需返回 CORS 头）拿到编译后的 worker 脚本
//   4. 用 Blob + URL.createObjectURL 创建 blob: URL → 继承页面 origin
//   5. 用 blob: URL 构造 SharedWorker → 同源，可访问 IndexedDB
import workerFactory from '../../worker/src/shared-worker.ts?sharedworker';

/**
 * 从 Vite 生成的 worker 工厂函数源码中提取 worker chunk 的 URL。
 *
 * Vite 在不同模式下生成的工厂函数格式不同：
 *
 * - dev 模式（plain string）：
 *     function WorkerWrapper(options) {
 *       return new SharedWorker("/@fs/.../shared-worker.ts?worker_file&type=module", ...)
 *     }
 *
 * - 生产模式（new URL）：
 *     function CM(t) {
 *       return new SharedWorker("" + new URL("assets/shared-worker-<hash>.js", import.meta.url).href, ...)
 *     }
 *
 * 先尝试 new URL(...) 模式（生产），再尝试 plain string（dev）。
 */
function extractWorkerRelativePath(factory: Function): string {
    const src = factory.toString();

    // 1. 生产模式：new URL("...", import.meta.url)
    const urlMatch = src.match(/new URL\(\s*(["'`])([^"'`]+)\1/);
    if (urlMatch) return urlMatch[2];

    // 2. dev 模式：new SharedWorker("literal-string", ...)
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
    /** Comlink proxy 包装后的回调（用于跨 Worker 传递） */
    private _proxiedCallbacks: WorkerCallbacks;
    private _initialized = false;

    /** Token 请求去重缓存（提案 §7：并发请求共享同一个 Promise） */
    private _tokenPromise: Promise<string> | null = null;

    /** 连接状态监听器（主线程侧） */
    private _connectionListeners = new Set<(event: ConnectionStateEvent) => void>();

    constructor(private readonly _auth: AuthController) {
        // 1. 准备回调（在 init() 中注册到 Worker）
        this._callbacks = {
            // Worker 广播 UIUpdateEvent → 主线程 UIUpdateBus.publish()
            onUIUpdate: (event: UIUpdateEvent) => {
                const bus = getUIUpdateBus();
                bus.publish(event);
            },
            // Worker 请求 token → AuthController.getAccessToken()
            // 去重：并发请求共享同一个 Promise，resolve 后清空缓存
            requestToken: (): Promise<string> => {
                if (this._tokenPromise) {
                    return this._tokenPromise;
                }
                this._tokenPromise = (async () => {
                    try {
                        const token = this._auth.getAccessToken();
                        if (!token) {
                            throw new Error('[WorkerBridge] no access token available');
                        }
                        return token;
                    } finally {
                        // resolve/reject 后清空缓存，下次请求重新获取
                        this._tokenPromise = null;
                    }
                })();
                return this._tokenPromise;
            },
            // Worker 请求刷新 token → AuthController.handleTokenExpired()
            // 返回 'refresh' 表示已刷新，'relogin' 表示需要重新登录
            requestTokenRefresh: (): Promise<'refresh' | 'relogin'> => {
                return this._auth.handleTokenExpired();
            },
            // Worker 广播连接状态变更 → 通知主线程监听器
            onConnectionStateChange: (event: ConnectionStateEvent) => {
                for (const listener of this._connectionListeners) {
                    try {
                        listener(event);
                    } catch (err) {
                        console.error('[WorkerBridge] connection listener error:', err);
                    }
                }
            },
        };

        // 2. 创建 Comlink proxy 包装的回调（用于跨 Worker 传递）
        // Structured Clone 不支持函数，proxy() 通过 MessagePort 桥接解决此问题
        this._proxiedCallbacks = proxy(this._callbacks);

        // 注：SharedWorker 实例、Comlink wrap、错误处理都在 initWorker() 中创建，
        // 因为需要先 async fetch worker 脚本并生成 blob URL。
    }

    /**
     * 异步创建 SharedWorker 实例
     *
     * 流程：
     * 1. 从 Vite 工厂函数提取 worker chunk 的相对路径
     * 2. 解析出 CDN 上的绝对 URL，fetch 编译后的 worker 脚本（依赖 CORS）
     * 3. 用 Blob + createObjectURL 创建同源 blob: URL
     * 4. 用 blob: URL 构造 SharedWorker → 继承页面 origin
     *
     * 必须在 init() 之前调用。
     */
    async initWorker(): Promise<void> {
        // 1. 提取 worker chunk 路径（从 Vite 工厂函数源码）
        const workerPath = extractWorkerRelativePath(workerFactory);

        // 2. 解析出 worker 的绝对 URL
        const here = import.meta.url;
        const workerUrl = new URL(workerPath, here).href;

        // 3. 判断是否跨源
        const pageOrigin = window.location.origin;
        let workerOrigin: string;
        try {
            workerOrigin = new URL(workerUrl).origin;
        } catch {
            workerOrigin = pageOrigin;
        }
        const isCrossOrigin = workerOrigin !== pageOrigin;

        console.info('[WorkerBridge] worker init:', {
            workerUrl,
            pageOrigin,
            workerOrigin,
            isCrossOrigin,
        });

        if (!isCrossOrigin) {
            // 同源：直接用工厂函数构造 SharedWorker（最简单、最可靠）
            // 本地 dev、同源部署都走这里
            // Vite 的类型定义有误（把 ?sharedworker 导入标为构造函数），运行时它是普通函数
            this._worker = new (workerFactory as any)();
        } else {
            // 跨源（CDN 部署）：fetch worker 脚本 → 用 Blob 创建同源 blob: URL → 构造 SharedWorker
            // CDN 必须返回 CORS 头（Access-Control-Allow-Origin），否则 fetch 会失败
            let script: string;
            try {
                const response = await fetch(workerUrl);
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
                // blob URL 已传给 SharedWorker，可立即释放（worker 已持有脚本内容）
                URL.revokeObjectURL(blobUrl);
            }
        }

        // 4. Comlink.wrap 获取代理（两种路径都需要）
        this._core = wrap<WorkerPersistenceCore>(this._worker!.port);

        // 5. 错误处理
        // TODO(Phase 6): Worker crash recovery — 当前仅打印错误。
        // 需要根据 shared-worker-proposal.md §9 的错误处理方案：
        // 1. 检测到 Worker 崩溃后重建 SharedWorker 实例
        // 2. 重新调用 init() 初始化
        // 3. 重新触发 Master 选举
        this._worker!.onerror = (event) => {
            console.error('[WorkerBridge] SharedWorker error:', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error,
            });
        };

        this._worker!.port.onmessageerror = (event) => {
            console.error('[WorkerBridge] port message error:', event);
        };
    }

    /**
     * 获取 Comlink 代理的 WorkerPersistenceCore
     *
     * 所有方法调用都会通过 postMessage 转发到 Worker 执行。
     * 返回的对象接口与 WorkerPersistenceCore 完全一致。
     *
     * 必须在 initWorker() 之后访问。
     */
    get core(): Remote<WorkerPersistenceCore> {
        return this._core!;
    }

    /**
     * 初始化桥接
     *
     * 1. 调用 Worker 的 core.init() 初始化共享状态
     * 2. 注册本 Tab 的回调（onUIUpdate + requestToken + onConnectionStateChange）
     * 3. 打开 port 开始通信
     *
     * 幂等：多次调用只有第一次生效。
     * 必须先调用 initWorker()。
     */
    async init(config: PersistenceConfig): Promise<void> {
        if (this._initialized) {
            console.warn('[WorkerBridge] already initialized');
            return;
        }
        if (!this._worker || !this._core) {
            throw new Error('[WorkerBridge] init() called before initWorker()');
        }

        // 打开 port（必须在首次通信前调用）
        this._worker.port.start();

        // 初始化 Worker 侧的共享状态
        await this._core.init(config);

        // 注册本 Tab 的回调（使用 proxy 包装的版本）
        await this._core.registerCallback(this._proxiedCallbacks);

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
        if (!this._worker || !this._core) {
            return;
        }

        try {
            await this._core.unregisterCallback(this._proxiedCallbacks);
        } catch (err) {
            console.warn('[WorkerBridge] unregisterCallback failed:', err);
        }

        this._connectionListeners.clear();
        this._worker.port.close();
        this._initialized = false;
    }

    // ========== 连接状态监听 ==========

    /**
     * 获取 Worker 中 RTCAgentClient 的当前连接状态
     *
     * 通过 Comlink 调用 Worker 的 getConnectionState()。
     */
    async getConnectionState(): Promise<ConnectionState> {
        return this._core!.getConnectionState();
    }

    /**
     * 监听连接状态变更
     *
     * 返回取消监听的函数。
     */
    onConnectionStateChange(listener: (event: ConnectionStateEvent) => void): () => void {
        this._connectionListeners.add(listener);
        return () => {
            this._connectionListeners.delete(listener);
        };
    }

    // ========== virtualFS 代理 ==========

    /**
     * 将主线程的 virtualFS 单例方法替换为 Comlink 代理
     *
     * 主线程不可直接访问 IndexedDB。
     * 替换后，所有通过 virtualFS 发起的操作（工具执行、script 读取、
     * function-registry 写文档、scenario-loader 等）都会自动路由到 Worker。
     *
     * 注意：virtualFS 是模块级单例，替换是全局性的。
     */
    installVirtualFSProxy(): void {
        const core = this._core!;

        // 保存原始实现，以备恢复（目前单向切换，暂不需要恢复）
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
