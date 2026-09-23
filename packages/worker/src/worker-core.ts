import {
  createPersistenceLayer,
  getUIUpdateBus,
  getOffsetManager,
  initializeVirtualFS,
  virtualFS,
  getDatabase,
  type PersistenceConfig,
  type AgentMdConfig,
  type UIUpdateEvent,
  type LocalSession,
  type LocalMessage,
  type LocalRtc,
  type FileSystemEntryType,
  type FileSystemMetadataOverride,
} from '@rtc-agent/persistence';
import type { ContentData } from '@rtc-agent/protocol';
import type { ConnectionState, ConnectionStateEvent, TokenExpiredAction } from '@rtc-agent/client';
import { createLogger } from '@rtc-agent/client';
import type { WorkerCallbacks, WorkerPersistenceCore } from './core-interface.js';

const log = createLogger('WorkerCore');

type PersistenceLayer = ReturnType<typeof createPersistenceLayer>;

/**
 * WorkerPersistenceCore implementation.
 *
 * - Wraps PersistenceLayer, passing through all query/operation methods
 * - Subscribes to UIUpdateBus, broadcasting events to all registered Tab callbacks
 * - Token requests: forwarded to any registered requestToken callback
 */
export class WorkerCore implements WorkerPersistenceCore {
  private layer: PersistenceLayer | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;

  /** Callback sets for all connected Tabs */
  private callbacks = new Set<WorkerCallbacks>();

  /**
   * Initialize shared state.
   *
   * - Creates PersistenceLayer (internally holds RTCAgentClient + IndexedDB + EntityRepository)
   * - Subscribes to UIUpdateBus for broadcasting to all Tabs
   * - Idempotent (subsequent init calls are ignored)
   */
  async init(config: PersistenceConfig): Promise<void> {
    if (this.layer) {
      log.warn('already initialized, ignoring init()');
      return;
    }

    // Bridge RTCAgentClient's getToken / onTokenExpired to callbacks.
    // Note: callbacks is still empty at this point, but they are only invoked during connect().
    const bridgedConfig: PersistenceConfig = {
      ...config,
      client: {
        ...config.client,
        getToken: () => this.requestToken(),
        onTokenExpired: () => this.requestTokenRefresh(),
      },
    };

    this.layer = createPersistenceLayer(bridgedConfig);

    // Subscribe to UIUpdateBus to broadcast events to all registered callbacks
    const bus = getUIUpdateBus();
    this.unsubscribeBus = bus.subscribe((event: UIUpdateEvent) => {
      this.broadcastUIUpdate(event);
    });
  }

  /**
   * Register a Tab's callbacks.
   */
  registerCallback(cb: WorkerCallbacks): void {
    this.callbacks.add(cb);
  }

  /**
   * Unregister a Tab's callbacks.
   */
  unregisterCallback(cb: WorkerCallbacks): void {
    this.callbacks.delete(cb);
  }

  /**
   * Health check: verify the Worker is running.
   *
   * Works without init(); used by the main thread to verify that the
   * SharedWorker started successfully and can respond to messages.
   */
  ping(): string {
    return 'pong';
  }

  // ========== Connection ==========

