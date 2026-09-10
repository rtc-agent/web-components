import {
  createPersistenceLayer,
  getUIUpdateBus,
  getOffsetManager,
  initializeVirtualFS,
  virtualFS,
  type PersistenceConfig,
  type AgentMdConfig,
  type UIUpdateEvent,
  type LocalSession,
  type LocalMessage,
  type LocalRtc,
} from '@rtc-agent/persistence';
import type { ContentData } from '@rtc-agent/protocol';
import type { ConnectionState, ConnectionStateEvent, TokenExpiredAction } from '@rtc-agent/client';
import type { WorkerCallbacks, WorkerPersistenceCore } from './core-interface.js';

type PersistenceLayer = ReturnType<typeof createPersistenceLayer>;

/**
 * WorkerPersistenceCore 实现
 *
 * - 包装 PersistenceLayer，透传所有查询/操作方法
 * - 订阅 UIUpdateBus，把事件广播给所有已注册的 Tab 回调
 * - Token 请求：转发给任一已注册的 requestToken 回调
 */
export class WorkerCore implements WorkerPersistenceCore {
  private layer: PersistenceLayer | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;

  /** 所有连入 Tab 的回调集合 */
  private callbacks = new Set<WorkerCallbacks>();

  /**
   * 初始化共享状态
   *
   * - 创建 PersistenceLayer（内部持有 RTCAgentClient + IndexedDB + EntityRepository）
   * - 订阅 UIUpdateBus，用于向所有 Tab 广播
   * - 重复调用幂等（忽略后续 init）
   */
  async init(config: PersistenceConfig): Promise<void> {
    if (this.layer) {
      console.warn('[WorkerCore] already initialized, ignoring init()');
      return;
    }

    // 把 RTCAgentClient 的 getToken / onTokenExpired 桥接到 callbacks
    // 注意：此时 callbacks 还是空的，但回调会在 connect() 时才被调用
    const bridgedConfig: PersistenceConfig = {
      ...config,
      client: {
        ...config.client,
        getToken: () => this.requestToken(),
        onTokenExpired: () => this.requestTokenRefresh(),
      },
    };

    this.layer = createPersistenceLayer(bridgedConfig);

    // 订阅 UIUpdateBus，把事件广播给所有注册的回调
    const bus = getUIUpdateBus();
    this.unsubscribeBus = bus.subscribe((event: UIUpdateEvent) => {
      this.broadcastUIUpdate(event);
    });
  }

  /**
   * 注册一个 Tab 的回调
   */
  registerCallback(cb: WorkerCallbacks): void {
    this.callbacks.add(cb);
  }

  /**
   * 取消注册一个 Tab 的回调
   */
  unregisterCallback(cb: WorkerCallbacks): void {
    this.callbacks.delete(cb);
  }

  // ========== 连接 ==========

  async connect(): Promise<void> {
    console.log('[WorkerCore] connect() called');
    const layer = this.ensureLayer();
    console.log('[WorkerCore] calling layer.connect()');
    await layer.connect();
    console.log('[WorkerCore] layer.connect() returned, client state:', layer.getClient().getConnectionState());
    // 订阅 RTCAgentClient 连接状态变更，广播给所有 Tab
    this._subscribeConnectionState(layer);
    console.log('[WorkerCore] connection state subscribed, returning from connect()');
  }

  disconnect(): void {
    const layer = this.ensureLayer();
    this._unsubscribeConnectionState();
    layer.disconnect();
  }

  async reconnect(): Promise<void> {
    const layer = this.ensureLayer();
    await layer.reconnect();
  }

  async getConnectionState(): Promise<ConnectionState> {
    const layer = this.ensureLayer();
    return layer.getClient().getConnectionState();
  }

  // ========== 查询 ==========

  async listSessions(cursor?: string, limit?: number): Promise<LocalSession[]> {
    const layer = this.ensureLayer();
    return layer.listSessions(cursor, limit);
  }

  async getSession(clientId: string): Promise<LocalSession | undefined> {
    const layer = this.ensureLayer();
    return layer.getSession(clientId);
  }

  async listMessages(
    sessionClientId: string,
    cursor?: number,
    limit?: number,
    direction?: 'backward' | 'forward',
  ): Promise<LocalMessage[]> {
    const layer = this.ensureLayer();
    return layer.listMessages(sessionClientId, cursor, limit, direction);
  }

