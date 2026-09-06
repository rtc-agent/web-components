/**
 * Worker Configuration
 *
 * Feature flags and settings for SharedWorker mode.
 */

/** Worker-related feature flags */
export const WORKER_CONFIG = {
    /**
     * Enable SharedWorker mode.
     *
     * When true, PersistenceController creates a SharedWorker and communicates
     * via Comlink. When false (default), falls back to direct PersistenceLayer.
     */
    useSharedWorker: false,
} as const;
