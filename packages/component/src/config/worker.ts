/**
 * Worker Configuration
 *
 * Feature flags and settings for SharedWorker mode.
 *
 * 设计：
 * - 默认关闭（useSharedWorker: false）
 * - 通过 <rtc-agent shared-worker> attribute 或 JS 注入开启
 * - PersistenceController 在构造时读取并缓存到实例变量，
 *   后续修改 WORKER_CONFIG 不会影响已构造的 controller
 */

/** Worker-related feature flags */
export interface WorkerConfig {
    /**
     * Enable SharedWorker mode.
     *
     * When true, PersistenceController creates a SharedWorker and communicates
     * via Comlink. When false (default), falls back to direct PersistenceLayer.
     */
    useSharedWorker: boolean;
}

/**
 * 全局默认配置
 *
 * 可变：宿主可在创建 <rtc-agent> 之前修改，影响后续创建的实例。
 * 已通过 attribute 设置的实例不受后续修改影响。
 */
export const WORKER_CONFIG: WorkerConfig = {
    useSharedWorker: false,
};
