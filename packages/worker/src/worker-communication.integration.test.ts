/**
 * Worker Communication Integration Tests
 *
 * Tests the SharedWorker lifecycle, Comlink proxy communication, and multi-tab scenarios.
 * These tests verify the integration between WorkerCore (worker thread) and the mocked
 * persistence layer.
 *
 * Key scenarios:
 * - SharedWorker initialization and health check
 * - Comlink proxy method invocation
 * - Multi-tab callback registration/broadcasting
 * - Connection state management
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerCore } from './worker-core.js';
import type { WorkerCallbacks } from './core-interface.js';
import type { ConnectionStateEvent, TokenExpiredAction } from '@rtc-agent/client';
import type { PersistenceConfig } from '@rtc-agent/persistence';

// Mock persistence layer
vi.mock('@rtc-agent/persistence', () => ({
  createPersistenceLayer: vi.fn(() => ({
    getFileOpCoordinator: vi.fn(() => ({
      onStatusChange: vi.fn(() => vi.fn()),
    })),
    getClient: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      getConnectionState: vi.fn(() => 'disconnected'),
      on: vi.fn(),
      off: vi.fn(),
    })),
    getSessionRepository: vi.fn(() => ({
      list: vi.fn(() => Promise.resolve([])),
    })),
    getMessageRepository: vi.fn(() => ({
      listBySession: vi.fn(() => Promise.resolve([])),
    })),
    getRtcRepository: vi.fn(() => ({
      listPending: vi.fn(() => Promise.resolve([])),
    })),
    getOffsetManager: vi.fn(() => ({
      getPosition: vi.fn(() => Promise.resolve(undefined)),
      updatePosition: vi.fn(),
      reset: vi.fn(),
    })),
    listSessions: vi.fn(() => Promise.resolve([])),
    listMessages: vi.fn(() => Promise.resolve([])),
    getCatchUpEvents: vi.fn(() => Promise.resolve([])),
  })),
  getUIUpdateBus: vi.fn(() => ({
    init: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => vi.fn()),
    publish: vi.fn(),
    clear: vi.fn(),
  })),
  getOffsetManager: vi.fn(() => ({
    getPosition: vi.fn(() => Promise.resolve(undefined)),
    updatePosition: vi.fn(),
    warmCache: vi.fn(),
    reset: vi.fn(),
  })),
  initializeVirtualFS: vi.fn(),
  virtualFS: {
    write: vi.fn(),
    read: vi.fn(),
    ls: vi.fn(),
  },
  getDatabase: vi.fn(() => ({
    ui_updates: {
      add: vi.fn(),
      where: vi.fn(() => ({
        above: vi.fn(() => ({
          limit: vi.fn(() => ({
            toArray: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    },
  })),
}));

vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Worker Communication Integration', () => {
  let workerCore: WorkerCore;
  let mockCallbacks: WorkerCallbacks;

  /** Build a minimal valid PersistenceConfig for testing. */
  function createTestConfig(): PersistenceConfig {
    return {
      databaseName: 'test-db',
      deviceId: 'test-device',
      userId: 'test-user',
      serverURL: 'http://localhost:8888',
      client: {
        endpoint: 'ws://localhost:8888/ws',
        getToken: () => Promise.resolve('test-token'),
        onTokenExpired: (): TokenExpiredAction => 'refresh',
        onAccountBanned: () => {},
        deviceId: 'test-device',
        userId: 'test-user',
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    workerCore = new WorkerCore();

    // Mock callback functions for a tab
    mockCallbacks = {
      onUIUpdate: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onGapFillState: vi.fn(),
      onStateGap: vi.fn(),
      onAccountBanned: vi.fn(),
      requestToken: vi.fn(() => Promise.resolve('mock-token')),
      requestTokenRefresh: vi.fn(() => Promise.resolve<TokenExpiredAction>('refresh')),
    };  });

  afterEach(async () => {
    // Cleanup
    try {
      await workerCore.close();
    } catch {
      // Ignore if not initialized
    }
    vi.restoreAllMocks();
  });

  describe('SharedWorker Lifecycle', () => {
    it('should initialize WorkerCore successfully', async () => {
      const config = createTestConfig();

      await workerCore.init(config);

      // Verify WorkerCore is initialized by calling a method
      const state = await workerCore.getConnectionState();
      expect(state).toBeDefined();
    });

    it('should be idempotent on multiple init calls', async () => {
      const config = createTestConfig();

      await workerCore.init(config);
      await workerCore.init(config); // Second call should be ignored

      // Should not throw and should work normally
      const state = await workerCore.getConnectionState();
      expect(state).toBeDefined();
    });

    it('should respond to ping after initialization', async () => {
      const config = createTestConfig();

      await workerCore.init(config);

      // ping() should work without requiring full initialization
      const result = await workerCore.ping();
      expect(result).toBe('pong');
    });
  });

  describe('Comlink Proxy Communication', () => {
    beforeEach(async () => {
      const config = createTestConfig();
      await workerCore.init(config);
    });

    it('should proxy listSessions call to persistence layer', async () => {
      const result = await workerCore.listSessions();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should proxy listMessages call to persistence layer', async () => {
      const result = await workerCore.listMessages('test-session');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should proxy getCatchUpEvents call', async () => {
      const result = await workerCore.getCatchUpEvents(0);
      expect(result).toBeDefined();
    });
  });

  describe('Multi-Tab Callback Management', () => {
    beforeEach(async () => {
      const config = createTestConfig();
      await workerCore.init(config);
    });

    it('should register callback for a tab', async () => {
      workerCore.registerCallback(mockCallbacks);

      // Verify callback is registered by checking internal state
      const callbacks = (workerCore as any).callbacks as Set<WorkerCallbacks>;
      expect(callbacks.size).toBe(1);
      expect(callbacks.has(mockCallbacks)).toBe(true);
    });

    it('should unregister callback when tab closes', async () => {
      workerCore.registerCallback(mockCallbacks);
      expect((workerCore as any).callbacks.size).toBe(1);

      workerCore.unregisterCallback(mockCallbacks);
      expect((workerCore as any).callbacks.size).toBe(0);
    });

    it('should support multiple tabs registering callbacks', async () => {
      const callbacks1: WorkerCallbacks = { ...mockCallbacks, onUIUpdate: vi.fn() };
      const callbacks2: WorkerCallbacks = { ...mockCallbacks, onUIUpdate: vi.fn() };
      const callbacks3: WorkerCallbacks = { ...mockCallbacks, onUIUpdate: vi.fn() };

      workerCore.registerCallback(callbacks1);
      workerCore.registerCallback(callbacks2);
      workerCore.registerCallback(callbacks3);

      expect((workerCore as any).callbacks.size).toBe(3);

      // Unregister one
      workerCore.unregisterCallback(callbacks2);
      expect((workerCore as any).callbacks.size).toBe(2);
    });

    it('should handle duplicate callback registration gracefully', async () => {
      workerCore.registerCallback(mockCallbacks);
      workerCore.registerCallback(mockCallbacks); // Same callback object

      // Set automatically deduplicates
      expect((workerCore as any).callbacks.size).toBe(1);
    });
  });

  describe('Connection State Management', () => {
    beforeEach(async () => {
      const config = createTestConfig();
      await workerCore.init(config);
    });

    it('should return initial connection state as disconnected', async () => {
      const state = await workerCore.getConnectionState();
      expect(state).toBe('disconnected');
    });

    it('should broadcast connection state changes to all registered tabs', async () => {
      const callbacks1: WorkerCallbacks = { ...mockCallbacks, onConnectionStateChange: vi.fn() };
      const callbacks2: WorkerCallbacks = { ...mockCallbacks, onConnectionStateChange: vi.fn() };

      workerCore.registerCallback(callbacks1);
      workerCore.registerCallback(callbacks2);

      // Simulate connection state change
      const event: ConnectionStateEvent = { state: 'connected' };
      (workerCore as any).broadcastConnectionState(event);

      // Both callbacks should be invoked
      expect(callbacks1.onConnectionStateChange).toHaveBeenCalledWith(event);
      expect(callbacks2.onConnectionStateChange).toHaveBeenCalledWith(event);
    });
  });

  describe('Token Request Forwarding', () => {
    it('should forward token request to registered callbacks', async () => {
      const config = createTestConfig();
      await workerCore.init(config);

      workerCore.registerCallback(mockCallbacks);

      // Trigger token request
      await (workerCore as any).requestToken();

      // Verify callback was invoked
      expect(mockCallbacks.requestToken).toHaveBeenCalled();
    });

    it('should forward token refresh request to registered callbacks', async () => {
      const config = createTestConfig();
      await workerCore.init(config);

      workerCore.registerCallback(mockCallbacks);

      // Trigger token refresh
      await (workerCore as any).requestTokenRefresh();

      // Verify callback was invoked
      expect(mockCallbacks.requestTokenRefresh).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle method calls before initialization gracefully', async () => {
      // Try to call methods without init()
      await expect(workerCore.listSessions()).rejects.toThrow();
    });

    it('should handle callback registration before initialization', async () => {
      // Register callback before init
      workerCore.registerCallback(mockCallbacks);

      // Should not throw
      expect((workerCore as any).callbacks.size).toBe(1);
    });
  });
});
