/**
 * Mock Centrifuge Client for Testing WebSocket Communication
 *
 * Provides a complete simulation of the Centrifuge WebSocket client, including:
 * - Connection state transitions (disconnected → connecting → connected)
 * - Subscription lifecycle (unsubscribed → subscribing → subscribed)
 * - Publication delivery to channels
 * - Error simulation (transport errors, token errors, etc.)
 * - Event listener management (on/off/emit)
 *
 * Usage:
 * ```typescript
 * import { createCentrifugeMock } from './test-utils/centrifuge-mock.js';
 *
 * // Create a mock with auto-connect (default)
 * const mock = createCentrifugeMock();
 *
 * // Simulate a publication to a channel
 * mock.simulatePublication('topic:u=user-123', { type: 'update', data: {} });
 *
 * // Simulate connection state changes
 * mock.simulateConnectionState('disconnected');
 * mock.simulateConnectionState('connecting');
 * mock.simulateConnectionState('connected');
 *
 * // Simulate errors
 * mock.simulateError({ type: 'transport', error: new Error('Connection lost') });
 * ```
 *
 * @module centrifuge-mock
 */

/**
 * Connection states supported by the mock.
 */
export type MockConnectionState = 'disconnected' | 'connecting' | 'connected';

/**
 * Subscription states supported by the mock.
 */
export type MockSubscriptionState =
  | 'unsubscribed'
  | 'subscribing'
  | 'subscribed';

/**
 * Event types emitted by the mock client.
 */
export type MockClientEvent =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'message'
  | 'state';

/**
 * Event types emitted by the mock subscription.
 */
export type MockSubscriptionEvent =
  | 'subscribing'
  | 'subscribed'
  | 'unsubscribed'
  | 'publication'
  | 'error'
  | 'state'
  | 'join'
  | 'leave';

/**
 * Context for the 'connecting' event.
 */
export interface MockConnectingContext {
  code: number;
  reason: string;
}

/**
 * Context for the 'connected' event.
 */
export interface MockConnectedContext {
  client: string;
  transport: string;
  data?: unknown;
}

/**
 * Context for the 'disconnected' event.
 */
export interface MockDisconnectedContext {
  code: number;
  reason: string;
}

/**
 * Context for the 'error' event.
 */
export interface MockErrorContext {
  type: string;
  error: Error;
  transport?: string;
}

/**
 * Context for the subscription 'subscribed' event.
 */
export interface MockSubscribedContext {
  channel: string;
  recoverable: boolean;
  positioned: boolean;
  streamPosition?: { offset: number; epoch: string };
  wasRecovering: boolean;
  recovered: boolean;
  hasRecoveredPublications: boolean;
  data?: unknown;
}

/**
 * Context for the subscription 'publication' event.
 */
export interface MockPublicationContext {
  channel: string;
  data: unknown;
  offset?: number;
  info?: { client: string; user: string };
  tags?: Record<string, string>;
}

/**
 * Options for configuring the mock client.
 */
export interface MockCentrifugeOptions {
  /** Whether to automatically transition to 'connected' state on connect(). Default: true. */
  autoConnect?: boolean;
  /** Delay in milliseconds before transitioning to 'connected' state. Default: 0. */
  connectionDelay?: number;
  /** Client ID returned in the 'connected' event. Default: 'mock-client-id'. */
  clientId?: string;
  /** Transport name returned in the 'connected' event. Default: 'websocket'. */
  transport?: string;
}

/**
 * Options for configuring mock subscriptions.
 */
export interface MockSubscriptionOptions {
  /** Whether to automatically transition to 'subscribed' state on subscribe(). Default: true. */
  autoSubscribe?: boolean;
  /** Delay in milliseconds before transitioning to 'subscribed' state. Default: 0. */
  subscribeDelay?: number;
  /** Stream position returned in the 'subscribed' event. */
  streamPosition?: { offset: number; epoch: string };
}