  async connect(): Promise<void> {
    log.debug('connect() called');
    const layer = this.ensureLayer();
    log.debug('calling layer.connect()');
    await layer.connect();
    log.debug('layer.connect() returned, client state:', layer.getClient().getConnectionState());
    // Subscribe to RTCAgentClient connection state changes and broadcast to all Tabs
    this._subscribeConnectionState(layer);
    log.debug('connection state subscribed, returning from connect()');
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

  // ========== Queries ==========

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
    cursor?: string,
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

  // ========== Operations ==========

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

  async closeSession(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.closeSession(sessionClientId);
  }

  async openSession(sessionClientId: string): Promise<void> {
    const layer = this.ensureLayer();
    return layer.openSession(sessionClientId);
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

  // ========== Lifecycle ==========

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
    // virtualFS internally accesses the same IndexedDB via getDatabase() (shared within Worker)
    await initializeVirtualFS(config);
  }

  async batchWriteFiles(files: Array<{
    path: string;
    content: string;
    metadata?: FileSystemMetadataOverride;
  }>): Promise<void> {
    log.debug('batchWriteFiles called, files count:', files.length);
    const db = getDatabase();

    for (const file of files) {
      // Check if this is a protected file path (/AGENT.md or /scenarios/*.md)
      const isProtectedPath = this._isProtectedPath(file.path);

      if (isProtectedPath) {
        // Check if the file exists and has been edited by the user
        const existing = await db.fileSystemEntries.get(file.path);
        if (existing?.metadata?.editedByUser) {
          log.debug('batchWriteFiles: skipping protected file edited by user:', file.path);
          continue;
        }
      }

      // For protected paths, use overwrite mode (since we've already checked editedByUser above)
      // For other paths, always use overwrite mode
      const mode: 'overwrite' | 'append' | 'create-new' = 'overwrite';

      // Ensure editedByUser is set to false for system-generated files
      const metadata = {
        ...file.metadata,
        editedByUser: false,
      };

      await virtualFS.write(file.path, file.content, mode, metadata);
    }
    log.debug('batchWriteFiles completed');
    // Single broadcast for batch write to avoid per-file notifications
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
   * Check if a file path is protected from system overwrites.
   *
   * Protected files: /AGENT.md, /scenarios/*.md (excluding /scenarios/INDEX.md)
   * These files can be edited by users, and system updates should not overwrite user edits.
   */
  private _isProtectedPath(path: string): boolean {
    // /AGENT.md
    if (path === '/AGENT.md') {
      return true;
    }
    // /scenarios/*.md (excluding /scenarios/INDEX.md)
    if (path.startsWith('/scenarios/') && path !== '/scenarios/INDEX.md') {
      return true;
    }
    return false;
  }

  async resetOffset(): Promise<void> {
    await getOffsetManager().reset();
  }

  // ========== virtualFS proxy (main thread -> Worker) ==========

  async virtualFSRead(path: string, offset?: number, limit?: number): Promise<string> {
    return virtualFS.read(path, offset, limit);
  }

  async virtualFSWrite(
    path: string,
    content: string,
    mode: 'overwrite' | 'append' = 'overwrite',
    metadataOverride?: FileSystemMetadataOverride,
  ): Promise<number> {
    const result = await virtualFS.write(path, content, mode, metadataOverride);
    // Broadcast file change event to all Tabs
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
    // Validate the incoming string against the known FileSystemEntryType union
    // to avoid passing an arbitrary string into virtualFS.queryByType.
    const validTypes: ReadonlyArray<FileSystemEntryType> = ['function', 'scenario', 'script', 'index'];
    if (!validTypes.includes(type as FileSystemEntryType)) {
      log.warn(`virtualFSQueryByType: unknown type "${type}", falling back to empty result`);
      return [];
    }
    return virtualFS.queryByType(type as FileSystemEntryType);
  }

  async virtualFSExists(path: string): Promise<boolean> {
    return virtualFS.exists(path);
  }

  async virtualFSRemove(path: string): Promise<void> {
    await virtualFS.remove(path);
    // Broadcast file delete event to all Tabs
    this.broadcastUIUpdate({
      entity: 'file',
      action: 'deleted',
      entityId: path,
      field: 'delete',
      oldValue: undefined,
      newValue: undefined,
    });
  }

  // ========== Internal ==========

  /**
   * Broadcast a UIUpdateEvent to all registered Tab callbacks.
   */
  private broadcastUIUpdate(event: UIUpdateEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb.onUIUpdate(event);
      } catch (err) {
        log.error('onUIUpdate callback error:', err);
      }
    }
  }

  /**
   * Request a token (used as RTCAgentClient callback).
   *
   * - Picks any registered requestToken callback
   * - On failure, tries the next one
   */
  private async requestToken(): Promise<string> {
    for (const cb of this.callbacks) {
      try {
        return await cb.requestToken();
      } catch (err) {
        log.warn('requestToken failed, trying next:', err);
      }
    }
    throw new Error('[WorkerCore] no callback available to provide token');
  }

  /**
   * Request a token refresh (used as RTCAgentClient's onTokenExpired callback).
   *
   * - Picks any registered requestTokenRefresh callback
   * - On failure, tries the next one
   * - When all callbacks fail, returns 'relogin' (requires user to log in again)
   */
  private async requestTokenRefresh(): Promise<TokenExpiredAction> {
    for (const cb of this.callbacks) {
      try {
        return await cb.requestTokenRefresh();
      } catch (err) {
        log.warn('requestTokenRefresh failed, trying next:', err);
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
   * Subscribe to RTCAgentClient connection state changes.
   *
   * Called after connect(); broadcasts connection state changes to all registered Tab callbacks.
   * Solves the problem that the main thread cannot directly access getClient().
   */
  private _subscribeConnectionState(layer: PersistenceLayer): void {
    this._unsubscribeConnectionState();
    const client = layer.getClient();
    log.debug('subscribing to connection state changes');
    this.unsubscribeConnection = client.on('connection', (event: ConnectionStateEvent) => {
      log.debug('connection state changed:', event.state, 'reason:', event.reason);
      this.broadcastConnectionState(event);
    });
  }

  /**
   * Unsubscribe from connection state changes.
   */
  private _unsubscribeConnectionState(): void {
    if (this.unsubscribeConnection) {
      this.unsubscribeConnection();
      this.unsubscribeConnection = null;
    }
  }

  /**
   * Broadcast a connection state change to all registered Tab callbacks.
   */
  private broadcastConnectionState(event: ConnectionStateEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb.onConnectionStateChange(event);
      } catch (err) {
        log.error('onConnectionStateChange callback error:', err);
      }
    }
  }
}
