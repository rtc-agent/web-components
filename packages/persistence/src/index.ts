import { RTCAgentClient, type RTCAgentClientOptions, type PublicationEvent } from '@rtc-agent/client';
import type { Update, ContentData, SendMessageRequest, ForkSessionRequest } from '@rtc-agent/protocol';
import { getDatabase, closeDatabase, flushAll, type LocalSession, type LocalTurn, type LocalMessage, type LocalRtc } from './database.js';
import { getOffsetManager } from './offset-manager.js';
import { getEntityRepository } from './entity-repository.js';
import { nowRFC3339 } from './time-utils.js';

export * from './database.js';
export * from './offset-manager.js';
export * from './entity-repository.js';
export * from './ui-update-bus.js';
export * from './time-utils.js';
export * from './permission.js';
export * from './tools/index.js';
export * from './virtual-fs.js';
export * from './virtual-fs-init.js';
export * from './script-engine.js';
export { createBuiltinTools } from './tools/builtin.js';
export { RtcProcessor, type ConfirmDialogFn } from './rtc-processor.js';

/**
 * 持久化层配置
 */
export interface PersistenceConfig {
  /** RTCAgentClient 配置 */
  client: RTCAgentClientOptions;
  /** 数据库名称（默认 'rtc-agent'） */
  databaseName?: string;
}

/**
 * 持久化层：整合 RTCAgentClient + IndexedDB
 */
export class PersistenceLayer {
  private client: RTCAgentClient;
  private offsetManager = getOffsetManager();
  private entityRepository = getEntityRepository();

  constructor(config: PersistenceConfig) {
    // 创建 RTCAgentClient，注入 offset 和 publication 回调
    const clientOptions: RTCAgentClientOptions = {
      ...config.client,
      getLastOffset: (channel: string) => {
        // 同步返回（从内存缓存或立即查询）
        return this.offsetManager.getPosition(channel);
      },
      updateOffset: async (channel: string, offset: number, epoch: string) => {
        await this.offsetManager.updatePosition(channel, offset, epoch);
      },
      onPublication: async (event: PublicationEvent) => {
        await this.handlePublication(event);
      },
    };

    this.client = new RTCAgentClient(clientOptions);
  }

  /**
   * 获取 RTCAgentClient 实例
   */
  getClient(): RTCAgentClient {
    return this.client;
  }

  /**
   * 获取 OffsetManager 实例
   */
  getOffsetManager() {
    return this.offsetManager;
  }

  /**
   * 获取 EntityRepository 实例
   */
  getEntityRepository() {
    return this.entityRepository;
  }

  /**
   * 连接客户端
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.client.disconnect();
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<void> {
    await this.client.reconnect();
  }

  /**
   * 处理 Publication 事件
   */
  private async handlePublication(event: PublicationEvent): Promise<void> {
    // 假设 data 是 Update 类型
    const update = event.data as Update;

    // 处理 Update（持久化实体）
    await this.entityRepository.applyUpdate(update);

    // 注意：offset 和 epoch 的持久化由 Client 的 updateOffset 回调负责
    // Client 在调用 onPublication 后会自动调用 updateOffset
  }

  // ========== 便捷方法 ==========

  /**
   * 列出所有会话
   */
  async listSessions(cursor?: string, limit?: number): Promise<LocalSession[]> {
    return this.entityRepository.listSessions(cursor, limit);
  }

  /**
   * 通过 client_id 获取会话
   */
  async getSession(clientId: string): Promise<LocalSession | undefined> {
    return this.entityRepository.getClientSession(clientId);
  }

  /**
   * 通过 client_id 获取会话（别名）
   */
  async getSessionByClientId(clientId: string): Promise<LocalSession | undefined> {
    return this.entityRepository.getSessionByClientId(clientId);
  }

  /**
   * 列出某个会话的所有消息
   */
  async listMessages(sessionClientId: string, cursor?: number, limit?: number): Promise<LocalMessage[]> {
    return this.entityRepository.listMessagesBySession(sessionClientId, cursor, limit);
  }

  /**
   * 通过 client_id 获取消息
   */
  async getMessage(clientId: string): Promise<LocalMessage | undefined> {
    return this.entityRepository.getClientMessage(clientId);
  }

  /**
   * 列出某个会话的 RTC
   */
  async listRtc(sessionClientId: string, cursor?: number, limit?: number): Promise<LocalRtc[]> {
    return this.entityRepository.listRtcBySession(sessionClientId, cursor, limit);
  }

