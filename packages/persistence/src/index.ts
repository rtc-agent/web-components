import { RTCAgentClient, type RTCAgentClientOptions, type PublicationEvent } from '@rtc-agent/client';
import type { Update, ContentData, SendMessageRequest, ForkSessionRequest, CompactSessionRequest } from '@rtc-agent/protocol';
import { getDatabase, closeDatabase, flushAll, type LocalSession, type LocalMessage, type LocalRtc } from './database.js';
import { getOffsetManager } from './offset-manager.js';
import { initEntityRepository, getEntityRepository } from './entity-repository.js';
import { nowRFC3339 } from './time-utils.js';
import { virtualFS } from './virtual-fs.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('PersistenceLayer');

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
export { RtcProcessor, type ConfirmDialogFn, type AskUserDialogFn } from './rtc-processor.js';

/**
 * Persistence layer configuration.
 */
export interface PersistenceConfig {
  /** RTCAgentClient configuration */
  client: RTCAgentClientOptions;
  /** Database name (default: 'rtc-agent') */
  databaseName?: string;
  /** Device ID for filtering non-local-device RTCs at execution time */
  deviceId: string;
}

/**
 * PersistenceLayer: integrates RTCAgentClient + IndexedDB.
 */
export class PersistenceLayer {
  private client: RTCAgentClient;
  private offsetManager = getOffsetManager();
  private entityRepository;

