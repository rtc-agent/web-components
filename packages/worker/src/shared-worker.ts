import { expose } from 'comlink';
import { WorkerCore } from './worker-core.js';
import type { WorkerCallbacks } from './core-interface.js';

/**
 * SharedWorker 入口
 *
 * 每个连入的 Tab 会触发一次 onconnect，获得一个 MessagePort。
 * 我们为每个 port 创建一个 facade，共享同一个 WorkerCore 实例。
 *
 * - init()：首次调用时初始化 core，后续调用幂等
 * - registerCallback(cb)：把该 Tab 的回调注册到 core 的广播列表
 * - 其他方法：直接代理到 core
 */

const core = new WorkerCore();

const sharedSelf = self as unknown as SharedWorkerGlobalScope;

sharedSelf.onconnect = (e: MessageEvent): void => {
  const port = e.ports[0];

  const facade = {
    init: (config: Parameters<WorkerCore['init']>[0]) => core.init(config),
    registerCallback: (cb: WorkerCallbacks) => core.registerCallback(cb),
    unregisterCallback: (cb: WorkerCallbacks) => core.unregisterCallback(cb),

    // 健康检查（不需要 init）
    ping: () => core.ping(),

    // 连接
    connect: () => core.connect(),
    disconnect: () => core.disconnect(),
    reconnect: () => core.reconnect(),
    getConnectionState: () => core.getConnectionState(),

    // 查询
    listSessions: (...args: Parameters<WorkerCore['listSessions']>) => core.listSessions(...args),
    getSession: (...args: Parameters<WorkerCore['getSession']>) => core.getSession(...args),
    listMessages: (...args: Parameters<WorkerCore['listMessages']>) => core.listMessages(...args),
    getMessage: (...args: Parameters<WorkerCore['getMessage']>) => core.getMessage(...args),
    listRtc: (...args: Parameters<WorkerCore['listRtc']>) => core.listRtc(...args),
    getNextRtcToProcess: (...args: Parameters<WorkerCore['getNextRtcToProcess']>) => core.getNextRtcToProcess(...args),

    // 操作
    sendMessage: (...args: Parameters<WorkerCore['sendMessage']>) => core.sendMessage(...args),
    insertLocalMessage: (...args: Parameters<WorkerCore['insertLocalMessage']>) => core.insertLocalMessage(...args),
    stopTurn: (...args: Parameters<WorkerCore['stopTurn']>) => core.stopTurn(...args),
    compactSession: (...args: Parameters<WorkerCore['compactSession']>) => core.compactSession(...args),
    submitRtcResult: (...args: Parameters<WorkerCore['submitRtcResult']>) => core.submitRtcResult(...args),
    forkSession: (...args: Parameters<WorkerCore['forkSession']>) => core.forkSession(...args),
    deleteSession: (...args: Parameters<WorkerCore['deleteSession']>) => core.deleteSession(...args),
    updateSessionTitle: (...args: Parameters<WorkerCore['updateSessionTitle']>) => core.updateSessionTitle(...args),

    // 生命周期
    close: () => core.close(),
    flushAll: () => core.flushAll(),

    // 额外能力
    initializeVirtualFS: (...args: Parameters<WorkerCore['initializeVirtualFS']>) => core.initializeVirtualFS(...args),
    batchWriteFiles: (...args: Parameters<WorkerCore['batchWriteFiles']>) => core.batchWriteFiles(...args),
    resetOffset: () => core.resetOffset(),

    // virtualFS 代理（主线程 → Worker）
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
