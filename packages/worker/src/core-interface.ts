import type { ContentData } from '@rtc-agent/protocol';
import type { ConnectionState, ConnectionStateEvent } from '@rtc-agent/client';
import type { PersistenceConfig, AgentMdConfig, FileSystemMetadataOverride } from '@rtc-agent/persistence';
import type { UIUpdateEvent, LocalSession, LocalMessage, LocalRtc } from '@rtc-agent/persistence';

/**
 * Worker-side callbacks: each connected Tab registers its own set.
 *
 * - onUIUpdate: Worker broadcasts entity changes to this Tab
 * - requestToken: Centrifuge requests a token from any Tab when needed
 * - requestTokenRefresh: Centrifuge requests a token refresh from any Tab when expired
 * - onConnectionStateChange: Worker broadcasts RTCAgentClient connection state changes to this Tab
 */
export interface WorkerCallbacks {
  onUIUpdate: (event: UIUpdateEvent) => void;
  requestToken: () => Promise<string>;
  requestTokenRefresh: () => Promise<'refresh' | 'relogin'>;
  onConnectionStateChange: (event: ConnectionStateEvent) => void;
}

/**
 * WorkerPersistenceCore: the interface exposed by the Worker side.
 *
 * - init(): Initialize shared state (only the first Tab actually executes; subsequent calls are idempotent)
 * - registerCallback / unregisterCallback: manage per-Tab callbacks
 * - Other methods pass through to PersistenceLayer
 */
export interface WorkerPersistenceCore {
  init(config: PersistenceConfig): Promise<void>;

  /** Register a Tab's callbacks (called by facade on connect) */
  registerCallback(cb: WorkerCallbacks): void;
  /** Unregister a Tab's callbacks */
  unregisterCallback(cb: WorkerCallbacks): void;

  /**
   * Health check: verify the Worker is running.
   *
   * Works without init(); used by the main thread to verify that the
   * SharedWorker started successfully.
   */
  ping(): string;

  // ========== Connection ==========
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;
  getConnectionState(): Promise<ConnectionState>;

  // ========== Queries ==========
  listSessions(cursor?: string, limit?: number): Promise<LocalSession[]>;
  getSession(clientId: string): Promise<LocalSession | undefined>;
  listMessages(
    sessionClientId: string,
    cursor?: string,
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

  // ========== Operations ==========
  sendMessage(params: {
    content: ContentData;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: LocalSession; message: LocalMessage }>;

  /** Insert a local message (not sent to server) */
  insertLocalMessage(params: {
    sessionClientId: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    creatorKind?: string;
    creatorRefId?: string;
  }): Promise<LocalMessage>;

  stopTurn(sessionClientId: string): Promise<void>;

  /** Close session (notify backend to stop turn loop) */
  closeSession(sessionClientId: string): Promise<void>;

  /** Reopen a closed session */
  openSession(sessionClientId: string): Promise<void>;

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

  /** Soft-delete session (local optimistic update + async RPC sync) */
  deleteSession(sessionClientId: string): Promise<void>;

  /** Update session title (local optimistic update + async RPC sync) */
  updateSessionTitle(sessionClientId: string, title: string): Promise<void>;

  // ========== Lifecycle ==========
  close(): Promise<void>;
  flushAll(): Promise<void>;

  // ========== Additional capabilities ==========

  /**
   * Initialize the virtual file system (AGENT.md).
   *
   * VirtualFS runs inside the Worker (sharing the same IndexedDB),
   * so it must be invoked via Comlink rather than calling initializeVirtualFS
   * directly on the main thread.
   */
  initializeVirtualFS(config?: AgentMdConfig): Promise<void>;

  /**
   * Batch-write files to the virtual file system.
   *
   * The main thread cannot directly access Worker-internal VirtualFS/IndexedDB;
   * this method sends file content to the Worker for writing.
   */
  batchWriteFiles(files: Array<{
    path: string;
    content: string;
    metadata?: FileSystemMetadataOverride;
  }>): Promise<void>;

  /**
   * Reset OffsetManager cache (equivalent to getOffsetManager().reset()).
   *
   * The main thread cannot access Worker-internal OffsetManager;
   * this method passes the reset call through.
   */
  resetOffset(): Promise<void>;

  // ========== virtualFS proxy (main thread -> Worker) ==========

  /**
   * Read a virtual file (executed inside Worker: getDatabase + read).
   *
   * The main thread cannot directly access IndexedDB;
   * this method proxies virtualFS.read calls into the Worker.
   */
  virtualFSRead(path: string, offset?: number, limit?: number): Promise<string>;

  /**
   * Write a virtual file (executed inside Worker).
   */
  virtualFSWrite(
    path: string,
    content: string,
    mode: 'overwrite' | 'append',
    metadataOverride?: FileSystemMetadataOverride,
  ): Promise<number>;

  /**
   * List directory contents (executed inside Worker).
   */
  virtualFSLs(path?: string): Promise<string[]>;

  /**
   * Search by file name (executed inside Worker).
   */
  virtualFSFind(pattern: string, path?: string): Promise<string[]>;

  /**
   * Search file contents (executed inside Worker).
   */
  virtualFSGrep(
    pattern: string,
    path?: string,
    caseSensitive?: boolean,
    maxResults?: number,
  ): Promise<Array<{ file: string; line: string; lineNumber: number }>>;

  /**
   * Query files by type (executed inside Worker).
   *
   * Return type matches persistence package's FileSystemEntry;
   * Date fields are preserved as Date instances during Comlink transport.
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
   * Check if a file exists (executed inside Worker).
   */
  virtualFSExists(path: string): Promise<boolean>;

  /**
   * Delete a file (executed inside Worker).
   */
  virtualFSRemove(path: string): Promise<void>;
}