  constructor(config: PersistenceConfig) {
    // Initialize EntityRepository singleton (device ID filtering on write)
    initEntityRepository(config.deviceId);
    this.entityRepository = getEntityRepository();

    // Create RTCAgentClient, injecting offset and publication callbacks
    const clientOptions: RTCAgentClientOptions = {
      ...config.client,
      getLastOffset: (channel: string) => {
        // Synchronous return (from memory cache or immediate query)
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
   * Get the RTCAgentClient instance.
   */
  getClient(): RTCAgentClient {
    return this.client;
  }

  /**
   * Get the OffsetManager instance.
   */
  getOffsetManager() {
    return this.offsetManager;
  }

  /**
   * Get the EntityRepository instance.
   */
  getEntityRepository() {
    return this.entityRepository;
  }

  /**
   * Connect the client.
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnect the client.
   */
  disconnect(): void {
    this.client.disconnect();
  }

  /**
   * Reconnect the client.
   */
  async reconnect(): Promise<void> {
    await this.client.reconnect();
  }

  /**
   * Handle a Publication event.
   */
  private async handlePublication(event: PublicationEvent): Promise<void> {
    // Treat data as Update type
    const update = event.data as Update;

    // Apply update (persist entity)
    await this.entityRepository.applyUpdate(update);

    // Note: offset and epoch persistence is handled by the Client's updateOffset callback.
    // The Client calls updateOffset automatically after onPublication.
  }

  // ========== Convenience methods ==========

  /**
   * List all sessions.
   */
  async listSessions(cursor?: string, limit?: number): Promise<LocalSession[]> {
    return this.entityRepository.listSessions(cursor, limit);
  }

  /**
   * Get a session by client_id.
   */
  async getSession(clientId: string): Promise<LocalSession | undefined> {
    return this.entityRepository.getClientSession(clientId);
  }

  /**
   * Get a session by client_id (alias).
   * @deprecated Use getSession instead
   */
  async getSessionByClientId(clientId: string): Promise<LocalSession | undefined> {
    return this.entityRepository.getClientSession(clientId);
  }

  /**
   * List messages for a session.
   * @param direction 'backward' (default) = newest to oldest; 'forward' = oldest to newest
   * @param cursor Pagination cursor in "${timestamp}|${clientId}" format for (created_at, client_id) compound sort
   */
  async listMessages(sessionClientId: string, cursor?: string, limit?: number, direction?: 'backward' | 'forward'): Promise<LocalMessage[]> {
    return this.entityRepository.listMessagesBySession(sessionClientId, cursor, limit, direction);
  }

  /**
   * Get a message by client_id.
   */
  async getMessage(clientId: string): Promise<LocalMessage | undefined> {
    return this.entityRepository.getClientMessage(clientId);
  }

  /**
   * List RTCs for a session (ascending by offset; cursor is the starting offset).
   */
  async listRtc(sessionClientId: string, cursor?: number, limit?: number): Promise<LocalRtc[]> {
    return this.entityRepository.listRtcBySession(sessionClientId, cursor, limit);
  }

  /**
   * Get the next RTC to process.
   *
   * Device ID filtering is done at execution time (EntityRepository.getNextRtcToProcess);
   * only RTCs whose session_device_id matches the current device are returned.
   *
   * @param sessionClientId Optional session filter
   */
  async getNextRtcToProcess(sessionClientId?: string): Promise<LocalRtc | undefined> {
    return this.entityRepository.getNextRtcToProcess(sessionClientId);
  }

  /**
   * Close the database.
   */
  async close(): Promise<void> {
    this.disconnect();
    await closeDatabase();
  }

  /**
   * Flush all data (for development/testing).
   */
  async flushAll(): Promise<void> {
    await flushAll();
  }

  // ========== Data flow core ==========

  /**
   * Send a message: local write first + immediate return + background sync.
   */
  async sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const { content, messageClientId, sessionClientId } = params;

    // 1. Look up session
    const existing = await this.entityRepository.getClientSession(sessionClientId);

    let session: LocalSession;
    let isNewSession: boolean;
    let agentPrompt = '';
    // 3. Not found: create new session, read AGENT.md from VirtualFS as agent_prompt
    try {
      agentPrompt = await virtualFS.read('/AGENT.md');
    } catch {
      // Silently skip when AGENT.md doesn't exist (agent_prompt stays empty)
    }

    if (existing) {
      // 2. Found session: touch updated_at, keep existing sync_status and server_id
      const now = nowRFC3339();
      const result = await this.entityRepository.upsertSession(
        { client_id: existing.client_id, server_id: existing.server_id, updated_at: now, agent_prompt: agentPrompt },
        existing.sync_status,
        { silent: true }
      );
      session = result.after;
      isNewSession = false;
      agentPrompt = result.after.agent_prompt ?? "";
    } else {
      // Generate session title from first message content (first line, max 50 chars)
      const generatedTitle = this._generateSessionTitle(content);
      log.info('sendMessage] New session created, generated title:', `"${generatedTitle}"`);

      const result = await this.entityRepository.upsertSession(
        { client_id: sessionClientId, status: 'active', agent_prompt: agentPrompt, title: generatedTitle },
        'pending',
        { silent: true }
      );
      session = result.after;
      isNewSession = true;
      log.info('sendMessage] Session after upsert:', { client_id: session.client_id, title: session.title });
    }

    // 4. Write message
    const now = nowRFC3339();
    // Store the full ContentData (including type and data) so the message type can be
    // correctly identified when reading back.
    // MessageController._localMessageToUI and _extractTextFromContent handle deserialization.
    const contentStr = JSON.stringify(content);
    const msgResult = await this.entityRepository.upsertMessage(
      {
        client_id: messageClientId,
        session_client_id: session.client_id,
        role: 'user',
        content: contentStr,
        streaming_status: 'completed',
        created_at: now,
        updated_at: now,
      },
      'pending',
      { silent: true }
    );
    const message = msgResult.after;

    // 5. Return immediately
    // 6. Fire-and-forget async sync
    this._syncToServer(message, session, content, isNewSession, agentPrompt).catch(err => {
      log.error('_syncToServer failed:', err);
    });

    return { session, message };
  }

  /**
   * Insert a local message (not sent to server).
   *
   * Used for injecting system-generated messages into the conversation
   * (e.g. todo_list change notifications). The message is written directly
   * to IndexedDB with syncStatus 'synced' and does not trigger background sync.
   */
  async insertLocalMessage(params: {
    sessionClientId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    creatorKind?: string;
    creatorRefId?: string;
  }): Promise<LocalMessage> {
    const now = nowRFC3339();
    const result = await this.entityRepository.upsertMessage(
      {
        client_id: crypto.randomUUID(),
        session_client_id: params.sessionClientId,
        role: params.role,
        content: params.content,
        streaming_status: 'completed',
        creator_kind: params.creatorKind ?? 'system',
        creator_ref_id: params.creatorRefId ?? '',
        created_at: now,
        updated_at: now,
      },
      'synced',
    );
    return result.after;
  }

  /**
   * Generate a session title from message content.
   *
   * Takes the first line of the first message text, truncated to 50 characters.
   * Returns "New Chat" if content is empty or unparseable.
   */
  private _generateSessionTitle(content: ContentData): string {
    try {
      let text = '';
      if (typeof content.data === 'string') {
        text = content.data;
      } else if (content.data && typeof content.data === 'object') {
        // Attempt to extract text from the object
        const obj = content.data as Record<string, unknown>;
        text = (obj.text as string) || (obj.content as string) || JSON.stringify(content.data);
      }

      // Take first line, trim whitespace
      const firstLine = text.split('\n')[0]?.trim() || '';
      if (!firstLine) return 'New Chat';

      // Truncate to 50 characters
      return firstLine.length > 50 ? firstLine.substring(0, 50) + '…' : firstLine;
    } catch {
      return 'New Chat';
    }
  }

  /**
   * Background sync: send message to the server.
   */
  private async _syncToServer(
    message: LocalMessage,
    session: LocalSession,
    content: ContentData,
    isNewSession: boolean,
    agentPrompt: string,
  ): Promise<void> {
    // 1. Build request
    const req: SendMessageRequest = {
      server_session_id: session.server_id,
      content_data: content,
      client_id: message.client_id,
      client_session_id: session.client_id,
      agent_prompt: agentPrompt,
    };

    try {
      // 2. Call RPC
      const response = await this.client.sendMessage(req);

      // 3. On success: apply server-returned updates
      if (response.updates && response.updates.length > 0) {
        await this.client.applyUpdates(response.updates);
      }

      // Fallback: ensure message sync_status is marked as synced
      await this.entityRepository.upsertMessage(
        {
          client_id: message.client_id,
          server_id: response.result.message_id,
        },
        'synced'
      );

      // If this is a new session, update session as well
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
      // 4. On failure
      log.error('_syncToServer RPC failed:', err);

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
   * Stop the current turn.
   */
  async stopTurn(sessionClientId: string): Promise<void> {
    // 1. Look up session
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session?.server_id) {
      throw new Error(`Session not found or not synced: ${sessionClientId}`);
    }

    // 2. Call RPC
    const response = await this.client.stopTurn(session.server_id);

    // 3. Apply updates
    if (response.updates && response.updates.length > 0) {
      await this.client.applyUpdates(response.updates);
    }
  }

  /**
   * Close a session (notify backend to stop the turn loop).
   */
  async closeSession(sessionClientId: string): Promise<void> {
    // 1. Look up session
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session?.server_id) {
      throw new Error(`Session not found or not synced: ${sessionClientId}`);
    }

    // 2. Call RPC
    const response = await this.client.closeSession(session.server_id);

    // 3. Apply updates
    if (response.updates && response.updates.length > 0) {
      await this.client.applyUpdates(response.updates);
    }
  }

  /**
   * Reopen a closed session.
   */
  async openSession(sessionClientId: string): Promise<void> {
    // 1. Look up session
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session?.server_id) {
      throw new Error(`Session not found or not synced: ${sessionClientId}`);
    }

    // 2. Call RPC
    const response = await this.client.openSession(session.server_id);

    // 3. Apply updates
    if (response.updates && response.updates.length > 0) {
      await this.client.applyUpdates(response.updates);
    }
  }

  /**
   * Compact session context.
   */
  async compactSession(sessionClientId: string, customInstruction?: string): Promise<void> {
    // 1. Look up session
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session?.server_id) {
      throw new Error(`Session not found or not synced: ${sessionClientId}`);
    }

    // 2. Call RPC
    const req: CompactSessionRequest = {
      session_id: session.server_id,
      custom_instruction: customInstruction,
    };
    const response = await this.client.compactSession(req);

    // 3. Apply updates
    if (response.updates && response.updates.length > 0) {
      await this.client.applyUpdates(response.updates);
    }
  }

