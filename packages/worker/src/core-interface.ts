import type { ContentData } from '@rtc-agent/protocol';
import type { ConnectionState, ConnectionStateEvent } from '@rtc-agent/client';
import type { PersistenceConfig, AgentMdConfig } from '@rtc-agent/persistence';
import type { UIUpdateEvent, LocalSession, LocalMessage, LocalRtc } from '@rtc-agent/persistence';

/**
 * Worker 侧回调：每个连入的 Tab 各自注册一份
 *
 * - onUIUpdate：Worker 收到实体变更时广播到该 Tab
 * - requestToken：Centrifuge 需要 token 时向任意 Tab 请求
 * - onConnectionStateChange：Worker 中 RTCAgentClient 连接状态变更时广播到该 Tab
 */
export interface WorkerCallbacks {
  onUIUpdate: (event: UIUpdateEvent) => void;
  requestToken: () => Promise<string>;
  onConnectionStateChange: (event: ConnectionStateEvent) => void;
}

/**
 * WorkerPersistenceCore：Worker 侧对外暴露的接口
 *
 * - init()：初始化共享状态（仅首个 Tab 真正执行，后续调用幂等）
 * - registerCallback / unregisterCallback：管理每个 Tab 的回调
 * - 其他方法透传 PersistenceLayer
 */
export interface WorkerPersistenceCore {
  init(config: PersistenceConfig): Promise<void>;

  /** 注册一个 Tab 的回调（onconnect 时由 facade 调用） */
  registerCallback(cb: WorkerCallbacks): void;
  /** 取消注册一个 Tab 的回调 */
  unregisterCallback(cb: WorkerCallbacks): void;

  // ========== 连接 ==========
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;
  getConnectionState(): Promise<ConnectionState>;

  // ========== 查询 ==========
  listSessions(cursor?: string, limit?: number): Promise<LocalSession[]>;
  getSession(clientId: string): Promise<LocalSession | undefined>;
  listMessages(
    sessionClientId: string,
    cursor?: number,
    limit?: number,
    direction?: 'backward' | 'forward',
  ): Promise<LocalMessage[]>;
  getMessage(clientId: string): Promise<LocalMessage | undefined>;
  listRtc(
    sessionClientId: string,
    cursor?: number,
    limit?: number,
  ): Promise<LocalRtc[]>;
  getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined>;

  // ========== 操作 ==========
  sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }>;

  stopTurn(sessionClientId: string): Promise<void>;

  submitRtcResult(params: {
    rtcClientId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): Promise<void>;

  forkSession(params: {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    newMessageClientId: string;
    content: ContentData;
    limit?: number;
  }): Promise<{ session: LocalSession; message: LocalMessage }>;

  // ========== 生命周期 ==========
  close(): Promise<void>;
  flushAll(): Promise<void>;

  // ========== Worker 模式额外能力 ==========

  /**
   * 初始化虚拟文件系统（AGENT.md）
   *
   * Worker 模式下 virtualFS 运行在 Worker 内（共享同一 IndexedDB），
   * 因此需要通过 Comlink 调用，而非在主线程直接调用 initializeVirtualFS。
   */
  initializeVirtualFS(config?: AgentMdConfig): Promise<void>;

  /**
   * 重置 OffsetManager 缓存（等价于 getOffsetManager().reset()）
   *
   * Worker 模式下主线程无法访问 Worker 内的 OffsetManager，
   * 通过此方法透传 reset 调用。
   */
  resetOffset(): Promise<void>;
}
