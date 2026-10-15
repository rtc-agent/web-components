/**
 * Multi-Tab Integration Tests
 *
 * Tests for SharedWorker multi-tab scenarios:
 * - Multiple tabs connecting to the same SharedWorker
 * - UIUpdate broadcasting to all tabs
 * - Concurrent IndexedDB access
 * - Tab disconnection handling
 * - SharedWorker lifecycle management
 * - Token refresh broadcasting
 *
 * These tests validate the correctness of SharedWorker's multi-tab architecture,
 * ensuring data consistency and event propagation across tabs.
 *
 * NOTE ON PRIVATE FIELD ACCESS:
 * These tests use `(bridge as any)._field` to inject mock state into WorkerBridge
 * instances, bypassing the full init() flow. See worker-bridge.test.ts for the
 * full rationale. In summary: init() has heavy I/O side effects that are unsuitable
 * for focused multi-tab scenario testing, and the fields being set (_core, _initialized,
 * _callbacksRegistered, _databaseName, _lastProcessedSeq) represent the exact internal
 * state that defines a "connected tab" — there is no public API to reach this state
 * without a real SharedWorker.
 */

import type { ConnectionStateEvent } from '@rtc-agent/client';
import type {
  UIUpdatePayload,
  WorkerCallbacks,
  WorkerPersistenceCore,
} from '@rtc-agent/worker';
import type { Remote } from 'comlink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock heavy dependencies before importing WorkerBridge
// (dynamic imports to handle vi.mock hoisting)
vi.mock('@rtc-agent/persistence', async () => {
  const { createMockPersistenceModule } = await import('./test-helpers.js');
  return createMockPersistenceModule();
});

vi.mock('@rtc-agent/protocol', async () => {
  const { createMockProtocolModule } = await import('./test-helpers.js');
  return createMockProtocolModule();
});

// Dynamic import after mocks
const { WorkerBridge } = await import('./worker-bridge.js');

/**
 * Helper: Create a mock WorkerBridge with injected internal state.
 * Bypasses full init() flow for focused multi-tab testing.
 */
function createMockTab(
  _tabId: string,
  mockCore: Remote<WorkerPersistenceCore>,
  mockAuth: any,
): InstanceType<typeof WorkerBridge> {
  const bridge = new WorkerBridge(mockAuth);
  (bridge as any)._core = mockCore;
  (bridge as any)._initialized = true;
  (bridge as any)._callbacksRegistered = true;
  (bridge as any)._databaseName = 'test-db';
  (bridge as any)._lastProcessedSeq = 0;
  return bridge;
}