  /**
   * 获取下一个待处理的 RTC
   */
  async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
    return this.entityRepository.getNextRtcToProcess(sessionClientId);
  }

  /**
   * 关闭数据库
   */
  async close(): Promise<void> {
    this.disconnect();
    await closeDatabase();
  }

  /**
   * 清空所有数据（用于开发/测试）
   */
  async flushAll(): Promise<void> {
    await flushAll();
  }

  // ========== 数据流核心 ==========

  /**
   * 发送消息：本地先写 + 立即返回 + 后台同步
   */
  async sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const { content, messageClientId, sessionClientId } = params;

    // 1. 查找 session
    const existing = await this.entityRepository.getSessionByClientId(sessionClientId);

    let session: LocalSession;
    let isNewSession: boolean;

    if (existing) {
      // 2. 找到 session：touch updated_at，保持原有 sync_status 和 server_id
      const now = nowRFC3339();
      const result = await this.entityRepository.upsertSession(
        { client_id: existing.client_id, server_id: existing.server_id, updated_at: now },
        existing.sync_status,
        { silent: true }
      );
      session = result.after;
      isNewSession = false;
    } else {
      // 3. 没找到：创建新 session
      const result = await this.entityRepository.upsertSession(
        { client_id: sessionClientId, status: 'active' },
        'pending',
        { silent: true }
      );
      session = result.after;
      isNewSession = true;
    }

    // 4. 写入 message
    const now = nowRFC3339();
    const msgResult = await this.entityRepository.upsertMessage(
      {
        client_id: messageClientId,
        session_client_id: session.client_id,
        role: 'user',
        content: content.data as string,
        streaming_status: 'completed',
        created_at: now,
        updated_at: now,
      },
      'pending',
      { silent: true }
    );
    const message = msgResult.after;

    // 5. 立即返回
    // 6. fire-and-forget 异步同步
    this._syncToServer(message, session, content, isNewSession).catch(err => {
      console.error('[PersistenceLayer] _syncToServer failed:', err);
    });

    return { session, message };
  }

  /**
   * 后台同步消息到服务端
   */
  private async _syncToServer(
    message: LocalMessage,
    session: LocalSession,
    content: ContentData,
    isNewSession: boolean
  ): Promise<void> {
    // 1. 构造请求
    const req: SendMessageRequest = {
      server_session_id: session.server_id,
      content_data: content,
      client_id: message.client_id,
      client_session_id: session.client_id,
    };

    try {
      // 2. 调用 RPC
      const response = await this.client.sendMessage(req);

      // 3. 成功时：处理服务端返回的 updates
      if (response.updates && response.updates.length > 0) {
        await this.client.applyUpdates(response.updates);
      }

      // fallback：确保 message 的 sync_status 为 synced
      await this.entityRepository.upsertMessage(
        {
          client_id: message.client_id,
          server_id: response.result.message_id,
        },
        'synced'
      );

      // 如果是新建 session，确保 session 也更新
      if (isNewSession) {
        await this.entityRepository.upsertSession(
          {
            client_id: session.client_id,
            server_id: response.result.session_id,
          },
          'synced'
        );
      }
    } catch (err) {
      // 4. 失败时
      console.error('[PersistenceLayer] _syncToServer RPC failed:', err);

      await this.entityRepository.upsertMessage(
        { client_id: message.client_id },
        'failed'
      );

      if (isNewSession && session.sync_status === 'pending') {
        await this.entityRepository.upsertSession(
          { client_id: session.client_id },
          'failed'
        );
      }
    }
  }

  /**
   * 停止当前 turn
   */
  async stopTurn(sessionClientId: string): Promise<void> {
    // 1. 查找 session
    const session = await this.entityRepository.getSessionByClientId(sessionClientId);
    if (!session?.server_id) {
      throw new Error(`Session not found or not synced: ${sessionClientId}`);
    }

    // 2. 调用 RPC
    const response = await this.client.stopTurn(session.server_id);

    // 3. 处理 updates
    if (response.updates && response.updates.length > 0) {
      await this.client.applyUpdates(response.updates);
    }
  }

  /**
   * 提交 RTC 执行结果（单次上报，不重试）
   * 失败时标记 sync_status='failed'，由调用方通过 getNextRtcToProcess 重试
   */
  async submitRtcResult(params: {
    rtcClientId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): Promise<void> {
    const { rtcClientId, success, result, error } = params;
    const rtc = await this.entityRepository.getClientRtc(rtcClientId);
    if (!rtc?.server_id) {
      throw new Error(`RTC not synced yet: ${rtcClientId}`);
    }

    try {
      // 1. 更新本地执行状态
      const now = nowRFC3339();
      await this.entityRepository.upsertRtc(
        {
          client_id: rtcClientId,
          status: success ? 'completed' : 'failed',
          result,
          error_message: error,
          completed_at: now,
          updated_at: now,
        },
        'pending',
        { silent: true }
      );

      // 2. 单次上报
      const response = await this.client.submitRtcResult(
        rtc.server_id,
        success,
        result,
        error
      );

      if (response.updates?.length) {
        await this.client.applyUpdates(response.updates);
      }

      // 成功：标记 synced
      await this.entityRepository.upsertRtc({ client_id: rtcClientId }, 'synced');
    } catch (err) {
      // 任何异常（本地写入或 RPC）：标记 failed，等待下次 getNextRtcToProcess 重试
      console.error('[PersistenceLayer] submitRtcResult failed:', err);
      await this.entityRepository.upsertRtc({ client_id: rtcClientId }, 'failed');
      throw err;
    }
  }

  /**
   * 分叉对话：基于旧 session 创建新 session，替换指定消息并触发 AI 流程
   *
   * 流程：
   * 1. 本地创建新 session（继承旧 session 标题）
   * 2. 本地创建新消息（替换旧消息）
   * 3. 立即返回
   * 4. 后台同步到服务器（服务器会复制历史消息）
   */
  async forkSession(params: {
    oldSessionClientId: string;   // 旧 session 的 client_id
    oldMessageClientId: string;   // 要替换的消息的 client_id
    newSessionClientId: string;   // 新 session 的 client_id
    newMessageClientId: string;   // 新消息的 client_id
    content: ContentData;         // 新内容
    limit?: number;               // fork 多少条历史消息
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const { oldSessionClientId, oldMessageClientId, newSessionClientId, newMessageClientId, content, limit } = params;

    // 1. 查找旧 session
    const oldSession = await this.entityRepository.getSessionByClientId(oldSessionClientId);
    if (!oldSession) {
      throw new Error(`Old session not found: ${oldSessionClientId}`);
    }
    if (!oldSession.server_id) {
      throw new Error(`Old session not synced yet: ${oldSessionClientId}`);
    }

    // 2. 查找旧消息
    const oldMessage = await this.entityRepository.getClientMessage(oldMessageClientId);
    if (!oldMessage) {
      throw new Error(`Old message not found: ${oldMessageClientId}`);
    }
    if (!oldMessage.server_id) {
      throw new Error(`Old message not synced yet: ${oldMessageClientId}`);
    }

    // 3. 本地创建新 session（继承旧 session 标题）
    const now = nowRFC3339();
    const sessionResult = await this.entityRepository.upsertSession(
      {
        client_id: newSessionClientId,
        title: oldSession.title,
        status: 'active',
      },
      'pending',
      { silent: true }
    );
    const newSession = sessionResult.after;

    // 4. 本地创建新消息
    const msgResult = await this.entityRepository.upsertMessage(
      {
        client_id: newMessageClientId,
        session_client_id: newSession.client_id,
        role: 'user',
        content: content.data as string,
        streaming_status: 'completed',
        created_at: now,
        updated_at: now,
      },
      'pending',
      { silent: true }
    );
    const newMessage = msgResult.after;

    // 5. 立即返回
    // 6. fire-and-forget 后台同步
    this._syncForkToServer({
      oldSession,
      oldMessage,
      newSession,
      newMessage,
      content,
      limit,
    }).catch(err => {
      console.error('[PersistenceLayer] _syncForkToServer failed:', err);
    });

    return { session: newSession, message: newMessage };
  }

  /**
   * 后台同步 ForkSession 到服务器
   */
  private async _syncForkToServer(params: {
    oldSession: LocalSession;
    oldMessage: LocalMessage;
    newSession: LocalSession;
    newMessage: LocalMessage;
    content: ContentData;
    limit?: number;
  }): Promise<void> {
    const { oldSession, oldMessage, newSession, newMessage, content, limit } = params;

    // 1. 构造请求
    const req: ForkSessionRequest = {
      old_server_session_id: oldSession.server_id!,
      old_server_message_id: oldMessage.server_id!,
      new_client_session_id: newSession.client_id,
      new_client_message_id: newMessage.client_id,
      content_data: content,
      limit,
    };

    try {
      // 2. 调用 RPC
      const response = await this.client.forkSession(req);

      // 3. 成功时：处理服务端返回的 updates
      // updates 包含：新 session (created) + 复制的历史消息 (created)
      if (response.updates && response.updates.length > 0) {
        await this.client.applyUpdates(response.updates);
      }

      // fallback：确保新 session 的 server_id 和 sync_status 更新
      await this.entityRepository.upsertSession(
        {
          client_id: newSession.client_id,
          server_id: response.result.session_id,
        },
        'synced'
      );

      // fallback：确保新消息的 server_id 和 sync_status 更新
      await this.entityRepository.upsertMessage(
        {
          client_id: newMessage.client_id,
          server_id: response.result.message_ids[response.result.message_ids.length - 1], // 最后一条是新消息
        },
        'synced'
      );
    } catch (err) {
      // 4. 失败时
      console.error('[PersistenceLayer] _syncForkToServer RPC failed:', err);

      await this.entityRepository.upsertMessage(
        { client_id: newMessage.client_id },
        'failed'
      );

      await this.entityRepository.upsertSession(
        { client_id: newSession.client_id },
        'failed'
      );
    }
  }
}

/**
 * 创建持久化层实例
 */
export function createPersistenceLayer(config: PersistenceConfig): PersistenceLayer {
  // 初始化数据库
  getDatabase(config.databaseName);
  return new PersistenceLayer(config);
}