/**
 * Mock Subscription class that simulates Centrifuge Subscription behavior.
 *
 * Provides methods to:
 * - Simulate subscription state transitions
 * - Emit publications to the channel
 * - Emit errors
 * - Track subscription state
 */
export class MockSubscription {
  readonly channel: string;
  state: MockSubscriptionState = 'unsubscribed';
  readonly type: string = 'regular';

  private _listeners = new Map<MockSubscriptionEvent, Set<Function>>();
  private _options: MockSubscriptionOptions;
  private _subscribedContext: MockSubscribedContext | null = null;

  constructor(channel: string, options: MockSubscriptionOptions = {}) {
    this.channel = channel;
    this._options = {
      autoSubscribe: true,
      subscribeDelay: 0,
      streamPosition: { offset: 0, epoch: 'test-epoch' },
      ...options,
    };
  }

  /**
   * Subscribe to the channel.
   * If autoSubscribe is enabled, transitions to 'subscribed' state after the configured delay.
   */
  subscribe(): void {
    if (this.state === 'subscribed' || this.state === 'subscribing') {
      return;
    }

    this.state = 'subscribing';
    this._emit('subscribing', {
      channel: this.channel,
      code: 0,
      reason: 'subscribe called',
    });
    this._emit('state', {
      channel: this.channel,
      newState: 'subscribing',
      oldState: 'unsubscribed',
    });

    if (this._options.autoSubscribe) {
      setTimeout(() => {
        this._transitionToSubscribed();
      }, this._options.subscribeDelay);
    }
  }

  /**
   * Unsubscribe from the channel.
   */
  unsubscribe(): void {
    if (this.state === 'unsubscribed') {
      return;
    }

    const oldState = this.state;
    this.state = 'unsubscribed';
    this._emit('unsubscribed', {
      channel: this.channel,
      code: 0,
      reason: 'unsubscribe called',
    });
    this._emit('state', {
      channel: this.channel,
      newState: 'unsubscribed',
      oldState,
    });
  }