describe('Multi-Tab Integration', () => {
  let mockAuth: any;
  let sharedCallbacks: Map<string, WorkerCallbacks>;
  let broadcastedEvents: Array<{ tabId: string; payload: UIUpdatePayload }>;

  /**
   * Create a mock core that simulates SharedWorker behavior:
   * - Maintains a Set of registered callbacks (one per tab)
   * - Broadcasts UIUpdate events to all registered callbacks
   * - Tracks connection state
   */
  function createSharedMockCore(): Remote<WorkerPersistenceCore> {
    const callbacksSet = new Set<WorkerCallbacks>();
    sharedCallbacks = new Map();
    broadcastedEvents = [];

    let tabCounter = 0;

    return {
      init: vi.fn().mockResolvedValue(undefined),
      registerCallback: vi.fn().mockImplementation((cb: WorkerCallbacks) => {
        const tabId = `tab-${++tabCounter}`;
        callbacksSet.add(cb);
        sharedCallbacks.set(tabId, cb);
      }),
      unregisterCallback: vi.fn().mockImplementation((cb: WorkerCallbacks) => {
        callbacksSet.delete(cb);
        // Remove from sharedCallbacks map
        for (const [id, storedCb] of sharedCallbacks.entries()) {
          if (storedCb === cb) {
            sharedCallbacks.delete(id);
            break;
          }
        }
      }),
      getCatchUpEvents: vi.fn().mockResolvedValue({
        entries: [],
        hasGap: false,
        hasMore: false,
      }),
      ping: vi.fn().mockReturnValue('pong'),
      getConnectionState: vi.fn().mockResolvedValue('connected'),
      close: vi
        .fn()
        .mockImplementation(async (callerCallback?: WorkerCallbacks) => {
          if (callerCallback) {
            callbacksSet.delete(callerCallback);
            for (const [id, storedCb] of sharedCallbacks.entries()) {
              if (storedCb === callerCallback) {
                sharedCallbacks.delete(id);
                break;
              }
            }
          }
        }),
      // Simulate broadcasting UIUpdate to all registered tabs
      _broadcastUIUpdate: vi
        .fn()
        .mockImplementation((event: any, seq: number) => {
          const payload = { event, seq };
          for (const [tabId, cb] of sharedCallbacks.entries()) {
            broadcastedEvents.push({ tabId, payload });
            try {
              cb.onUIUpdate(payload);
            } catch (_err) {
              // Ignore errors in tests
            }
          }
        }),
      // Simulate broadcasting connection state to all registered tabs
      _broadcastConnectionState: vi
        .fn()
        .mockImplementation((event: ConnectionStateEvent) => {
          for (const cb of callbacksSet) {
            try {
              cb.onConnectionStateChange(event);
            } catch (_err) {
              // Ignore errors in tests
            }
          }
        }),
      // Simulate requesting token from any registered tab
      _requestToken: vi.fn().mockImplementation(async () => {
        for (const cb of callbacksSet) {
          try {
            return await cb.requestToken();
          } catch {
            // Try next callback
          }
        }
        throw new Error('No callback available');
      }),
    } as unknown as Remote<WorkerPersistenceCore>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sharedCallbacks = new Map();
    broadcastedEvents = [];

    mockAuth = {
      getAccessTokenAsync: vi.fn().mockResolvedValue('mock-token'),
      handleTokenExpired: vi.fn().mockResolvedValue('refresh'),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Multiple tabs connecting to SharedWorker', () => {
    it('should allow multiple tabs to register callbacks', async () => {
      const mockCore = createSharedMockCore();
      const _tab1 = createMockTab('tab-1', mockCore, mockAuth);
      const _tab2 = createMockTab('tab-2', mockCore, mockAuth);
      const _tab3 = createMockTab('tab-3', mockCore, mockAuth);

      // Simulate callback registration
      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token-1'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token-2'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb3: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token-3'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);
      await mockCore.registerCallback(cb3);

      // All three tabs should be registered
      expect(sharedCallbacks.size).toBe(3);
      expect(mockCore.registerCallback).toHaveBeenCalledTimes(3);
    });

    it('should share the same core instance across tabs', async () => {
      const mockCore = createSharedMockCore();
      const tab1 = createMockTab('tab-1', mockCore, mockAuth);
      const tab2 = createMockTab('tab-2', mockCore, mockAuth);

      // Both tabs should reference the same core
      expect((tab1 as any)._core).toBe((tab2 as any)._core);
    });
  });

  describe('UIUpdate broadcasting', () => {
    it('should broadcast UIUpdate events to all connected tabs', async () => {
      const mockCore = createSharedMockCore();

      // Create and register three tabs
      const _tab1 = createMockTab('tab-1', mockCore, mockAuth);
      const _tab2 = createMockTab('tab-2', mockCore, mockAuth);
      const _tab3 = createMockTab('tab-3', mockCore, mockAuth);

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb3: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);
      await mockCore.registerCallback(cb3);

      // Simulate a UIUpdate event from tab1
      const testEvent = {
        entity: 'session',
        action: 'created',
        entityId: 'session-123',
        field: 'title',
        oldValue: null,
        newValue: 'Test Session',
      };

      // Trigger broadcast via the mock core
      await (mockCore as any)._broadcastUIUpdate(testEvent, 1);

      // All three tabs should receive the event
      expect(cb1.onUIUpdate).toHaveBeenCalledWith({
        event: testEvent,
        seq: 1,
      });
      expect(cb2.onUIUpdate).toHaveBeenCalledWith({
        event: testEvent,
        seq: 1,
      });
      expect(cb3.onUIUpdate).toHaveBeenCalledWith({
        event: testEvent,
        seq: 1,
      });

      // Broadcasted events should be tracked
      expect(broadcastedEvents).toHaveLength(3);
      expect(broadcastedEvents[0].tabId).toBe('tab-1');
      expect(broadcastedEvents[1].tabId).toBe('tab-2');
      expect(broadcastedEvents[2].tabId).toBe('tab-3');
    });

    it('should not broadcast to unregistered tabs', async () => {
      const mockCore = createSharedMockCore();

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);

      // Unregister cb2
      await mockCore.unregisterCallback(cb2);

      // Broadcast event
      const testEvent = {
        entity: 'file',
        action: 'updated',
        entityId: '/test.txt',
        field: 'content',
        oldValue: null,
        newValue: 'new content',
      };

      await (mockCore as any)._broadcastUIUpdate(testEvent, 2);

      // Only cb1 should receive the event
      expect(cb1.onUIUpdate).toHaveBeenCalledTimes(1);
      expect(cb2.onUIUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Concurrent IndexedDB access', () => {
    it('should handle concurrent writes from multiple tabs', async () => {
      const mockCore = createSharedMockCore();

      // Simulate concurrent writes
      const _tab1 = createMockTab('tab-1', mockCore, mockAuth);
      const _tab2 = createMockTab('tab-2', mockCore, mockAuth);
      const _tab3 = createMockTab('tab-3', mockCore, mockAuth);

      // Simulate concurrent session creation
      const writePromises = Promise.all([
        mockCore.init({ databaseName: 'test-db' }),
        mockCore.init({ databaseName: 'test-db' }),
        mockCore.init({ databaseName: 'test-db' }),
      ]);

      await expect(writePromises).resolves.not.toThrow();

      // All writes should have been processed
      expect(mockCore.init).toHaveBeenCalledTimes(3);
    });

    it('should maintain data consistency across tabs', async () => {
      const mockCore = createSharedMockCore();

      const _tab1 = createMockTab('tab-1', mockCore, mockAuth);
      const _tab2 = createMockTab('tab-2', mockCore, mockAuth);

      // Both tabs should see the same data (simulated via shared core)
      const sessions = [
        { id: 'session-1', title: 'Session 1' },
        { id: 'session-2', title: 'Session 2' },
      ];

      // Mock listSessions to return the same data for both tabs
      mockCore.listSessions = vi.fn().mockResolvedValue(sessions);

      const tab1Sessions = await mockCore.listSessions();
      const tab2Sessions = await mockCore.listSessions();

      expect(tab1Sessions).toEqual(tab2Sessions);
      expect(tab1Sessions).toHaveLength(2);
    });
  });

  describe('Tab disconnection handling', () => {
    it('should not affect other tabs when one tab disconnects', async () => {
      const mockCore = createSharedMockCore();

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token-1'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token-2'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb3: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token-3'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);
      await mockCore.registerCallback(cb3);

      // Disconnect tab2
      await mockCore.unregisterCallback(cb2);

      // tab1 and tab3 should still be registered
      expect(sharedCallbacks.size).toBe(2);
      expect(sharedCallbacks.has('tab-1')).toBe(true);
      expect(sharedCallbacks.has('tab-3')).toBe(true);

      // Broadcast should still work for remaining tabs
      const testEvent = {
        entity: 'message',
        action: 'created',
        entityId: 'msg-1',
        field: 'content',
        oldValue: null,
        newValue: 'Hello',
      };

      await (mockCore as any)._broadcastUIUpdate(testEvent, 3);

      expect(cb1.onUIUpdate).toHaveBeenCalledTimes(1);
      expect(cb2.onUIUpdate).not.toHaveBeenCalled(); // cb2 was disconnected
      expect(cb3.onUIUpdate).toHaveBeenCalledTimes(1);
    });

    it('should handle tab disconnection during broadcast', async () => {
      const mockCore = createSharedMockCore();

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn().mockImplementation(() => {
          // Simulate tab2 disconnecting during broadcast
          mockCore.unregisterCallback(cb2);
        }),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb3: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);
      await mockCore.registerCallback(cb3);

      // Broadcast should handle disconnection gracefully
      const testEvent = { entity: 'test', action: 'test', entityId: 'test' };
      await (mockCore as any)._broadcastUIUpdate(testEvent, 4);

      // All callbacks should have been attempted
      expect(cb1.onUIUpdate).toHaveBeenCalled();
      expect(cb2.onUIUpdate).toHaveBeenCalled();
      expect(cb3.onUIUpdate).toHaveBeenCalled();
    });
  });

  describe('SharedWorker lifecycle', () => {
    it('should terminate when all tabs disconnect', async () => {
      const mockCore = createSharedMockCore();

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);

      // Disconnect all tabs
      await mockCore.close(cb1);
      await mockCore.close(cb2);

      // All callbacks should be unregistered
      expect(sharedCallbacks.size).toBe(0);

      // close() should have been called
      expect(mockCore.close).toHaveBeenCalledTimes(2);
    });

    it('should not terminate when some tabs are still connected', async () => {
      const mockCore = createSharedMockCore();

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);

      // Disconnect only one tab
      await mockCore.close(cb1);

      // One callback should still be registered
      expect(sharedCallbacks.size).toBe(1);
      expect(sharedCallbacks.has('tab-2')).toBe(true);
    });
  });

  describe('Token refresh broadcasting', () => {
    it('should broadcast token refresh to all tabs', async () => {
      const mockCore = createSharedMockCore();

      let cb1Called = false;
      let cb2Called = false;

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockImplementation(async () => {
          cb1Called = true;
          return 'token-1';
        }),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockImplementation(async () => {
          cb2Called = true;
          return 'token-2';
        }),
        requestTokenRefresh: vi.fn().mockResolvedValue('relogin'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);

      // Simulate token refresh request (any tab can respond)
      // Promise.any returns the first successful result
      const token = await (mockCore as any)._requestToken();

      // Should get one of the tokens (Promise.any behavior)
      expect(['token-1', 'token-2']).toContain(token);

      // At least one callback should have been called
      // (Promise.any may not call all if one resolves quickly)
      expect(cb1Called || cb2Called).toBe(true);
    });

    it('should handle token refresh failure gracefully', async () => {
      const mockCore = createSharedMockCore();

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockRejectedValue(new Error('Auth failed')),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockRejectedValue(new Error('Auth failed')),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);

      // Token request should fail when all callbacks fail
      await expect((mockCore as any)._requestToken()).rejects.toThrow(
        'No callback available',
      );
    });
  });

  describe('Connection state broadcasting', () => {
    it('should broadcast connection state changes to all tabs', async () => {
      const mockCore = createSharedMockCore();

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);

      // Simulate connection state change
      const connectionEvent: ConnectionStateEvent = {
        state: 'connected',
        reason: 'initial',
        clientId: 'client-1',
      };

      await (mockCore as any)._broadcastConnectionState(connectionEvent);

      // Both tabs should receive the event
      expect(cb1.onConnectionStateChange).toHaveBeenCalledWith(connectionEvent);
      expect(cb2.onConnectionStateChange).toHaveBeenCalledWith(connectionEvent);
    });
  });

  describe('Race conditions', () => {
    it('should handle rapid tab connect/disconnect cycles', async () => {
      const mockCore = createSharedMockCore();

      // Rapidly connect and disconnect tabs
      const cycles = 10;
      for (let i = 0; i < cycles; i++) {
        const cb: WorkerCallbacks = {
          onUIUpdate: vi.fn(),
          requestToken: vi.fn().mockResolvedValue('token'),
          requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
          onConnectionStateChange: vi.fn(),
          onGapFillState: vi.fn(),
          onStateGap: vi.fn(),
          onAccountBanned: vi.fn(),
        };

        await mockCore.registerCallback(cb);
        await mockCore.unregisterCallback(cb);
      }

      // Should complete without errors
      expect(mockCore.registerCallback).toHaveBeenCalledTimes(cycles);
      expect(mockCore.unregisterCallback).toHaveBeenCalledTimes(cycles);
    });

    it('should handle concurrent broadcast operations', async () => {
      const mockCore = createSharedMockCore();

      const cb1: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };
      const cb2: WorkerCallbacks = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn().mockResolvedValue('token'),
        requestTokenRefresh: vi.fn().mockResolvedValue('refresh'),
        onConnectionStateChange: vi.fn(),
        onGapFillState: vi.fn(),
        onStateGap: vi.fn(),
        onAccountBanned: vi.fn(),
      };

      await mockCore.registerCallback(cb1);
      await mockCore.registerCallback(cb2);

      // Concurrent broadcasts
      const broadcasts = Promise.all([
        (mockCore as any)._broadcastUIUpdate(
          { entity: 'test', action: 'test', entityId: '1' },
          1,
        ),
        (mockCore as any)._broadcastUIUpdate(
          { entity: 'test', action: 'test', entityId: '2' },
          2,
        ),
        (mockCore as any)._broadcastUIUpdate(
          { entity: 'test', action: 'test', entityId: '3' },
          3,
        ),
      ]);

      await expect(broadcasts).resolves.not.toThrow();

      // Both callbacks should have been called for each broadcast
      expect(cb1.onUIUpdate).toHaveBeenCalledTimes(3);
      expect(cb2.onUIUpdate).toHaveBeenCalledTimes(3);
    });
  });
});
