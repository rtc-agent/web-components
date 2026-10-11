/**
 * Complete Comlink Proxy Mock for Worker Tests
 *
 * Provides a type-safe, comprehensive mock implementation of WorkerPersistenceCore
 * interface for testing Worker-related code without actual Worker communication.
 *
 * Features:
 * - Type-safe mock implementations for all WorkerPersistenceCore methods
 * - Configurable default behaviors
 * - Easy customization per test case
 * - Proper async/Promise handling
 *
 * @example
 * ```typescript
 * import { createWorkerBridgeMock } from './test-utils/comlink-mock.js';
 *
 * describe('Worker Tests', () => {
 *   let mockBridge: ReturnType<typeof createWorkerBridgeMock>;
 *
 *   beforeEach(() => {
 *     mockBridge = createWorkerBridgeMock();
 *   });
 *
 *   it('should call listSessions', async () => {
 *     mockBridge.listSessions.mockResolvedValue([
 *       { id: '1', title: 'Test Session' }
 *     ]);
 *
 *     const sessions = await mockBridge.listSessions();
 *     expect(sessions).toHaveLength(1);
 *   });
 * });
 * ```
 */
import { vi } from 'vitest';
import type { WorkerCallbacks } from '../core-interface.js';
import type { ConnectionState } from '@rtc-agent/client';
import type { PersistenceConfig } from '@rtc-agent/persistence';

/**
 * Creates a complete mock of the WorkerPersistenceCore interface.
 *
 * All methods are mocked with sensible defaults that can be overridden per test.
 * The mock is fully type-safe and matches the WorkerPersistenceCore interface exactly.
 */