  /**
   * Returns a promise that resolves when the subscription is in 'subscribed' state.
   */
  async ready(timeout?: number): Promise<void> {
    if (this.state === 'subscribed') {
      return;
    }

    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            reject(new Error('MockSubscription.ready() timed out'));
          }, timeout)
        : null;

      const checkState = () => {
        if (this.state === 'subscribed') {
          if (timer) clearTimeout(timer);
          resolve();
          return true;
        }
        return false;
      };

      if (checkState()) return;

      this.on('subscribed', () => {
        if (checkState()) {
          this.off('subscribed', checkState);
        }
      });
    });
  }

  /**
   * Simulate receiving a publication on this subscription.
   */
  simulatePublication(data: unknown, offset?: number): void {
    if (this.state !== 'subscribed') {
      throw new Error(
        `Cannot simulate publication: subscription is in '${this.state}' state, expected 'subscribed'`,
      );
    }

    this._emit('publication', {
      channel: this.channel,
      data,
      offset,
    } as MockPublicationContext);
  }

  /**
   * Simulate an error on this subscription.
   */
  simulateError(type: string, error: Error): void {
    this._emit('error', {
      channel: this.channel,
      type,
      error,
    });
  }

  /**
   * Simulate a state transition.
   */
  simulateState(newState: MockSubscriptionState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    this._emit('state', {
      channel: this.channel,
      newState,
      oldState,
    });

    if (newState === 'subscribed') {
      this._emit('subscribed', this._getSubscribedContext());
    } else if (newState === 'unsubscribed') {
      this._emit('unsubscribed', {
        channel: this.channel,
        code: 0,
        reason: 'state transition',
      });
    } else if (newState === 'subscribing') {
      this._emit('subscribing', {
        channel: this.channel,
        code: 0,
        reason: 'state transition',
      });
    }
  }

  /**
   * Mock history() method for fetching publications.
   * Returns an empty result by default. Override in tests if needed.
   */
  async history(_opts?: {
    since?: { offset: number; epoch: string };
    limit?: number;
    reverse?: boolean;
  }): Promise<{
    publications: Array<{ data: unknown; offset?: number }>;
    offset: number;
    epoch: string;
  }> {
    return {
      publications: [],
      offset: this._options.streamPosition?.offset ?? 0,
      epoch: this._options.streamPosition?.epoch ?? 'test-epoch',
    };
  }

  /**
   * Mock presence() method.
   */
  async presence(): Promise<{ clients: Record<string, unknown> }> {
    return { clients: {} };
  }

  /**
   * Mock presenceStats() method.
   */
  async presenceStats(): Promise<{ numClients: number; numUsers: number }> {
    return { numClients: 0, numUsers: 0 };
  }

  /**
   * Mock publish() method.
   */
  async publish(_data: unknown): Promise<void> {
    // No-op in mock
  }

  /**
   * Mock setData() method.
   */
  setData(_data: unknown): void {
    // No-op in mock
  }

  /**
   * Mock setTagsFilter() method.
   */
  setTagsFilter(_filter: unknown): void {
    // No-op in mock
  }

  /**
   * Mock deltaStats() method.
   */
  deltaStats(): {
    numPublications: number;
    numFullPayloads: number;
    numDeltaPayloads: number;
    bytesReceived: number;
    bytesDecoded: number;
    compressionRatio: number;
  } {
    return {
      numPublications: 0,
      numFullPayloads: 0,
      numDeltaPayloads: 0,
      bytesReceived: 0,
      bytesDecoded: 0,
      compressionRatio: 0,
    };
  }

  // Event listener methods

  on(event: MockSubscriptionEvent, handler: Function): this {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }

  off(event: MockSubscriptionEvent, handler: Function): this {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(handler);
    }
    return this;
  }

  once(event: MockSubscriptionEvent, handler: Function): this {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper);
      handler(...args);
    };
    this.on(event, wrapper);
    return this;
  }

  // Internal methods

  private _emit(event: MockSubscriptionEvent, context: unknown): void {
    const set = this._listeners.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(context);
        } catch (err) {
          console.error(
            `MockSubscription: error in '${event}' handler for channel '${this.channel}':`,
            err,
          );
        }
      }
    }
  }

  private _transitionToSubscribed(): void {
    if (this.state !== 'subscribing') {
      return;
    }

    const oldState = this.state;
    this.state = 'subscribed';
    this._subscribedContext = this._getSubscribedContext();

    this._emit('subscribed', this._subscribedContext);
    this._emit('state', {
      channel: this.channel,
      newState: 'subscribed',
      oldState,
    });
  }

  private _getSubscribedContext(): MockSubscribedContext {
    return {
      channel: this.channel,
      recoverable: true,
      positioned: true,
      streamPosition: this._options.streamPosition,
      wasRecovering: false,
      recovered: false,
      hasRecoveredPublications: false,
    };
  }
}

/**
 * Mock Centrifuge Client class that simulates the real Centrifuge WebSocket client.
 *
 * Provides methods to:
 * - Simulate connection state transitions
 * - Create and manage subscriptions
 * - Emit publications to channels
 * - Emit errors
 * - Track connection state
 */
export class MockCentrifugeClient {
  state: MockConnectionState = 'disconnected';

  private _subscriptions = new Map<string, MockSubscription>();
  private _listeners = new Map<MockClientEvent, Set<Function>>();
  private _options: MockCentrifugeOptions;
  private _connectedContext: MockConnectedContext | null = null;
  private _rpcHandlers = new Map<
    string,
    (method: string, data: unknown) => Promise<unknown> | unknown
  >();

  constructor(options: MockCentrifugeOptions = {}) {
    this._options = {
      autoConnect: true,
      connectionDelay: 0,
      clientId: 'mock-client-id',
      transport: 'websocket',
      ...options,
    };
  }

  /**
   * Start connecting to the server.
   * If autoConnect is enabled, transitions to 'connected' state after the configured delay.
   */
  connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.state = 'connecting';
    this._emit('connecting', {
      code: 0,
      reason: 'connect called',
    } as MockConnectingContext);
    this._emit('state', {
      newState: 'connecting',
      oldState: 'disconnected',
    });