  /**
   * Delete a session (soft delete): optimistic local update + async RPC sync.
   *
   * Flow:
   * 1. EntityRepository.softDeleteSession -> writes deleted_at + updated_at locally, sync_status='pending'
   * 2. Async RPC: call updateSession({ session_id, deleted_at })
   *    - Success: write back sync_status='synced'
   *    - Failure: exponential backoff retry (max 3 attempts), then sync_status='failed' + notify UI
   */
  async deleteSession(sessionClientId: string): Promise<void> {
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session) return;

    // Step 1: Optimistic local update (via EntityRepository, triggers UIUpdateBus)
    await this.entityRepository.softDeleteSession(sessionClientId);

    // Step 2: Async RPC sync (only when server_id exists)
    if (session.server_id) {
      const deletedAt = session.deleted_at ?? nowRFC3339();
      this._syncWithRetry(
        () => this.client.updateSession({ session_id: session.server_id!, deleted_at: deletedAt }),
        session.server_id,
        'delete',
      );
    }
  }

  /**
   * Update session title: optimistic local update + async RPC sync.
   */
  async updateSessionTitle(sessionClientId: string, title: string): Promise<void> {
    const session = await this.entityRepository.getClientSession(sessionClientId);
    if (!session) return;

    // Step 1: Optimistic local update
    const now = nowRFC3339();
    await this.entityRepository.upsertSession(
      {
        client_id: sessionClientId,
        title,
        updated_at: now,
      },
      'pending',
    );

    // Step 2: Async RPC sync
    if (session.server_id) {
      this._syncWithRetry(
        () => this.client.updateSession({ session_id: session.server_id!, title }),
        session.server_id,
        'update',
      );
    }
  }

  /**
   * Generic sync retry logic with exponential backoff.
   *
   * Runs asynchronously without blocking the caller.
   * On success: writes back sync_status='synced'.
   * On exceeding retry limit: marks sync_status='failed'.
   */
  private static readonly SYNC_MAX_RETRIES = 3;
  private static readonly SYNC_BASE_DELAY_MS = 1000;

  private _syncWithRetry(
    rpc: () => Promise<unknown>,
    serverId: string,
    action: 'delete' | 'update',
  ): void {
    const attempt = async (retries: number): Promise<void> => {
      try {
        await rpc();
        // On success: write back sync_status='synced'
        await this._markSessionSynced(serverId);
      } catch (err) {
        if (retries < PersistenceLayer.SYNC_MAX_RETRIES - 1) {
          const delay = PersistenceLayer.SYNC_BASE_DELAY_MS * 2 ** retries;
          await new Promise(r => setTimeout(r, delay));
          return attempt(retries + 1);
        }
        // Exceeded retry limit: mark as failed
        log.error(` ${action}Session RPC failed after ${PersistenceLayer.SYNC_MAX_RETRIES} attempts:`, err);
        await this._markSessionSyncFailed(serverId);
      }
    };
    // Fire-and-forget
    void attempt(0);
  }

  private async _markSessionSynced(serverId: string): Promise<void> {
    const session = await this.entityRepository.getSessionByServerId(serverId);
    if (session) {
      await this.entityRepository.upsertSession({ client_id: session.client_id }, 'synced');
    }
  }

  private async _markSessionSyncFailed(serverId: string): Promise<void> {
    const session = await this.entityRepository.getSessionByServerId(serverId);
    if (session) {
      await this.entityRepository.upsertSession({ client_id: session.client_id }, 'failed');
    }
  }

  /**
   * Submit an RTC execution result (single attempt, no retry).
   * On failure: marks sync_status='failed'; caller retries via getNextRtcToProcess.
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
      // 1. Update local execution status
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

      // 2. Single submission attempt
      // Check and truncate large data to stay within the Centrifuge message size limit (default 64KB).
      // Lower threshold to 32KB to leave headroom for message headers and serialization overhead.
      const MAX_RESULT_SIZE = 32000; // 32KB safe threshold
      let resultToSend = result;
      let truncated = false;

      try {
        const resultStr = JSON.stringify(result);
        if (resultStr.length > MAX_RESULT_SIZE) {
          log.warn('result too large:', resultStr.length, 'bytes, truncating to', MAX_RESULT_SIZE, 'bytes');
          truncated = true;
          // Truncation strategy: keep head and tail, omit middle
          const keepStart = Math.floor(MAX_RESULT_SIZE * 0.8);
          const keepEnd = Math.floor(MAX_RESULT_SIZE * 0.2);
          const truncatedStr = resultStr.substring(0, keepStart) +
            '\n\n... [TRUNCATED: original size ' + resultStr.length + ' bytes] ...\n\n' +
            resultStr.substring(resultStr.length - keepEnd);
          // Try parsing back to object; on failure keep as string
          try {
            resultToSend = JSON.parse(truncatedStr);
          } catch {
            resultToSend = truncatedStr;
          }
        }
      } catch (err) {
        log.warn('failed to check result size:', err);
      }

      const response = await this.client.submitRtcResult(
        rtc.server_id,
        success,
        resultToSend,
        truncated ? '[Result truncated due to size limit. Full result stored locally.]' : error
      );

      if (response.updates?.length) {
        await this.client.applyUpdates(response.updates);
      }

      // Success: mark as synced
      await this.entityRepository.upsertRtc({ client_id: rtcClientId }, 'synced');
    } catch (err) {
      // Any error (local write or RPC): mark as failed, next getNextRtcToProcess will retry
      log.error('submitRtcResult failed:', err);
      await this.entityRepository.upsertRtc({ client_id: rtcClientId }, 'failed');
      throw err;
    }
  }

  /**
   * Fork a conversation: create a new session based on an old one, replacing the specified
   * message and triggering the AI flow.
   *
   * Flow:
   * 1. Locally create a new session (inherits old session title)
   * 2. Locally create a new message (replaces the old message)
   * 3. Return immediately
   * 4. Background sync to server (server copies historical messages)
   */
  async forkSession(params: {
    oldSessionClientId: string;   // client_id of the old session
    oldMessageClientId: string;   // client_id of the message to replace
    newSessionClientId: string;   // client_id for the new session
    newMessageClientId: string;   // client_id for the new message
    content: ContentData;         // New content
    limit?: number;               // How many historical messages to fork
  }): Promise<{ session: LocalSession; message: LocalMessage }> {
    const { oldSessionClientId, oldMessageClientId, newSessionClientId, newMessageClientId, content, limit } = params;

    // 1. Look up old session
    const oldSession = await this.entityRepository.getClientSession(oldSessionClientId);
    if (!oldSession) {
      throw new Error(`Old session not found: ${oldSessionClientId}`);
    }
    if (!oldSession.server_id) {
      throw new Error(`Old session not synced yet: ${oldSessionClientId}`);
    }

    // 2. Look up old message
    const oldMessage = await this.entityRepository.getClientMessage(oldMessageClientId);
    if (!oldMessage) {
      throw new Error(`Old message not found: ${oldMessageClientId}`);
    }
    if (!oldMessage.server_id) {
      throw new Error(`Old message not synced yet: ${oldMessageClientId}`);
    }

    // 3. Locally create new session (inherits old session title)
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

    // 4. Locally create new message
    const msgResult = await this.entityRepository.upsertMessage(
      {
        client_id: newMessageClientId,
        session_client_id: newSession.client_id,
        role: 'user',
        content: JSON.stringify(content),
        streaming_status: 'completed',
        created_at: now,
        updated_at: now,
      },
      'pending',
      { silent: true }
    );
    const newMessage = msgResult.after;

    // 5. Return immediately
    // 6. Fire-and-forget background sync
    this._syncForkToServer({
      oldSession,
      oldMessage,
      newSession,
      newMessage,
      content,
      limit,
    }).catch(err => {
      log.error('_syncForkToServer failed:', err);
    });

    return { session: newSession, message: newMessage };
  }

  /**
   * Background sync: send ForkSession to server.
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

    // 1. Build request
    const req: ForkSessionRequest = {
      old_server_session_id: oldSession.server_id!,
      old_server_message_id: oldMessage.server_id!,
      new_client_session_id: newSession.client_id,
      new_client_message_id: newMessage.client_id,
      content_data: content,
      limit,
    };

    try {
      // 2. Call RPC
      const response = await this.client.forkSession(req);

      // 3. On success: apply server-returned updates
      // Updates include: new session (created) + copied historical messages (created)
      if (response.updates && response.updates.length > 0) {
        await this.client.applyUpdates(response.updates);
      }

      // Fallback: ensure new session has server_id and sync_status updated
      await this.entityRepository.upsertSession(
        {
          client_id: newSession.client_id,
          server_id: response.result.session_id,
        },
        'synced'
      );

      // Fallback: ensure new message has server_id and sync_status updated
      // The last entry in message_ids corresponds to the new message
      // (server returns in order: copied history + new message)
      const newMessageServerId = response.result.message_ids?.[response.result.message_ids.length - 1];
      if (newMessageServerId) {
        await this.entityRepository.upsertMessage(
          {
            client_id: newMessage.client_id,
            server_id: newMessageServerId,
          },
          'synced'
        );
      }
    } catch (err) {
      // 4. On failure
      log.error('_syncForkToServer RPC failed:', err);

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
 * Create a persistence layer instance.
 */
export function createPersistenceLayer(config: PersistenceConfig): PersistenceLayer {
  // Initialize database
  getDatabase(config.databaseName);
  return new PersistenceLayer(config);
}
