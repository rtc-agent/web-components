/**
 * Connection setup helpers for <rtc-agent>.
 *
 * Encapsulates the connection retry logic and connection state listener setup.
 * Extracted from rtc-agent.ts to keep the root component lean.
 */
import { msg, str } from '@lit/localize';
import { loadScenariosContent } from '../../../core/scenario-loader.js';
import { RtcProcessor } from '@rtc-agent/persistence';
import type { PersistenceLayer, LocalRtc, AskUserDialogFn } from '@rtc-agent/persistence';
import type { WorkerBridge } from '../../../worker-bridge.js';
import type { ConnectionState } from '@rtc-agent/client';
import type { Logger } from '@rtc-agent/client';
import type { FileNode } from '../../../types/index.js';
import type { Mode } from '../../../types/index.js';
import type { ToastActions } from '../../../controllers/toast.controller.js';

// ── Dependency interfaces ──

export interface ConnectionDeps {
    persistence: {
        layer: PersistenceLayer | undefined;
        masterLock: { isMaster: boolean; onAcquire?: () => void } | undefined;
        workerBridge?: WorkerBridge;
        connect(): Promise<void>;
        getConnectionState(): Promise<ConnectionState>;
        onConnectionStateChange(
            cb: (event: { state: ConnectionState; reason?: string }) => void,
        ): () => void;
    };
    message: { persistence?: PersistenceLayer };
    session: { persistence?: PersistenceLayer };
    notification: { persistence?: PersistenceLayer };
    functionDebug: { workerBridge: WorkerBridge | null };
    activity: { active: string };
    fileExplorer: { actions: { setRoot(root: FileNode): void } };
    toast: ToastActions;
    skill: { actions: { getRegistry(): unknown } };
    mode: { value: { state: { currentMode: Mode } } };
    scenariosURL: string;
    loadFileTree: () => Promise<void>;
    restoreEditorAreaContent: () => Promise<void>;
    showToolConfirm: (rtc: LocalRtc) => Promise<boolean>;
    showAskUser: (rtc: LocalRtc) => Promise<unknown>;
    loadSessions: () => void;
    onConnectionStateChange?: (state: ConnectionState, reason?: string) => void;
    logger: Logger;
}

export interface ConnectionResult {
    connectionFailed: boolean;
    connectionError: string;
    rtcProcessor?: RtcProcessor;
    unsubConnection?: () => void;
    connectionState: ConnectionState;
}

// ── Public API ──

/**
 * Connect to the persistence layer with error handling and retry.
 *
 * If the connection fails, returns `{connectionFailed: true, connectionError: ...}`
 * so the caller can update UI state (e.g. show retry button in title bar).
 *
 * Post-connection steps:
 * 1. Inject persistence layer into Message/Session/Notification controllers.
 * 2. Load file tree if 'files' activity is active.
 * 3. Restore editor area content from VFS.
 * 4. Generate and write agent docs from FunctionRegistry.
 * 5. Reload scenarios from scenariosURL.
 * 6. Initialize RTC processor and resume pending tasks.
 * 7. Set up connection state listener.
 * 8. Load sessions from DB.
 */