    if (this._options.autoConnect) {
      setTimeout(() => {
        this._transitionToConnected();
      }, this._options.connectionDelay);
    }
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    if (this.state === 'disconnected') {
      return;
    }

    const oldState = this.state;
    this.state = 'disconnected';
    this._connectedContext = null;

    this._emit('disconnected', {
      code: 0,
      reason: 'disconnect called',
    } as MockDisconnectedContext);
    this._emit('state', {
      newState: 'disconnected',
      oldState,
    });
  }

  /**
   * Create a new subscription to a channel.
   */
  newSubscription(
    channel: string,
    options?: MockSubscriptionOptions,
  ): MockSubscription {
    if (this._subscriptions.has(channel)) {
      throw new Error(
        `MockCentrifugeClient: subscription for channel '${channel}' already exists`,
      );
    }

    const sub = new MockSubscription(channel, options);
    this._subscriptions.set(channel, sub);
    return sub;
  }

  /**
   * Get an existing subscription by channel name.
   */
  getSubscription(channel: string): MockSubscription | null {
    return this._subscriptions.get(channel) ?? null;
  }

  /**
   * Remove a subscription.
   */
  removeSubscription(sub: MockSubscription | null): void {
    if (sub) {
      this._subscriptions.delete(sub.channel);
    }
  }

  /**
   * Get all subscriptions.
   */
  subscriptions(): Record<string, MockSubscription> {
    return Object.fromEntries(this._subscriptions);
  }

  /**
   * Simulate a connection state transition.
   */
  simulateConnectionState(newState: MockConnectionState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;

    if (newState === 'connected') {
      this._connectedContext = {
        client: this._options.clientId!,
        transport: this._options.transport!,
      };
      this._emit('connected', this._connectedContext);
    } else if (newState === 'connecting') {
      this._emit('connecting', {
        code: 0,
        reason: 'simulateConnectionState',
      });
    } else if (newState === 'disconnected') {
      this._connectedContext = null;
      this._emit('disconnected', {
        code: 0,
        reason: 'simulateConnectionState',
      });
    }

    this._emit('state', { newState, oldState });
  }

  /**
   * Simulate a publication to a channel.
   */
  simulatePublication(channel: string, data: unknown, offset?: number): void {
    const sub = this._subscriptions.get(channel);
    if (!sub) {
      throw new Error(
        `MockCentrifugeClient: no subscription found for channel '${channel}'`,
      );
    }

    sub.simulatePublication(data, offset);
  }

  /**
   * Simulate an error.
   */
  simulateError(type: string, error: Error): void {
    this._emit('error', {
      type,
      error,
    } as MockErrorContext);
  }

  /**
   * Simulate an RPC call.
   * Register handlers using registerRpcHandler().
   */
  async rpc(method: string, data: unknown): Promise<{ data: unknown }> {
    const handler = this._rpcHandlers.get(method);
    if (!handler) {
      throw new Error(
        `MockCentrifugeClient: no RPC handler registered for method '${method}'`,
      );
    }

    const result = await handler(method, data);
    return { data: result };
  }

  /**
   * Register an RPC handler for a specific method.
   */
  registerRpcHandler(
    method: string,
    handler: (method: string, data: unknown) => Promise<unknown> | unknown,
  ): void {
    this._rpcHandlers.set(method, handler);
  }

  /**
   * Clear an RPC handler.
   */
  clearRpcHandler(method: string): void {
    this._rpcHandlers.delete(method);
  }

  /**
   * Mock history() method for fetching publications from a channel.
   * Returns an empty result by default.
   */
  async history(
    _channel: string,
    _opts?: {
      since?: { offset: number; epoch: string };
      limit?: number;
      reverse?: boolean;
    },
  ): Promise<{
    publications: Array<{ data: unknown; offset?: number }>;
    offset: number;
    epoch: string;
  }> {
    return {
      publications: [],
      offset: 0,
      epoch: 'test-epoch',
    };
  }

  /**
   * Mock presence() method.
   */
  async presence(
    _channel: string,
  ): Promise<{ clients: Record<string, unknown> }> {
    return { clients: {} };
  }

  /**
   * Mock presenceStats() method.
   */
  async presenceStats(
    _channel: string,
  ): Promise<{ numClients: number; numUsers: number }> {
    return { numClients: 0, numUsers: 0 };
  }

  /**
   * Mock publish() method.
   */
  async publish(_channel: string, _data: unknown): Promise<void> {
    // No-op in mock
  }

  /**
   * Mock send() method.
   */
  async send(_data: unknown): Promise<void> {
    // No-op in mock
  }

  /**
   * Mock ready() method.
   */
  async ready(timeout?: number): Promise<void> {
    if (this.state === 'connected') {
      return;
    }

    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            reject(new Error('MockCentrifugeClient.ready() timed out'));
          }, timeout)
        : null;

      const checkState = () => {
        if (this.state === 'connected') {
          if (timer) clearTimeout(timer);
          resolve();
          return true;
        }
        return false;
      };

      if (checkState()) return;

      this.on('connected', () => {
        if (checkState()) {
          this.off('connected', checkState);
        }
      });
    });
  }

  /**
   * Mock setToken() method.
   */
  setToken(_token: string): void {
    // No-op in mock
  }

  /**
   * Mock setData() method.
   */
  setData(_data: unknown): void {
    // No-op in mock
  }

  /**
   * Mock setHeaders() method.
   */
  setHeaders(_headers: Record<string, string>): void {
    // No-op in mock
  }

  /**
   * Mock startBatching() method.
   */
  startBatching(): void {
    // No-op in mock
  }

  /**
   * Mock stopBatching() method.
   */
  stopBatching(): void {
    // No-op in mock
  }

  // Event listener methods

  on(event: MockClientEvent, handler: Function): this {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }

  off(event: MockClientEvent, handler: Function): this {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(handler);
    }
    return this;
  }

  once(event: MockClientEvent, handler: Function): this {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper);
      handler(...args);
    };
    this.on(event, wrapper);
    return this;
  }

  // Internal methods

  private _emit(event: MockClientEvent, context: unknown): void {
    const set = this._listeners.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(context);
        } catch (err) {
          console.error(
            `MockCentrifugeClient: error in '${event}' handler:`,
            err,
          );
        }
      }
    }
  }

  private _transitionToConnected(): void {
    if (this.state !== 'connecting') {
      return;
    }

    const oldState = this.state;
    this.state = 'connected';
    this._connectedContext = {
      client: this._options.clientId!,
      transport: this._options.transport!,
    };

    this._emit('connected', this._connectedContext);
    this._emit('state', { newState: 'connected', oldState });
  }
}

