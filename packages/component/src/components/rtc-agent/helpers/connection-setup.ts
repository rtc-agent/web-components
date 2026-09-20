/**
 * Connection setup helpers for <rtc-agent>.
 *
 * Encapsulates the connection retry logic and connection state listener setup.
 * Extracted from rtc-agent.ts to keep the root component lean.
 */
import { msg } from '@lit/localize';
import { loadScenariosContent } from '../../../core/scenario-loader.js';
import { RtcProcessor } from '@rtc-agent/persistence';
import type { PersistenceLayer, LocalRtc } from '@rtc-agent/persistence';
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
        connect(): Promise<void>;
        getConnectionState(): Promise<ConnectionState>;
        onConnectionStateChange(
            cb: (event: { state: ConnectionState }) => void,
        ): () => void;
    };
    message: { persistence?: PersistenceLayer };
    session: { persistence?: PersistenceLayer };
    notification: { persistence?: PersistenceLayer };
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
    onConnectionStateChange?: (state: ConnectionState) => void;
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
    try {
        await deps.persistence.connect();

        if (deps.persistence.layer) {
            deps.message.persistence = deps.persistence.layer;
            deps.session.persistence = deps.persistence.layer;
            deps.notification.persistence = deps.persistence.layer;

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
                ): Array<{ path: string; content: string }>;
            } | null;
            deps.logger.debug("After connect, registry:", registry ? "set" : "null");
            if (registry?.generateAllDocsContent) {
                const files = registry.generateAllDocsContent(0);
                if (files.length > 0) {
                    const workerBridge = (
                        deps.persistence as unknown as {
                            workerBridge: {
                                core: { batchWriteFiles(files: unknown[]): Promise<void> };
                            };
                        }
                    ).workerBridge;
                    await workerBridge.core.batchWriteFiles(files);
                    deps.logger.debug("batchWriteFiles completed");
                }
            }

            // Reload scenarios (if scenariosURL was set before DB initialization).
            if (deps.scenariosURL) {
                try {
                    const files = await loadScenariosContent(deps.scenariosURL);
                    const workerBridge = (
                        deps.persistence as unknown as {
                            workerBridge: {
                                core: { batchWriteFiles(files: unknown[]): Promise<void> };
                            };
                        }
                    ).workerBridge;
                    await workerBridge.core.batchWriteFiles(files);
                    deps.logger.info(
                        `Re-loaded ${files.length} scenarios from ${deps.scenariosURL}`,
                    );
                } catch (err) {
                    deps.logger.warn(
                        `Failed to re-load scenarios from ${deps.scenariosURL}:`,
                        err,
                    );
                }
            }

            // Initialize RTC processor and resume pending tasks.
            const rtcProcessor = await initRtcProcessor(deps);

            // Listen for connection state changes.
            const { unsubConnection, connectionState } =
                await setupConnectionListener(deps);

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

        deps.toast.show(msg(`连接失败: ${errorMessage}`), "error");

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
async function initRtcProcessor(deps: ConnectionDeps): Promise<RtcProcessor> {
    const rtcProcessor = new RtcProcessor(deps.persistence.layer!);
    rtcProcessor.setConfirmDialog((rtc) => deps.showToolConfirm(rtc));
    rtcProcessor.setAskUserDialog(
        (rtc) =>
            deps.showAskUser(rtc) as ReturnType<
                typeof rtcProcessor.setAskUserDialog
            > extends (fn: (rtc: LocalRtc) => infer R) => unknown
                ? R
                : never,
    );
    rtcProcessor.setMode(deps.mode.value.state.currentMode);

    // Inject MasterLock.
    const masterLock = deps.persistence.masterLock;
    if (masterLock) {
        rtcProcessor.setMaster(
            masterLock as unknown as Parameters<typeof rtcProcessor.setMaster>[0],
        );
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
    let currentState = connectionState;
    const unsubConnection = deps.persistence.onConnectionStateChange((event) => {
        currentState = event.state;
        // Notify the component to update its UI state
        deps.onConnectionStateChange?.(event.state);
    });

    return { unsubConnection, connectionState: currentState };
}