  async getMessage(clientId: string): Promise<LocalMessage | undefined> {
    const layer = this.ensureLayer();
    return layer.getMessage(clientId);
  }

  async listRtc(
    sessionClientId: string,
    cursor?: number,
    limit?: number,
  ): Promise<LocalRtc[]> {
    const layer = this.ensureLayer();
    return layer.listRtc(sessionClientId, cursor, limit);
  }

  async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
    const layer = this.ensureLayer();
    return layer.getNextRtcToProcess(sessionClientId);
  }

  // ========== 操作 ==========

  async sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const layer = this.ensureLayer();
    return layer.sendMessage(params);
  }

  async insertLocalMessage(params: {
    sessionClientId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    creatorKind?: string;
    creatorRefId?: string;
  }): Promise<LocalMessage> {
    const layer = this.ensureLayer();
    return layer.insertLocalMessage(params);
  }

  async stopTurn(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.stopTurn(sessionClientId);
  }

  async compactSession(sessionClientId: string, customInstruction?: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.compactSession(sessionClientId, customInstruction);
  }

  async submitRtcResult(params: {
    rtcClientId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): Promise<void> {
    const layer = this.ensureLayer();
    return layer.submitRtcResult(params);
  }

  async forkSession(params: {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    newMessageClientId: string;
    content: ContentData;
    limit?: number;
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const layer = this.ensureLayer();
    return layer.forkSession(params);
  }

  async deleteSession(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.deleteSession(sessionClientId);
  }

  async updateSessionTitle(sessionClientId: string, title: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.updateSessionTitle(sessionClientId, title);
  }

  // ========== 生命周期 ==========

  async close(): Promise<void> {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    this._unsubscribeConnectionState();
    if (this.layer) {
      await this.layer.close();
      this.layer = null;
    }
    this.callbacks.clear();
  }

  async flushAll(): Promise<void> {
    const layer = this.ensureLayer();
    return layer.flushAll();
  }

  async initializeVirtualFS(config: AgentMdConfig = {}): Promise<void> {
    // virtualFS 内部通过 getDatabase() 访问同一 IndexedDB（Worker 内共享）
    await initializeVirtualFS(config);
  }

  async batchWriteFiles(files: Array<{
    path: string;
    content: string;
    metadata?: Partial<{
      name: string;
      description: string;
      tags: string[];
    }>;
  }>): Promise<void> {
    console.log('[WorkerCore] batchWriteFiles called, files count:', files.length);
    for (const file of files) {
      // 根据文件路径决定写入模式
      // - /AGENT.md 和 /scenarios/*.md：使用 'create-new'（文件存在时不覆盖）
      // - /functions/*.md 和其他文件：使用 'overwrite'（总是覆盖）
      const mode = this._getWriteModeForPath(file.path);
      await virtualFS.write(file.path, file.content, mode, file.metadata);
    }
    console.log('[WorkerCore] batchWriteFiles completed');
    // 批量写入只发一次广播，避免逐文件通知
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'updated',
      entityId: '',
      field: 'batch',
      oldValue: undefined,
      newValue: undefined,
    });
  }

  /**
   * 根据文件路径决定写入模式
   *
   * - /AGENT.md：使用 'create-new'（保护用户编辑的内容）
   * - /scenarios/*.md：使用 'create-new'（保护用户编辑的内容）
   * - /functions/*.md 和其他文件：使用 'overwrite'（总是覆盖，保持最新）
   */
  private _getWriteModeForPath(path: string): 'overwrite' | 'append' | 'create-new' {
    // /AGENT.md
    if (path === '/AGENT.md') {
      return 'create-new';
    }
    // /scenarios/*.md（但不包括 /scenarios/INDEX.md）
    if (path.startsWith('/scenarios/') && path !== '/scenarios/INDEX.md') {
      return 'create-new';
    }
    // 其他文件（包括 /functions/*.md 和索引文件）
    return 'overwrite';
  }

  async resetOffset(): Promise<void> {
    await getOffsetManager().reset();
  }

  // ========== virtualFS 代理（主线程 → Worker） ==========

  async virtualFSRead(path: string, offset?: number, limit?: number): Promise<string> {
    return virtualFS.read(path, offset, limit);
  }

  async virtualFSWrite(
    path: string,
    content: string,
    mode: 'overwrite' | 'append' = 'overwrite',
    metadataOverride?: Partial<{
      name: string;
      description: string;
      tags: string[];
    }>,
  ): Promise<number> {
    const result = await virtualFS.write(path, content, mode, metadataOverride);
    // 广播文件变更事件给所有标签页
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'updated',
      entityId: path,
      field: 'write',
      oldValue: undefined,
      newValue: undefined,
    });
    return result;
  }

  async virtualFSLs(path?: string): Promise<string[]> {
    return virtualFS.ls(path);
  }

  async virtualFSFind(pattern: string, path?: string): Promise<string[]> {
    return virtualFS.find(pattern, path);
  }

  async virtualFSGrep(
    pattern: string,
    path?: string,
    caseSensitive?: boolean,
    maxResults?: number,
  ): Promise<Array<{ file: string; line: string; lineNumber: number }>> {
    return virtualFS.grep(pattern, path, caseSensitive, maxResults);
  }

  async virtualFSQueryByType(type: string): Promise<Array<{
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
  }>> {
    return virtualFS.queryByType(type as any) as any;
  }

  async virtualFSExists(path: string): Promise<boolean> {
    return virtualFS.exists(path);
  }

  async virtualFSRemove(path: string): Promise<void> {
    await virtualFS.remove(path);
    // 广播文件删除事件给所有标签页
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'deleted',
      entityId: path,
      field: 'delete',
      oldValue: undefined,
      newValue: undefined,
    });
  }

  // ========== 内部 ==========

  /**
   * 把 UIUpdateEvent 广播给所有注册的 Tab 回调
   */
  private broadcastUIUpdate(event: UIUpdateEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb.onUIUpdate(event);
      } catch (err) {
        console.error('[WorkerCore] onUIUpdate callback error:', err);
      }
    }
  }

  /**
   * 获取 Token（供 RTCAgentClient 回调使用）
   *
   * - 选择任一已注册的 requestToken 回调
   * - 失败时尝试下一个
   */
  private async requestToken(): Promise<string> {
    for (const cb of this.callbacks) {
      try {
        return await cb.requestToken();
      } catch (err) {
        console.warn('[WorkerCore] requestToken failed, trying next:', err);
      }
    }
    throw new Error('[WorkerCore] no callback available to provide token');
  }

  /**
   * 请求 Token 刷新（供 RTCAgentClient 的 onTokenExpired 回调使用）
   *
   * - 选择任一已注册的 requestTokenRefresh 回调
   * - 失败时尝试下一个
   * - 所有回调都失败时返回 'relogin'（要求用户重新登录）
   */
  private async requestTokenRefresh(): Promise<TokenExpiredAction> {
    for (const cb of this.callbacks) {
      try {
        return await cb.requestTokenRefresh();
      } catch (err) {
        console.warn('[WorkerCore] requestTokenRefresh failed, trying next:', err);
      }
    }
    return 'relogin';
  }

  private ensureLayer(): PersistenceLayer {
    if (!this.layer) {
      throw new Error('[WorkerCore] not initialized, call init() first');
    }
    return this.layer;
  }

  /**
   * 订阅 RTCAgentClient 连接状态变更
   *
   * connect() 后调用，将连接状态变更广播给所有注册的 Tab 回调。
   * 替代 主线程无法直接访问 getClient() 的问题。
   */
  private _subscribeConnectionState(layer: PersistenceLayer): void {
    this._unsubscribeConnectionState();
    const client = layer.getClient();
    console.log('[WorkerCore] subscribing to connection state changes');
    this.unsubscribeConnection = client.on('connection', (event: ConnectionStateEvent) => {
      console.log('[WorkerCore] connection state changed:', event.state, 'reason:', event.reason);
      this.broadcastConnectionState(event);
    });
  }

  /**
   * 取消订阅连接状态变更
   */
  private _unsubscribeConnectionState(): void {
    if (this.unsubscribeConnection) {
      this.unsubscribeConnection();
      this.unsubscribeConnection = null;
    }
  }

  /**
   * 把连接状态变更广播给所有注册的 Tab 回调
   */
  private broadcastConnectionState(event: ConnectionStateEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb.onConnectionStateChange(event);
      } catch (err) {
        console.error('[WorkerCore] onConnectionStateChange callback error:', err);
      }
    }
  }
}