/**
 * Factory function for creating configured mock Centrifuge clients.
 *
 * @example
 * ```typescript
 * // Create a mock with auto-connect
 * const mock = createCentrifugeMock();
 * mock.connect(); // Immediately transitions to 'connected'
 *
 * // Create a mock with delayed connection
 * const mock = createCentrifugeMock({
 *   autoConnect: true,
 *   connectionDelay: 100,
 * });
 * mock.connect(); // Transitions to 'connected' after 100ms
 *
 * // Create a mock that requires manual state transitions
 * const mock = createCentrifugeMock({ autoConnect: false });
 * mock.connect(); // Stays in 'connecting' state
 * mock.simulateConnectionState('connected'); // Manually transition
 * ```
 */
export function createCentrifugeMock(
  options?: MockCentrifugeOptions,
): MockCentrifugeClient {
  return new MockCentrifugeClient(options);
}

/**
 * Type guard to check if an object is a MockCentrifugeClient.
 */
export function isMockCentrifugeClient(
  client: unknown,
): client is MockCentrifugeClient {
  return client instanceof MockCentrifugeClient;
}

/**
 * Type guard to check if an object is a MockSubscription.
 */
export function isMockSubscription(sub: unknown): sub is MockSubscription {
  return sub instanceof MockSubscription;
}