export async function connectWithRetry(
    deps: ConnectionDeps,
): Promise<ConnectionResult> {
    deps.logger.info('[connectWithRetry] Starting connection...');
    try {
        deps.logger.info('[connectWithRetry] Calling persistence.connect()...');
        await deps.persistence.connect();
        deps.logger.info('[connectWithRetry] persistence.connect() completed');

        if (deps.persistence.layer) {
            deps.logger.info('[connectWithRetry] persistence.layer exists, proceeding with setup...');
            deps.message.persistence = deps.persistence.layer;
            deps.session.persistence = deps.persistence.layer;
            deps.notification.persistence = deps.persistence.layer;

            // Inject workerBridge into FunctionDebugController (for IndexedDB history persistence)
            if (deps.persistence.workerBridge) {
                deps.functionDebug.workerBridge = deps.persistence.workerBridge;
            }

            // If the active activity is 'files' after restore, auto-load the file tree.
            // (In normal flow, the file tree loads on activity-change events,
            //  but a page refresh won't trigger activity-change, so we trigger it manually.)
            if (deps.activity.active === "files") {
                await deps.loadFileTree();
            }

            // Restore Editor Area content for already-open files after refresh.
            await deps.restoreEditorAreaContent();

            // Main thread generates doc content, sends to Worker via batchWriteFiles.
            const registry = deps.skill.actions.getRegistry() as {
                generateAllDocsContent?(
                    depth: number,
                ): Promise<{ files: Array<{ path: string; content: string }>; deletePaths: string[] }>;
            } | null;
            if (registry?.generateAllDocsContent) {
                const { files, deletePaths } = await registry.generateAllDocsContent(0);
                if (files.length > 0 && deps.persistence.workerBridge) {
                    await deps.persistence.workerBridge.core.batchWriteFiles(files, deletePaths);
                }
            }

            // Reload scenarios (if scenariosURL was set before DB initialization).
            if (deps.scenariosURL) {
                try {
                    const { files, deletePaths } = await loadScenariosContent(deps.scenariosURL);
                    if (deps.persistence.workerBridge) {
                        await deps.persistence.workerBridge.core.batchWriteFiles(files, deletePaths);
                    }
                    deps.logger.info(
                        `Re-loaded ${files.length} scenarios from ${deps.scenariosURL}, deleted orphans: ${deletePaths.length}`,
                    );
                } catch (err) {
                    deps.logger.warn(
                        `Failed to re-load scenarios from ${deps.scenariosURL}:`,
                        err,
                    );
                }
            }

            // Initialize RTC processor and resume pending tasks.
            deps.logger.info('[connectWithRetry] Initializing RTC processor...');
            const rtcProcessor = await initRtcProcessor(deps.persistence.layer, deps);
            deps.logger.info('[connectWithRetry] RTC processor initialized');

            // Listen for connection state changes.
            deps.logger.info('[connectWithRetry] Setting up connection listener...');
            const { unsubConnection, connectionState } =
                await setupConnectionListener(deps);
            deps.logger.info('[connectWithRetry] Connection listener setup complete, state:', connectionState);

            // Load sessions from DB so the panel isn't empty after refresh.
            deps.loadSessions();

            return {
                connectionFailed: false,
                connectionError: "",
                rtcProcessor,
                unsubConnection,
                connectionState,
            };
        }

        return {
            connectionFailed: false,
            connectionError: "",
            connectionState: "disconnected",
        };
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        deps.logger.error("Connection failed:", errorMessage);

        deps.toast.show(msg(str`连接失败: ${errorMessage}`), "error");

        return {
            connectionFailed: true,
            connectionError: errorMessage,
            connectionState: "disconnected",
        };
    }
}

/**
 * Initialize the RTC processor and resume pending tasks.
 *
 * Auto-injects MasterLock and triggers processLoop when becoming Master.
 */
async function initRtcProcessor(
    layer: PersistenceLayer,
    deps: ConnectionDeps,
): Promise<RtcProcessor> {
    const rtcProcessor = new RtcProcessor(layer);
    rtcProcessor.setConfirmDialog((rtc) => deps.showToolConfirm(rtc));
    rtcProcessor.setAskUserDialog(
        (rtc) => deps.showAskUser(rtc) as ReturnType<AskUserDialogFn>,
    );
    rtcProcessor.setMode(deps.mode.value.state.currentMode);

    // Inject MasterLock.
    const masterLock = deps.persistence.masterLock;
    if (masterLock) {
        rtcProcessor.setMaster(masterLock);
        // When this tab becomes Master, trigger RTC processing (handles crash recovery).
        const prevOnAcquire = masterLock.onAcquire;
        masterLock.onAcquire = () => {
            prevOnAcquire?.();
            rtcProcessor.onRtcUpdate().catch((err) => {
                deps.logger.error("onRtcUpdate on master acquire failed:", err);
            });
        };
    }

    await rtcProcessor.onRtcUpdate();
    return rtcProcessor;
}

/**
 * Set up connection state listener.
 *
 * Uses PersistenceController.onConnectionStateChange to get connection state change events.
 */
async function setupConnectionListener(
    deps: ConnectionDeps,
): Promise<{ unsubConnection: () => void; connectionState: ConnectionState }> {
    // Use unified API to get initial connection state.
    const connectionState = await deps.persistence.getConnectionState();

    // Use unified API to listen for connection state changes.
    const unsubConnection = deps.persistence.onConnectionStateChange((event) => {
        deps.logger.info('[connection-setup] received connection state change:', event.state, 'reason:', event.reason);

        // Notify the component to update its UI state
        deps.onConnectionStateChange?.(event.state, event.reason);
    });

    return { unsubConnection, connectionState };
}
