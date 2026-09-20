import { expose } from 'comlink';
import { WorkerCore } from './worker-core.js';
import type { WorkerCallbacks } from './core-interface.js';

/**
 * SharedWorker entry point.
 *
 * Each connecting Tab triggers an onconnect event, receiving a MessagePort.
 * We create a facade for each port, all sharing the same WorkerCore instance.
 *
 * - init(): initializes core on first call; subsequent calls are idempotent
 * - registerCallback(cb): registers this Tab's callbacks to core's broadcast list
 * - Other methods: direct proxy to core
 */

const core = new WorkerCore();

const sharedSelf = self as unknown as SharedWorkerGlobalScope;

sharedSelf.onconnect = (e: MessageEvent): void => {
  const port = e.ports[0];

  const facade = {
    init: (config: Parameters<WorkerCore['init']>[0]) => core.init(config),
    registerCallback: (cb: WorkerCallbacks) => core.registerCallback(cb),
    unregisterCallback: (cb: WorkerCallbacks) => core.unregisterCallback(cb),

    // Health check (does not require init)
    ping: () => core.ping(),

    // Connection
    connect: () => core.connect(),
    disconnect: () => core.disconnect(),
    reconnect: () => core.reconnect(),
    getConnectionState: () => core.getConnectionState(),

    // Queries
    listSessions: (...args: Parameters<WorkerCore['listSessions']>) => core.listSessions(...args),
    getSession: (...args: Parameters<WorkerCore['getSession']>) => core.getSession(...args),
    listMessages: (...args: Parameters<WorkerCore['listMessages']>) => core.listMessages(...args),
    getMessage: (...args: Parameters<WorkerCore['getMessage']>) => core.getMessage(...args),
    listRtc: (...args: Parameters<WorkerCore['listRtc']>) => core.listRtc(...args),
    getNextRtcToProcess: (...args: Parameters<WorkerCore['getNextRtcToProcess']>) => core.getNextRtcToProcess(...args),

    // Operations
    sendMessage: (...args: Parameters<WorkerCore['sendMessage']>) => core.sendMessage(...args),
    insertLocalMessage: (...args: Parameters<WorkerCore['insertLocalMessage']>) => core.insertLocalMessage(...args),
    stopTurn: (...args: Parameters<WorkerCore['stopTurn']>) => core.stopTurn(...args),
    closeSession: (...args: Parameters<WorkerCore['closeSession']>) => core.closeSession(...args),
    openSession: (...args: Parameters<WorkerCore['openSession']>) => core.openSession(...args),
    compactSession: (...args: Parameters<WorkerCore['compactSession']>) => core.compactSession(...args),
    submitRtcResult: (...args: Parameters<WorkerCore['submitRtcResult']>) => core.submitRtcResult(...args),
    forkSession: (...args: Parameters<WorkerCore['forkSession']>) => core.forkSession(...args),
    deleteSession: (...args: Parameters<WorkerCore['deleteSession']>) => core.deleteSession(...args),
    updateSessionTitle: (...args: Parameters<WorkerCore['updateSessionTitle']>) => core.updateSessionTitle(...args),

    // Lifecycle
    close: () => core.close(),
    flushAll: () => core.flushAll(),

    // Additional capabilities
    initializeVirtualFS: (...args: Parameters<WorkerCore['initializeVirtualFS']>) => core.initializeVirtualFS(...args),
    batchWriteFiles: (...args: Parameters<WorkerCore['batchWriteFiles']>) => core.batchWriteFiles(...args),
    resetOffset: () => core.resetOffset(),

    // virtualFS proxy (main thread -> Worker)
    virtualFSRead: (...args: Parameters<WorkerCore['virtualFSRead']>) => core.virtualFSRead(...args),
    virtualFSWrite: (...args: Parameters<WorkerCore['virtualFSWrite']>) => core.virtualFSWrite(...args),
    virtualFSLs: (...args: Parameters<WorkerCore['virtualFSLs']>) => core.virtualFSLs(...args),
    virtualFSFind: (...args: Parameters<WorkerCore['virtualFSFind']>) => core.virtualFSFind(...args),
    virtualFSGrep: (...args: Parameters<WorkerCore['virtualFSGrep']>) => core.virtualFSGrep(...args),
    virtualFSQueryByType: (...args: Parameters<WorkerCore['virtualFSQueryByType']>) => core.virtualFSQueryByType(...args),
    virtualFSExists: (...args: Parameters<WorkerCore['virtualFSExists']>) => core.virtualFSExists(...args),
    virtualFSRemove: (...args: Parameters<WorkerCore['virtualFSRemove']>) => core.virtualFSRemove(...args),
  };

  expose(facade, port);
};
