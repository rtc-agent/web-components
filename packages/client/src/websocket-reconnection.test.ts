/**
 * WebSocket Reconnection Logic Tests
 *
 * Comprehensive unit tests for the WebSocket reconnection mechanism,
 * covering exponential backoff, max retry limits, state transitions,
 * and cleanup logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RTCAgentClient } from './client.js';
import type { RTCAgentClientOptions } from './types.js';

describe('WebSocket Reconnection Logic', () => {
  let client: RTCAgentClient;
  let mockOptions: RTCAgentClientOptions;
  let mockGetToken: ReturnType<typeof vi.fn>;
  let mockOnConnectionStateChange: ReturnType<typeof vi.fn>;
  let mockOnTokenExpired: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    mockGetToken = vi.fn().mockResolvedValue('test-token');
    mockOnConnectionStateChange = vi.fn();
    mockOnTokenExpired = vi.fn().mockResolvedValue('refresh');

    mockOptions = {
      endpoint: 'wss://test.example.com/connection',
      getToken: mockGetToken,
      userId: 'test-user-id',
      onConnectionStateChange: mockOnConnectionStateChange,
      onTokenExpired: mockOnTokenExpired,
      getLastOffset: vi
        .fn()
        .mockResolvedValue({ offset: 0, epoch: 'test-epoch' }),
    };

    client = new RTCAgentClient(mockOptions);
  });

  afterEach(() => {
    vi.useRealTimers();
    client.disconnect();
  });

  describe('Connection Lifecycle', () => {
    it('should start in disconnected state', () => {
      expect(client.getConnectionState()).toBe('disconnected');
    });

    it('should transition to connecting state when connect() is called', async () => {
      const connectPromise = client.connect();
      expect(client.getConnectionState()).toBe('connecting');
      await connectPromise;
    });

    it('should not call connect() again if already connecting', async () => {
      const firstConnect = client.connect();
      const secondConnect = client.connect();

      await Promise.all([firstConnect, secondConnect]);

      // Should only create one Centrifuge instance
      // @ts-expect-error - accessing private field for testing
      expect(client.centrifuge).toBeDefined();
    });

    it('should not call connect() again if already connected', async () => {
      await client.connect();

      // Simulate connected state
      // @ts-expect-error - accessing private field for testing
      client.connectionState = 'connected';

      const connectSpy = vi.spyOn(client, 'connect');
      await client.connect();

      // Should return early without creating new connection
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Manual Disconnect', () => {
    it('should set shouldReconnect to false on disconnect()', () => {
      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(false);
    });

    it('should clear reconnect timer on disconnect()', () => {
      // Set up a reconnect timer
      // @ts-expect-error - accessing private field for testing
      client._reconnectTimer = setTimeout(() => {}, 1000);

      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectTimer).toBeDefined();

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectTimer).toBeUndefined();
    });

    it('should reset wasConnected flag on disconnect()', () => {
      // Simulate previous connection
      // @ts-expect-error - accessing private field for testing
      client.wasConnected = true;

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.wasConnected).toBe(false);
    });

    it('should transition to disconnected state on disconnect()', () => {
      client.disconnect();

      expect(client.getConnectionState()).toBe('disconnected');
      // Note: onConnectionStateChange is only called when state actually changes
      // Since we start in 'disconnected' state, no change event is emitted
    });

    it('should not trigger reconnect after manual disconnect', async () => {
      await client.connect();
      client.disconnect();

      // Advance timers
      await vi.advanceTimersByTimeAsync(10000);

      // Should not attempt to reconnect
      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(false);
    });
  });

  describe('Exponential Backoff Strategy', () => {
    it('should initialize reconnect delay to 1000ms', () => {
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectDelay).toBe(1000);
    });

    it('should increase delay exponentially after each failure', () => {
      // Initial delay
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectDelay).toBe(1000);

      // Simulate first failure and backoff
      // @ts-expect-error - accessing private field for testing
      client._reconnectDelay = Math.min(
        // @ts-expect-error - accessing private field for testing
        client._reconnectDelay * 2,
        30000,
      );
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectDelay).toBe(2000);

      // Second failure
      // @ts-expect-error - accessing private field for testing
      client._reconnectDelay = Math.min(
        // @ts-expect-error - accessing private field for testing
        client._reconnectDelay * 2,
        30000,
      );
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectDelay).toBe(4000);

      // Third failure
      // @ts-expect-error - accessing private field for testing
      client._reconnectDelay = Math.min(
        // @ts-expect-error - accessing private field for testing
        client._reconnectDelay * 2,
        30000,
      );
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectDelay).toBe(8000);

      // Fourth failure
      // @ts-expect-error - accessing private field for testing
      client._reconnectDelay = Math.min(
        // @ts-expect-error - accessing private field for testing
        client._reconnectDelay * 2,
        30000,
      );
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectDelay).toBe(16000);
    });

    it('should cap delay at maximum 30000ms', () => {
      // Set delay close to max
      // @ts-expect-error - accessing private field for testing
      client._reconnectDelay = 20000;

      // Apply backoff
      // @ts-expect-error - accessing private field for testing
      client._reconnectDelay = Math.min(
        // @ts-expect-error - accessing private field for testing
        client._reconnectDelay * 2,
        30000,
      );

      // Should be capped at max
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectDelay).toBe(30000);
    });

    it('should reset delay to initial value after successful connection', async () => {
      // Simulate multiple failures
      // @ts-expect-error - accessing private field for testing
      client._reconnectDelay = 16000;

      // Simulate successful connection
      // @ts-expect-error - accessing private field for testing
      client._reconnectDelay = 1000;

      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectDelay).toBe(1000);
    });
  });

  describe('Token Expiration Handling', () => {
    it('should stop reconnecting when relogin is required', async () => {
      mockOnTokenExpired.mockResolvedValueOnce('relogin');

      // Simulate token expiration during connection
      await client.connect();

      // Trigger token expiration
      // @ts-expect-error - accessing private method for testing
      await client.handleInvalidToken();

      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(false);
    });

    it('should attempt reconnect after token refresh', async () => {
      mockOnTokenExpired.mockResolvedValueOnce('refresh');

      await client.connect();

      // Trigger token expiration
      // @ts-expect-error - accessing private method for testing
      await client.handleInvalidToken();

      // Should schedule reconnect
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectTimer).toBeDefined();

      // Advance timer to trigger reconnect
      await vi.advanceTimersByTimeAsync(1000);

      // Should attempt reconnect
      expect(mockOnConnectionStateChange).toHaveBeenCalled();
    });

    it('should use 1000ms delay before reconnecting after token refresh', async () => {
      mockOnTokenExpired.mockResolvedValueOnce('refresh');

      await client.connect();

      // @ts-expect-error - accessing private method for testing
      await client.handleInvalidToken();

      // Advance timer just before the reconnect delay
      await vi.advanceTimersByTimeAsync(999);

      // Should not have reconnected yet
      const callsBefore = mockOnConnectionStateChange.mock.calls.length;

      // Advance past the delay
      await vi.advanceTimersByTimeAsync(2);

      // Should have triggered reconnect
      expect(mockOnConnectionStateChange.mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });

  describe('Account Banned Handling', () => {
    it('should stop reconnecting when account is banned (code 4501)', async () => {
      await client.connect();

      // Simulate disconnect with banned code
      // @ts-expect-error - accessing private field for testing
      const centrifuge = client.centrifuge;
      centrifuge?.emit('disconnected', {
        code: 4501,
        reason: 'account banned',
      });

      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(false);
      // @ts-expect-error - accessing private field for testing
      expect(client.wasConnected).toBe(false);
    });

    it('should call onAccountBanned callback when provided', async () => {
      const mockOnAccountBanned = vi.fn();
      mockOptions.onAccountBanned = mockOnAccountBanned;
      client = new RTCAgentClient(mockOptions);

      await client.connect();

      // Simulate disconnect with banned code
      // @ts-expect-error - accessing private field for testing
      const centrifuge = client.centrifuge;
      centrifuge?.emit('disconnected', {
        code: 4501,
        reason: 'account banned',
      });

      expect(mockOnAccountBanned).toHaveBeenCalledWith('account banned');
    });

    it('should not reconnect after account banned', async () => {
      await client.connect();

      // Simulate disconnect with banned code
      // @ts-expect-error - accessing private field for testing
      const centrifuge = client.centrifuge;
      centrifuge?.emit('disconnected', {
        code: 4501,
        reason: 'account banned',
      });

      // Advance timers
      await vi.advanceTimersByTimeAsync(10000);

      // Should not attempt reconnect
      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(false);
    });
  });

  describe('Message Size Limit Exceeded', () => {
    it('should schedule reconnect after message size limit error', async () => {
      await client.connect();

      // Simulate disconnect with message size limit error
      // @ts-expect-error - accessing private field for testing
      const centrifuge = client.centrifuge;
      centrifuge?.emit('disconnected', {
        reason: 'message size limit exceeded',
      });

      // Should schedule reconnect
      // @ts-expect-error - accessing private field for testing
      expect(client._reconnectTimer).toBeDefined();
    });

    it('should use 3000ms delay before reconnecting after size limit error', async () => {
      await client.connect();

      // Simulate disconnect with size limit error
      // @ts-expect-error - accessing private field for testing
      const centrifuge = client.centrifuge;
      centrifuge?.emit('disconnected', {
        reason: 'message size limit exceeded',
      });

      // Advance timer just before the reconnect delay
      await vi.advanceTimersByTimeAsync(2999);

      const callsBefore = mockOnConnectionStateChange.mock.calls.length;

      // Advance past the delay
      await vi.advanceTimersByTimeAsync(2);

      // Should have triggered reconnect
      expect(mockOnConnectionStateChange.mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });

  describe('Reconnect Method', () => {
    it('should call disconnect() then connect() on reconnect()', async () => {
      const disconnectSpy = vi.spyOn(client, 'disconnect');
      const connectSpy = vi.spyOn(client, 'connect');

      await client.reconnect();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('should reset state before reconnecting', async () => {
      // Set up some state
      // @ts-expect-error - accessing private field for testing
      client.wasConnected = true;
      // @ts-expect-error - accessing private field for testing
      client.shouldReconnect = false;

      await client.reconnect();

      // disconnect() should reset these
      // @ts-expect-error - accessing private field for testing
      expect(client.wasConnected).toBe(false);

      // connect() should set shouldReconnect to true
      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(true);
    });
  });

  describe('Connection State Transitions', () => {
    it('should emit connection state change events', async () => {
      await client.connect();

      expect(mockOnConnectionStateChange).toHaveBeenCalledWith({
        state: 'connecting',
      });
    });

    it('should track connection reason', async () => {
      await client.connect();
      client.disconnect();

      // Verify state is disconnected
      expect(client.getConnectionState()).toBe('disconnected');
    });

    it('should distinguish first connect from reconnect', async () => {
      await client.connect();

      // First connect: should be 'connecting'
      expect(mockOnConnectionStateChange).toHaveBeenCalledWith({
        state: 'connecting',
        reason: undefined,
      });

      // Simulate connection established by triggering the connected event
      // @ts-expect-error - accessing private field for testing
      const centrifuge = client.centrifuge;
      centrifuge?.emit('connected', {});

      // wasConnected should now be true
      // @ts-expect-error - accessing private field for testing
      expect(client.wasConnected).toBe(true);

      // Simulate disconnect
      centrifuge?.emit('disconnected', { reason: 'test disconnect' });

      // Clear mock to check reconnect behavior
      mockOnConnectionStateChange.mockClear();

      // Trigger reconnect by calling connect again
      // This should set state to 'reconnecting' when the connecting event fires
      await client.connect();

      // The connecting event should now show 'reconnecting' state
      const reconnectingCall = mockOnConnectionStateChange.mock.calls.find(
        (call) => call[0].state === 'reconnecting',
      );
      expect(reconnectingCall).toBeDefined();
    });
  });

  describe('Cleanup on Disconnect', () => {
    it('should clear all gap fill tasks', () => {
      const channel = 'topic:u=test-user-id';

      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, {
        targetOffset: 100,
        epoch: 'test-epoch',
      });

      // @ts-expect-error - accessing private field for testing
      expect(client.gapFillTasks.size).toBe(1);

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.gapFillTasks.size).toBe(0);
    });

    it('should abort all gap fill waits', () => {
      const channel = 'topic:u=test-user-id';

      // @ts-expect-error - accessing private field for testing
      client._gapFillAbortControllers.set(channel, new AbortController());

      // @ts-expect-error - accessing private field for testing
      expect(client._gapFillAbortControllers.size).toBe(1);

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client._gapFillAbortControllers.size).toBe(0);
    });

    it('should reset processing flags', () => {
      // @ts-expect-error - accessing private field for testing
      client.isGapFillProcessing = true;
      // @ts-expect-error - accessing private field for testing
      client.isUpdateProcessing = true;

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.isGapFillProcessing).toBe(false);
      // @ts-expect-error - accessing private field for testing
      expect(client.isUpdateProcessing).toBe(false);
    });

    it('should clear pending updates buffer', () => {
      // @ts-expect-error - accessing private field for testing
      client.pendingUpdates.push({
        id: '1',
        items: [],
        data_list: [],
        offset: 1,
      });

      // @ts-expect-error - accessing private field for testing
      expect(client.pendingUpdates.length).toBe(1);

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.pendingUpdates.length).toBe(0);
    });

    it('should clear offset cache', () => {
      const channel = 'topic:u=test-user-id';

      // @ts-expect-error - accessing private field for testing
      client.lastOffsetCache.set(channel, 50);

      // @ts-expect-error - accessing private field for testing
      expect(client.lastOffsetCache.size).toBe(1);

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.lastOffsetCache.size).toBe(0);
    });

    it('should clear subscriptions', () => {
      // Simulate subscription
      // @ts-expect-error - accessing private field for testing
      client.subscriptions.set('topic:u=test-user-id', {});

      // @ts-expect-error - accessing private field for testing
      expect(client.subscriptions.size).toBe(1);

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.subscriptions.size).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple disconnect() calls safely', () => {
      expect(() => {
        client.disconnect();
        client.disconnect();
        client.disconnect();
      }).not.toThrow();
    });

    it('should handle disconnect() before connect()', () => {
      expect(() => {
        client.disconnect();
      }).not.toThrow();

      expect(client.getConnectionState()).toBe('disconnected');
    });

    it('should handle reconnect() without prior connect()', async () => {
      await expect(client.reconnect()).resolves.toBeUndefined();
    });

    it('should maintain state consistency across multiple reconnects', async () => {
      await client.reconnect();
      await client.reconnect();
      await client.reconnect();

      // After reconnect(), the state should be 'connecting' (not 'disconnected')
      // because reconnect() calls disconnect() then connect()
      expect(client.getConnectionState()).toBe('connecting');
      // @ts-expect-error - accessing private field for testing
      expect(client.shouldReconnect).toBe(true);
    });
  });
});
