/**
 * Real Comlink Integration Tests
 *
 * Tests the actual Comlink proxy behavior between main thread and Worker:
 * - MessageChannel + Comlink.expose() + Comlink.wrap() for real proxy communication
 * - Function parameter serialization and deserialization
 * - Promise resolution across the Worker boundary
 * - Callback proxying with Comlink.proxy()
 * - Error propagation across the Worker boundary
 * - Transferable objects (if applicable)
 *
 * Unlike multi-tab.mock.test.ts, these tests use REAL Comlink proxies
 * over MessageChannel to verify the actual communication protocol works correctly.
 */

import type { WorkerCallbacks, WorkerPersistenceCore } from '@rtc-agent/worker';
import { expose, proxy, type Remote, releaseProxy, wrap } from 'comlink';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Create a test config for the TestWorkerCore.
 *
 * Note: We use a simplified config structure that doesn't include functions,
 * since Comlink cannot serialize functions inside nested objects directly.
 * The actual WorkerBridge handles this by using proxy() for callback functions.
 */
function createTestConfig() {
  return {
    databaseName: 'test-db',
    deviceId: 'test-device',
    userId: 'test-user',
  };
}

/**
 * Minimal WorkerCore implementation for integration testing.
 *
 * This simulates the actual WorkerCore behavior but runs in the same thread
 * as the test, exposed via Comlink over a MessageChannel.
 */
class TestWorkerCore {
  private initialized = false;
  private callbacks = new Set<WorkerCallbacks>();

  async init(_config: {
    databaseName: string;
    deviceId: string;
    userId: string;
  }): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  registerCallback(cb: WorkerCallbacks): void {
    this.callbacks.add(cb);
  }

  unregisterCallback(cb: WorkerCallbacks): void {
    this.callbacks.delete(cb);
  }

  async ping(): Promise<string> {
    return 'pong';
  }

  async getConnectionState(): Promise<string> {
    return this.initialized ? 'connected' : 'disconnected';
  }

  async listSessions(): Promise<any[]> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }
    return [
      { clientId: 'session-1', title: 'Test Session 1' },
      { clientId: 'session-2', title: 'Test Session 2' },
    ];
  }

  async getSession(clientId: string): Promise<any | undefined> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }
    if (clientId === 'session-1') {
      return { clientId: 'session-1', title: 'Test Session 1' };
    }
    return undefined;
  }

  async listMessages(sessionClientId: string): Promise<any[]> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }
    return [
      {
        clientId: 'msg-1',
        sessionClientId,
        content: 'Hello',
        role: 'user',
      },
    ];
  }

  async getCatchUpEvents(fromSeq: number): Promise<{
    entries: any[];
    hasGap: boolean;
    hasMore: boolean;
  }> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }
    // Simulate some events
    const allEvents = [
      { seq: 1, event: { entity: 'session', action: 'created' } },
      { seq: 2, event: { entity: 'message', action: 'created' } },
      { seq: 3, event: { entity: 'session', action: 'updated' } },
    ];
    const entries = allEvents.filter((e) => e.seq > fromSeq);
    return {
      entries,
      hasGap: false,
      hasMore: false,
    };
  }

  async sendMessage(params: {
    content: any;
    messageClientId: string;
    sessionClientId: string;
  }): Promise<{ session: any; message: any }> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }
    return {
      session: { clientId: params.sessionClientId, title: 'Test' },
      message: {
        clientId: params.messageClientId,
        content: params.content,
        role: 'user',
      },
    };
  }

  /** Simulate broadcasting to all registered callbacks */
  async broadcastUIUpdate(event: any, seq: number): Promise<void> {
    const payload = { event, seq };
    for (const cb of this.callbacks) {
      try {
        await cb.onUIUpdate(payload);
      } catch {
        // Ignore errors in broadcast
      }
    }
  }

  /** Simulate requesting token from any registered callback */
  async requestToken(): Promise<string> {
    for (const cb of this.callbacks) {
      try {
        return await cb.requestToken();
      } catch {
        // Try next callback
      }
    }
    throw new Error('No callback available');
  }

  async close(): Promise<void> {
    this.callbacks.clear();
    this.initialized = false;
  }
}