export function createWorkerBridgeMock() {
  return {
    // ========== Initialization ==========
    init: vi
      .fn<(config: PersistenceConfig) => Promise<void>>()
      .mockResolvedValue(undefined),

    // ========== Callback Management ==========
    registerCallback: vi.fn<(cb: WorkerCallbacks) => void>(),
    unregisterCallback: vi.fn<(cb: WorkerCallbacks) => void>(),

    // ========== Catch-Up Events ==========
    getCatchUpEvents: vi
      .fn<
        (
          fromSeq: number,
          limit?: number,
        ) => Promise<{
          entries: any[];
          hasGap: boolean;
          hasMore: boolean;
        }>
      >()
      .mockResolvedValue({
        entries: [],
        hasGap: false,
        hasMore: false,
      }),

    // ========== Health Check ==========
    ping: vi.fn<() => string>().mockReturnValue('pong'),

    // ========== Connection ==========
    connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: vi.fn<() => void>(),
    reconnect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getConnectionState: vi
      .fn<() => Promise<ConnectionState>>()
      .mockResolvedValue('disconnected' as ConnectionState),

    // ========== Queries ==========
    listSessions: vi
      .fn<(cursor?: string, limit?: number) => Promise<any[]>>()
      .mockResolvedValue([]),
    getSession: vi
      .fn<(clientId: string) => Promise<any | undefined>>()
      .mockResolvedValue(undefined),
    listMessages: vi
      .fn<
        (
          sessionClientId: string,
          cursor?: string,
          limit?: number,
          direction?: 'backward' | 'forward',
        ) => Promise<any[]>
      >()
      .mockResolvedValue([]),
    getMessage: vi
      .fn<(clientId: string) => Promise<any | undefined>>()
      .mockResolvedValue(undefined),
    listRtc: vi
      .fn<
        (
          sessionClientId: string,
          cursor?: number,
          limit?: number,
        ) => Promise<any[]>
      >()
      .mockResolvedValue([]),
    getNextRtcToProcess: vi
      .fn<(sessionClientId?: string) => Promise<any | undefined>>()
      .mockResolvedValue(undefined),

    // ========== Debug History ==========
    addDebugHistoryItem: vi
      .fn<(item: any) => Promise<void>>()
      .mockResolvedValue(undefined),
    queryDebugHistory: vi
      .fn<
        (
          functionName?: string,
          cursor?: string,
          limit?: number,
        ) => Promise<{ items: any[]; nextCursor?: string }>
      >()
      .mockResolvedValue({ items: [] }),
    countDebugHistory: vi
      .fn<(functionName?: string) => Promise<number>>()
      .mockResolvedValue(0),
    clearDebugHistory: vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    batchDeleteDebugHistory: vi
      .fn<(ids: string[]) => Promise<void>>()
      .mockResolvedValue(undefined),

    // ========== Operations ==========
    sendMessage: vi
      .fn<
        (params: {
          content: any;
          messageClientId: string;
          sessionClientId: string;
        }) => Promise<{ session: any; message: any }>
      >()
      .mockResolvedValue({
        session: { clientId: 'test-session' },
        message: { clientId: 'test-message' },
      }),

    insertLocalMessage: vi
      .fn<
        (params: {
          sessionClientId: string;
          role: 'user' | 'assistant' | 'tool' | 'system';
          content: string;
          creatorKind?: string;
          creatorRefId?: string;
        }) => Promise<any>
      >()
      .mockResolvedValue({ clientId: 'test-message' }),

    stopTurn: vi
      .fn<(sessionClientId: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    closeSession: vi
      .fn<(sessionClientId: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    openSession: vi
      .fn<(sessionClientId: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    compactSession: vi
      .fn<
        (sessionClientId: string, customInstruction?: string) => Promise<void>
      >()
      .mockResolvedValue(undefined),

    submitRtcResult: vi
      .fn<
        (params: {
          rtcClientId: string;
          success: boolean;
          result?: unknown;
          error?: string;
        }) => Promise<void>
      >()
      .mockResolvedValue(undefined),

    forkSession: vi
      .fn<
        (params: {
          oldSessionClientId: string;
          oldMessageClientId: string;
          newSessionClientId: string;
          newMessageClientId: string;
          content: any;
          limit?: number;
        }) => Promise<{ session: any; message: any }>
      >()
      .mockResolvedValue({
        session: { clientId: 'new-session' },
        message: { clientId: 'new-message' },
      }),

    deleteSession: vi
      .fn<(sessionClientId: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    updateSessionTitle: vi
      .fn<(sessionClientId: string, title: string) => Promise<void>>()
      .mockResolvedValue(undefined),

    // ========== Lifecycle ==========
    close: vi
      .fn<(callerCallback?: WorkerCallbacks) => Promise<void>>()
      .mockResolvedValue(undefined),
    flushAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),

    // ========== Virtual File System ==========
    initializeVirtualFS: vi
      .fn<(config?: any) => Promise<void>>()
      .mockResolvedValue(undefined),

    batchWriteFiles: vi
      .fn<
        (
          files: Array<{
            path: string;
            content: string;
            metadata?: any;
          }>,
          deletePaths?: string[],
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),

    resetOffset: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),

    // ========== virtualFS proxy ==========
    virtualFSRead: vi
      .fn<(path: string, offset?: number, limit?: number) => Promise<string>>()
      .mockResolvedValue(''),
    virtualFSWrite: vi
      .fn<
        (
          path: string,
          content: string,
          mode: 'overwrite' | 'append',
          metadataOverride?: any,
        ) => Promise<number>
      >()
      .mockResolvedValue(0),
    virtualFSLs: vi
      .fn<(path?: string) => Promise<string[]>>()
      .mockResolvedValue([]),
    virtualFSFind: vi
      .fn<(pattern: string, path?: string) => Promise<string[]>>()
      .mockResolvedValue([]),
    virtualFSGrep: vi
      .fn<
        (
          pattern: string,
          path?: string,
          caseSensitive?: boolean,
          maxResults?: number,
        ) => Promise<{ matches: any[]; truncated: boolean }>
      >()
      .mockResolvedValue({ matches: [], truncated: false }),
    virtualFSQueryByType: vi
      .fn<(type: string) => Promise<any[]>>()
      .mockResolvedValue([]),
    virtualFSExists: vi
      .fn<(path: string) => Promise<boolean>>()
      .mockResolvedValue(false),
    virtualFSRemove: vi
      .fn<(path: string) => Promise<void>>()
      .mockResolvedValue(undefined),

    // ========== File Cache & S3 Operations ==========
    cacheFile: vi
      .fn<
        (
          md5: string,
          ext: string,
          blob: Blob,
          contentType: string,
          ttlMs?: number,
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),

    cacheFilePending: vi
      .fn<
        (
          md5: string,
          ext: string,
          blob: Blob,
          contentType: string,
          filename?: string,
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),

    getCachedFile: vi
      .fn<(md5: string, ext: string) => Promise<any | null>>()
      .mockResolvedValue(null),

    evictExpiredCache: vi.fn<() => Promise<number>>().mockResolvedValue(0),

    evictCache: vi
      .fn<
        (
          targetBytes?: number,
        ) => Promise<{ evictedCount: number; evictedBytes: number }>
      >()
      .mockResolvedValue({ evictedCount: 0, evictedBytes: 0 }),

    uploadFile: vi
      .fn<
        (
          md5: string,
          ext: string,
          blob: Blob,
          contentType?: string,
          filename?: string,
          operationId?: string,
          onProgress?: (loaded: number, total: number) => void,
          cacheTtlMs?: number,
        ) => Promise<{
          syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
          syncedAt?: number;
          errorMessage?: string;
        }>
      >()
      .mockResolvedValue({
        syncStatus: 'synced',
        syncedAt: Date.now(),
      }),

    downloadFile: vi
      .fn<
        (
          md5: string,
          ext: string,
          onProgress?: (loaded: number, total: number) => void,
          operationId?: string,
          forceRefresh?: boolean,
        ) => Promise<Blob>
      >()
      .mockResolvedValue(new Blob(['test content'])),

    cancelFileOperation: vi.fn<(operationId: string) => void>(),

    deleteFile: vi
      .fn<(md5: string, ext: string) => Promise<void>>()
      .mockResolvedValue(undefined),

    // ========== MD5 Calculation ==========
    calculateFileMD5: vi
      .fn<(blob: Blob) => Promise<string>>()
      .mockResolvedValue('00000000000000000000000000000000'), // 32 zeros

    // ========== S3 Metadata Operations ==========
    headFile: vi
      .fn<(md5: string, ext: string) => Promise<any>>()
      .mockResolvedValue({
        contentLength: 0,
        contentType: 'application/octet-stream',
        lastModified: new Date(),
        etag: '"00000000000000000000000000000000"',
      }),

    getPresignedUrl: vi
      .fn<
        (
          operation: 'get' | 'put',
          key: string,
          expiresIn?: number,
        ) => Promise<string>
      >()
      .mockResolvedValue('https://example.com/presigned-url'),

    // ========== File List & Count ==========
    listFiles: vi
      .fn<
        (syncStatus?: any, limit?: number, offset?: number) => Promise<any[]>
      >()
      .mockResolvedValue([]),

    countFiles: vi
      .fn<(syncStatus?: any) => Promise<number>>()
      .mockResolvedValue(0),

    syncPendingFiles: vi
      .fn<
        () => Promise<{
          synced: number;
          failed: number;
          syncedFiles: Array<{ md5: string; ext: string }>;
          failedFiles: Array<{
            md5: string;
            ext: string;
            errorMessage?: string;
          }>;
        }>
      >()
      .mockResolvedValue({
        synced: 0,
        failed: 0,
        syncedFiles: [],
        failedFiles: [],
      }),

    resumeInterruptedUploads: vi
      .fn<
        () => Promise<{
          resumed: number;
          failed: number;
          expired: number;
          syncedFiles: Array<{ md5: string; ext: string }>;
          failedFiles: Array<{
            md5: string;
            ext: string;
            errorMessage?: string;
          }>;
        }>
      >()
      .mockResolvedValue({
        resumed: 0,
        failed: 0,
        expired: 0,
        syncedFiles: [],
        failedFiles: [],
      }),

    getCacheStats: vi
      .fn<
        () => Promise<{
          totalFiles: number;
          totalSize: number;
          byStatus: {
            pending: { count: number; size: number };
            syncing: { count: number; size: number };
            synced: { count: number; size: number };
            failed: { count: number; size: number };
          };
        }>
      >()
      .mockResolvedValue({
        totalFiles: 0,
        totalSize: 0,
        byStatus: {
          pending: { count: 0, size: 0 },
          syncing: { count: 0, size: 0 },
          synced: { count: 0, size: 0 },
          failed: { count: 0, size: 0 },
        },
      }),

    updateFileMetadata: vi
      .fn<
        (
          md5: string,
          ext: string,
          updates: { filename?: string; contentType?: string },
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),
  } as const;
}

/**
 * Type helper: Extract the return type of createWorkerBridgeMock
 */
export type WorkerBridgeMock = ReturnType<typeof createWorkerBridgeMock>;

/**
 * Creates a mock WorkerCallbacks object for testing callback registration.
 *
 * @example
 * ```typescript
 * const mockCallbacks = createWorkerCallbacksMock();
 * workerCore.registerCallback(mockCallbacks);
 *
 * // Trigger some event
 * await mockCallbacks.onUIUpdate({ event: {...}, seq: 1 });
 * expect(mockCallbacks.onUIUpdate).toHaveBeenCalled();
 * ```
 */
export function createWorkerCallbacksMock() {
  return {
    onUIUpdate: vi.fn<(payload: any) => Promise<void> | void>(),
    requestToken: vi
      .fn<() => Promise<string>>()
      .mockResolvedValue('mock-token'),
    requestTokenRefresh: vi
      .fn<() => Promise<'refresh' | 'relogin'>>()
      .mockResolvedValue('refresh'),
    onConnectionStateChange: vi.fn<(event: any) => void>(),
    onGapFillState: vi.fn<(isSyncing: boolean) => void>(),
    onStateGap: vi.fn<() => void>(),
    onAccountBanned: vi.fn<(reason: string) => void>(),
  } as const;
}

/**
 * Type helper: Extract the return type of createWorkerCallbacksMock
 */
export type WorkerCallbacksMock = ReturnType<typeof createWorkerCallbacksMock>;
