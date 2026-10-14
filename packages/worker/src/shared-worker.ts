import { expose } from 'comlink';
import { WorkerCore } from './worker-core.js';
import type { WorkerCallbacks } from './core-interface.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('SharedWorker');

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
  if (!port) return; // SharedWorker always provides a port; guard for type safety

  // Track the callback registered by this tab for cleanup on abnormal disconnect.
  // When a tab crashes or is force-closed, the port fires a 'close' event.
  // Without cleanup, the Worker retains a reference to the dead tab's callback,
  // causing memory leaks and broadcast errors until _invokeWithFailureTracking
  // eventually removes it (which only happens during active broadcasting).
  let registeredCallback: WorkerCallbacks | null = null;

  port.addEventListener('close', () => {
    log.debug('Tab disconnected, cleaning up callbacks');
    if (registeredCallback) {
      core.unregisterCallback(registeredCallback);
      registeredCallback = null;
    }
    // Also trigger reference-counted teardown if this was the last tab.
    // core.close() without a callback argument just checks reference count
    // and tears down shared resources if no tabs remain.
    if (core.callbackCount === 0) {
      core.close().catch((err) => {
        log.debug('Tab disconnect cleanup failed (non-fatal):', err);
      });
    }
  });

  const facade = {
    init: (config: Parameters<WorkerCore['init']>[0]) => core.init(config),
    registerCallback: (cb: WorkerCallbacks) => {
      core.registerCallback(cb);
      registeredCallback = cb;
    },
    unregisterCallback: (cb: WorkerCallbacks) => {
      core.unregisterCallback(cb);
      if (registeredCallback === cb) {
        registeredCallback = null;
      }
    },
    getCatchUpEvents: (...args: Parameters<WorkerCore['getCatchUpEvents']>) =>
      core.getCatchUpEvents(...args),

    // Health check (does not require init)
    ping: () => core.ping(),

    // Connection
    connect: () => core.connect(),
    disconnect: () => core.disconnect(),
    reconnect: () => core.reconnect(),
    getConnectionState: () => core.getConnectionState(),

    // Queries
    listSessions: (...args: Parameters<WorkerCore['listSessions']>) =>
      core.listSessions(...args),
    getSession: (...args: Parameters<WorkerCore['getSession']>) =>
      core.getSession(...args),
    listMessages: (...args: Parameters<WorkerCore['listMessages']>) =>
      core.listMessages(...args),
    getMessage: (...args: Parameters<WorkerCore['getMessage']>) =>
      core.getMessage(...args),
    listRtc: (...args: Parameters<WorkerCore['listRtc']>) =>
      core.listRtc(...args),
    getNextRtcToProcess: (
      ...args: Parameters<WorkerCore['getNextRtcToProcess']>
    ) => core.getNextRtcToProcess(...args),

    // Debug History
    addDebugHistoryItem: (
      ...args: Parameters<WorkerCore['addDebugHistoryItem']>
    ) => core.addDebugHistoryItem(...args),
    queryDebugHistory: (...args: Parameters<WorkerCore['queryDebugHistory']>) =>
      core.queryDebugHistory(...args),
    countDebugHistory: (...args: Parameters<WorkerCore['countDebugHistory']>) =>
      core.countDebugHistory(...args),
    clearDebugHistory: () => core.clearDebugHistory(),
    batchDeleteDebugHistory: (
      ...args: Parameters<WorkerCore['batchDeleteDebugHistory']>
    ) => core.batchDeleteDebugHistory(...args),

    // Operations
    sendMessage: (...args: Parameters<WorkerCore['sendMessage']>) =>
      core.sendMessage(...args),
    insertLocalMessage: (
      ...args: Parameters<WorkerCore['insertLocalMessage']>
    ) => core.insertLocalMessage(...args),
    stopTurn: (...args: Parameters<WorkerCore['stopTurn']>) =>
      core.stopTurn(...args),
    closeSession: (...args: Parameters<WorkerCore['closeSession']>) =>
      core.closeSession(...args),
    openSession: (...args: Parameters<WorkerCore['openSession']>) =>
      core.openSession(...args),
    compactSession: (...args: Parameters<WorkerCore['compactSession']>) =>
      core.compactSession(...args),
    submitRtcResult: (...args: Parameters<WorkerCore['submitRtcResult']>) =>
      core.submitRtcResult(...args),
    forkSession: (...args: Parameters<WorkerCore['forkSession']>) =>
      core.forkSession(...args),
    deleteSession: (...args: Parameters<WorkerCore['deleteSession']>) =>
      core.deleteSession(...args),
    updateSessionTitle: (
      ...args: Parameters<WorkerCore['updateSessionTitle']>
    ) => core.updateSessionTitle(...args),

    // Lifecycle
    close: (cb?: WorkerCallbacks) => core.close(cb),
    flushAll: () => core.flushAll(),

    // Additional capabilities
    initializeVirtualFS: (
      ...args: Parameters<WorkerCore['initializeVirtualFS']>
    ) => core.initializeVirtualFS(...args),
    batchWriteFiles: (...args: Parameters<WorkerCore['batchWriteFiles']>) =>
      core.batchWriteFiles(...args),
    resetOffset: () => core.resetOffset(),

    // virtualFS proxy (main thread -> Worker)
    virtualFSRead: (...args: Parameters<WorkerCore['virtualFSRead']>) =>
      core.virtualFSRead(...args),
    virtualFSWrite: (...args: Parameters<WorkerCore['virtualFSWrite']>) =>
      core.virtualFSWrite(...args),
    virtualFSLs: (...args: Parameters<WorkerCore['virtualFSLs']>) =>
      core.virtualFSLs(...args),
    virtualFSFind: (...args: Parameters<WorkerCore['virtualFSFind']>) =>
      core.virtualFSFind(...args),
    virtualFSGrep: (...args: Parameters<WorkerCore['virtualFSGrep']>) =>
      core.virtualFSGrep(...args),
    virtualFSQueryByType: (
      ...args: Parameters<WorkerCore['virtualFSQueryByType']>
    ) => core.virtualFSQueryByType(...args),
    virtualFSExists: (...args: Parameters<WorkerCore['virtualFSExists']>) =>
      core.virtualFSExists(...args),
    virtualFSRemove: (...args: Parameters<WorkerCore['virtualFSRemove']>) =>
      core.virtualFSRemove(...args),

    // File Cache & S3 Operations
    cacheFile: (...args: Parameters<WorkerCore['cacheFile']>) =>
      core.cacheFile(...args),
    cacheFilePending: (...args: Parameters<WorkerCore['cacheFilePending']>) =>
      core.cacheFilePending(...args),
    getCachedFile: (...args: Parameters<WorkerCore['getCachedFile']>) =>
      core.getCachedFile(...args),
    evictExpiredCache: () => core.evictExpiredCache(),
    evictCache: (...args: Parameters<WorkerCore['evictCache']>) =>
      core.evictCache(...args),
    uploadFile: (...args: Parameters<WorkerCore['uploadFile']>) =>
      core.uploadFile(...args),
    downloadFile: (...args: Parameters<WorkerCore['downloadFile']>) =>
      core.downloadFile(...args),
    deleteFile: (...args: Parameters<WorkerCore['deleteFile']>) =>
      core.deleteFile(...args),
    cancelFileOperation: (
      ...args: Parameters<WorkerCore['cancelFileOperation']>
    ) => core.cancelFileOperation(...args),

    // MD5 calculation (runs in Worker thread)
    calculateFileMD5: (...args: Parameters<WorkerCore['calculateFileMD5']>) =>
      core.calculateFileMD5(...args),

    // S3 metadata operations
    headFile: (...args: Parameters<WorkerCore['headFile']>) =>
      core.headFile(...args),
    getPresignedUrl: (...args: Parameters<WorkerCore['getPresignedUrl']>) =>
      core.getPresignedUrl(...args),

    // File list & count
    listFiles: (...args: Parameters<WorkerCore['listFiles']>) =>
      core.listFiles(...args),
    countFiles: (...args: Parameters<WorkerCore['countFiles']>) =>
      core.countFiles(...args),
    syncPendingFiles: () => core.syncPendingFiles(),
    resumeInterruptedUploads: () => core.resumeInterruptedUploads(),
    getCacheStats: () => core.getCacheStats(),
    updateFileMetadata: (
      ...args: Parameters<WorkerCore['updateFileMetadata']>
    ) => core.updateFileMetadata(...args),
  };

  expose(facade, port);
};
