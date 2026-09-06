/**
 * MasterLock: 基于 Web Locks API 的 Master Tab 选举
 *
 * 设计原则：
 * - 每个 Tab 各自持有一个 MasterLock，自己判断是否为 Master
 * - Worker 不参与选举，不知道也不关心谁是 Master
 * - Tab 关闭 → 浏览器自动释放锁 → 其他 Tab 排队获得 → 自动升级
 * - 锁名含 userId，多用户隔离
 *
 * 用法：
 * ```ts
 * const lock = new MasterLock('user-123');
 * lock.onAcquire = () => { console.log('became master'); };
 * lock.onRelease = () => { console.log('lost master'); };
 * await lock.acquire();  // 开始尝试获取锁（可能排队）
 * // ... later
 * lock.release();        // 主动释放（Tab 关闭时浏览器自动释放）
 * ```
 *
 * @see docs/shared-worker-proposal.md §4.3
 */

/** MasterLock 事件回调 */
export interface MasterLockCallbacks {
    /** 获得锁 → 成为 Master */
    onAcquire?: () => void;
    /** 失去锁 → 降级为非 Master */
    onRelease?: () => void;
}

export class MasterLock {
    private _lockName: string;
    private _isMaster = false;
    private _controlled = false;
    private _abortController?: AbortController;

    /** 获得锁时的回调 */
    onAcquire?: () => void;
    /** 失去锁时的回调 */
    onRelease?: () => void;

    constructor(userId: string) {
        this._lockName = `rtc-agent-master-${userId}`;
    }

    /**
     * 当前 Tab 是否为 Master
     */
    get isMaster(): boolean {
        return this._isMaster;
    }

    /**
     * 是否已经开始选举流程（调用了 acquire）
     */
    get isControlled(): boolean {
        return this._controlled;
    }

    /**
     * 开始尝试获取 Master 锁
     *
     * - 如果没有其他 Master，立即获得锁
     * - 如果已有 Master，排队等待（浏览器调度，零轮询）
     * - 获得锁后调用 onAcquire 回调
     * - Tab 关闭 → 浏览器自动释放 → 排队的 Tab 获得锁
     *
     * 幂等：多次调用只有第一次生效。
     */
    async acquire(): Promise<void> {
        if (this._controlled) {
            console.warn('[MasterLock] already acquiring/acquired, ignoring');
            return;
        }

        if (!this._isWebLocksAvailable()) {
            // Web Locks 不可用 → 直接降级为"总是 Master"
            // 兼容旧浏览器或特殊环境（如隐私模式）
            console.warn('[MasterLock] Web Locks API not available, acting as always-master');
            this._isMaster = true;
            this._controlled = true;
            this.onAcquire?.();
            return;
        }

        this._controlled = true;
        this._abortController = new AbortController();

        // navigator.locks.request 的 callback 在获得锁时调用
        // callback 返回的 Promise resolve 时释放锁
        // 我们让 callback 永不 resolve → 锁一直被持有直到 Tab 关闭
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        navigator.locks.request(
            this._lockName,
            { signal: this._abortController.signal },
            async () => {
                // 获得锁 → 成为 Master
                this._isMaster = true;
                console.info('[MasterLock] acquired lock → became Master');
                this.onAcquire?.();

                // 永不 resolve → 锁一直被持有
                // Tab 关闭时浏览器自动释放，其他 Tab 排队获得
                await new Promise<void>((resolve) => {
                    // 存储 resolve 以便 release() 可以主动释放
                    this._releaseResolve = resolve;
                });

                // 释放锁后 → 降级
                this._isMaster = false;
                console.info('[MasterLock] released lock → lost Master');
                this.onRelease?.();
            },
        ).catch((err: unknown) => {
            // AbortError 是主动 release() 导致的，不需要报错
            if (err instanceof DOMException && err.name === 'AbortError') {
                return;
            }
            console.error('[MasterLock] lock request error:', err);
        });
    }

    /**
     * 主动释放 Master 锁
     *
     * - 如果当前是 Master → 释放锁 → 触发 onRelease
     * - 如果正在排队 → 取消排队（abort）
     * - 如果已经不是 Master → no-op
     */
    release(): void {
        if (!this._controlled) {
            return;
        }

        // 解除 callback 中的阻塞 → 锁被释放 → callback 后续代码执行
        if (this._releaseResolve) {
            this._releaseResolve();
            this._releaseResolve = undefined;
        }

        // 如果还在排队（未获得锁），abort 取消排队
        if (!this._isMaster && this._abortController) {
            this._abortController.abort();
        }

        this._controlled = false;
    }

    /**
     * 检测 Web Locks API 是否可用
     */
    private _isWebLocksAvailable(): boolean {
        return typeof navigator !== 'undefined' && 'locks' in navigator;
    }

    /** 用于解除 acquire callback 中的阻塞 */
    private _releaseResolve?: () => void;
}
