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
import type { ConnectionState, ConnectionStateEvent } from '@rtc-agent/client';
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

    // 把 RTCAgentClient 的 getToken 桥接到 callbacks.requestToken
    // 注意：此时 callbacks 还是空的，但 getToken 会在 connect() 时才被调用
    const bridgedConfig: PersistenceConfig = {
      ...config,
      client: {
        ...config.client,
        getToken: () => this.requestToken(),
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
    const layer = this.ensureLayer();
    await layer.connect();
    // 订阅 RTCAgentClient 连接状态变更，广播给所有 Tab
    this._subscribeConnectionState(layer);
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

  async stopTurn(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.stopTurn(sessionClientId);
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
      await virtualFS.write(file.path, file.content, 'overwrite', file.metadata);
    }
    console.log('[WorkerCore] batchWriteFiles completed');
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
    return virtualFS.write(path, content, mode, metadataOverride);
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
    return virtualFS.remove(path);
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
    this.unsubscribeConnection = client.on('connection', (event: ConnectionStateEvent) => {
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
