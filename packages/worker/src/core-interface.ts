import type { ContentData } from '@rtc-agent/protocol';
import type { ConnectionState, ConnectionStateEvent } from '@rtc-agent/client';
import type { PersistenceConfig, AgentMdConfig } from '@rtc-agent/persistence';
import type { UIUpdateEvent, LocalSession, LocalMessage, LocalRtc } from '@rtc-agent/persistence';

/**
 * Worker 侧回调：每个连入的 Tab 各自注册一份
 *
 * - onUIUpdate：Worker 收到实体变更时广播到该 Tab
 * - requestToken：Centrifuge 需要 token 时向任意 Tab 请求
 * - requestTokenRefresh：Centrifuge 检测到 token 过期时向任意 Tab 请求刷新
 * - onConnectionStateChange：Worker 中 RTCAgentClient 连接状态变更时广播到该 Tab
 */
export interface WorkerCallbacks {
  onUIUpdate: (event: UIUpdateEvent) => void;
  requestToken: () => Promise<string>;
  requestTokenRefresh: () => Promise<'refresh' | 'relogin'>;
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

  /** 插入本地消息（不发送到服务器） */
  insertLocalMessage(params: {
    sessionClientId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    creatorKind?: string;
    creatorRefId?: string;
  }): Promise<LocalMessage>;

  stopTurn(sessionClientId: string): Promise<void>;

  compactSession(sessionClientId: string, customInstruction?: string): Promise<void>;

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

  /** 软删除会话（本地乐观更新 + 异步 RPC 同步） */
  deleteSession(sessionClientId: string): Promise<void>;

  /** 更新会话标题（本地乐观更新 + 异步 RPC 同步） */
  updateSessionTitle(sessionClientId: string, title: string): Promise<void>;

  // ========== 生命周期 ==========
  close(): Promise<void>;
  flushAll(): Promise<void>;

  // ========== 额外能力 ==========

  /**
   * 初始化虚拟文件系统（AGENT.md）
   *
   * VirtualFS 运行在 Worker 内（共享同一 IndexedDB），
   * 因此需要通过 Comlink 调用，而非在主线程直接调用 initializeVirtualFS。
   */
  initializeVirtualFS(config?: AgentMdConfig): Promise<void>;

  /**
   * 批量写入虚拟文件系统
   *
   * 主线程无法直接访问 Worker 内的 VirtualFS/IndexedDB，
   * 通过此方法将文件内容发送到 Worker 内写入。
   */
  batchWriteFiles(files: Array<{
    path: string;
    content: string;
    metadata?: Partial<{
      name: string;
      description: string;
      tags: string[];
    }>;
  }>): Promise<void>;

  /**
   * 重置 OffsetManager 缓存（等价于 getOffsetManager().reset()）
   *
   * 主线程无法访问 Worker 内的 OffsetManager，
   * 通过此方法透传 reset 调用。
   */
  resetOffset(): Promise<void>;

  // ========== virtualFS 代理（主线程 → Worker） ==========

  /**
   * 读取虚拟文件（Worker 内执行 getDatabase + 读取）
   *
   * 主线程不可直接访问 IndexedDB，
   * 通过此方法将 virtualFS.read 调用代理到 Worker。
   */
  virtualFSRead(path: string, offset?: number, limit?: number): Promise<string>;

  /**
   * 写入虚拟文件（Worker 内执行）
   */
  virtualFSWrite(
    path: string,
    content: string,
    mode: 'overwrite' | 'append',
    metadataOverride?: Partial<{
      name: string;
      description: string;
      tags: string[];
    }>,
  ): Promise<number>;

  /**
   * 列出目录内容（Worker 内执行）
   */
  virtualFSLs(path?: string): Promise<string[]>;

  /**
   * 按文件名搜索（Worker 内执行）
   */
  virtualFSFind(pattern: string, path?: string): Promise<string[]>;

  /**
   * 搜索文件内容（Worker 内执行）
   */
  virtualFSGrep(
    pattern: string,
    path?: string,
    caseSensitive?: boolean,
    maxResults?: number,
  ): Promise<Array<{ file: string; line: string; lineNumber: number }>>;

  /**
   * 按类型查询文件（Worker 内执行）
   *
   * 返回值类型与 persistence 包的 FileSystemEntry 一致，
   * 通过 Comlink 传输时 Date 字段保留为 Date 实例。
   */
  virtualFSQueryByType(type: string): Promise<Array<{
    path: string;
    type: string;
    content: string;
    metadata: {
      name: string;
      description: string;
      tags?: string[];
      group?: string;
      createdAt: Date;
      updatedAt: Date;
    };
  }>>;

  /**
   * 检查文件是否存在（Worker 内执行）
   */
  virtualFSExists(path: string): Promise<boolean>;

  /**
   * 删除文件（Worker 内执行）
   */
  virtualFSRemove(path: string): Promise<void>;
}