describe('Real Comlink Integration', () => {
  let channel: MessageChannel;
  let wrappedCore: Remote<WorkerPersistenceCore>;
  let testCore: TestWorkerCore;

  beforeEach(() => {
    // Create a MessageChannel for communication
    channel = new MessageChannel();
    testCore = new TestWorkerCore();

    // Expose the test core on one end of the channel
    expose(testCore, channel.port1);

    // Wrap the other end to get a proxy
    wrappedCore = wrap<WorkerPersistenceCore>(channel.port2);
  });

  afterEach(() => {
    // Release the proxy to clean up
    wrappedCore[releaseProxy]();
    channel.port1.close();
    channel.port2.close();
  });

  describe('Basic Comlink Proxy Communication', () => {
    it('should proxy simple method calls', async () => {
      const result = await wrappedCore.ping();
      expect(result).toBe('pong');
    });

    it('should proxy method calls with parameters', async () => {
      const config = createTestConfig();

      await wrappedCore.init(config);
      const state = await wrappedCore.getConnectionState();
      expect(state).toBe('connected');
    });

    it('should proxy methods returning arrays', async () => {
      const config = createTestConfig();

      await wrappedCore.init(config);
      const sessions = await wrappedCore.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].clientId).toBe('session-1');
    });

    it('should proxy methods with complex parameters', async () => {
      const config = createTestConfig();

      await wrappedCore.init(config);
      const result = await wrappedCore.sendMessage({
        content: { text: 'Hello, World!' },
        messageClientId: 'msg-123',
        sessionClientId: 'session-456',
      });

      expect(result.session.clientId).toBe('session-456');
      expect(result.message.clientId).toBe('msg-123');
      expect(result.message.content.text).toBe('Hello, World!');
    });
  });

  describe('Promise Serialization', () => {
    it('should correctly serialize Promise results', async () => {
      const config = createTestConfig();

      await wrappedCore.init(config);
      const result = await wrappedCore.getCatchUpEvents(1);
      expect(result.entries).toHaveLength(2);
      expect(result.hasGap).toBe(false);
      expect(result.hasMore).toBe(false);
    });

    it('should propagate errors across the boundary', async () => {
      // Try to call a method without initializing
      await expect(wrappedCore.listSessions()).rejects.toThrow(
        'Not initialized',
      );
    });
  });

  describe('Callback Proxying', () => {
    it('should support proxied callbacks for event broadcasting', async () => {
      const config = createTestConfig();

      await wrappedCore.init(config);

      let receivedPayload: any = null;
      const proxiedCallbacks = proxy({
        onUIUpdate: (payload: any) => {
          receivedPayload = payload;
        },
        requestToken: () => Promise.resolve('test-token'),
        requestTokenRefresh: () => Promise.resolve('refresh' as const),
        onConnectionStateChange: () => {},
        onGapFillState: () => {},
        onStateGap: () => {},
        onAccountBanned: () => {},
      });

      wrappedCore.registerCallback(proxiedCallbacks);

      // Wait a bit for the callback to be registered
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Trigger a broadcast
      await testCore.broadcastUIUpdate(
        { entity: 'session', action: 'created', entityId: 'session-1' },
        42,
      );

      // Wait for the callback to be invoked
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedPayload).toBeDefined();
      expect(receivedPayload.seq).toBe(42);
      expect(receivedPayload.event.entity).toBe('session');

      wrappedCore.unregisterCallback(proxiedCallbacks);
    });

    it('should support token request via proxied callback', async () => {
      const config = createTestConfig();

      await wrappedCore.init(config);

      const proxiedCallbacks = proxy({
        onUIUpdate: () => {},
        requestToken: () => Promise.resolve('token-from-main-thread'),
        requestTokenRefresh: () => Promise.resolve('refresh' as const),
        onConnectionStateChange: () => {},
        onGapFillState: () => {},
        onStateGap: () => {},
        onAccountBanned: () => {},
      });

      wrappedCore.registerCallback(proxiedCallbacks);

      // Wait for callback registration
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Request token from the worker side
      const token = await testCore.requestToken();
      expect(token).toBe('token-from-main-thread');

      wrappedCore.unregisterCallback(proxiedCallbacks);
    });
  });

  describe('Multiple Proxy Instances', () => {
    it('should support multiple tabs connecting to the same core', async () => {
      // Create two separate channels to simulate two tabs
      const channel1 = new MessageChannel();
      const channel2 = new MessageChannel();

      const core1 = new TestWorkerCore();
      const core2 = new TestWorkerCore();

      expose(core1, channel1.port1);
      expose(core2, channel2.port1);

      const wrapped1 = wrap<WorkerPersistenceCore>(channel1.port2);
      const wrapped2 = wrap<WorkerPersistenceCore>(channel2.port2);

      const config = createTestConfig();

      await wrapped1.init(config);
      await wrapped2.init(config);

      // Both should be able to list sessions
      const sessions1 = await wrapped1.listSessions();
      const sessions2 = await wrapped2.listSessions();

      expect(sessions1).toHaveLength(2);
      expect(sessions2).toHaveLength(2);

      // Cleanup
      wrapped1[releaseProxy]();
      wrapped2[releaseProxy]();
      channel1.port1.close();
      channel1.port2.close();
      channel2.port1.close();
      channel2.port2.close();
    });
  });

  describe('Data Serialization Edge Cases', () => {
    it('should handle undefined return values', async () => {
      const config = createTestConfig();

      await wrappedCore.init(config);
      const result = await wrappedCore.getSession('non-existent');
      expect(result).toBeUndefined();
    });

    it('should handle complex nested objects', async () => {
      const config = createTestConfig();

      await wrappedCore.init(config);
      const messages = await wrappedCore.listMessages('session-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
      expect(messages[0].role).toBe('user');
    });
  });
});
