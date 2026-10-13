/**
 * Test Utilities for RTC Agent Client
 *
 * This module provides mock implementations for testing WebSocket communication
 * without requiring a real Centrifuge server connection.
 *
 * Main exports:
 * - MockCentrifugeClient: Simulates the Centrifuge WebSocket client
 * - MockSubscription: Simulates channel subscriptions
 * - createCentrifugeMock: Factory function for creating configured mocks
 *
 * @example
 * ```typescript
 * import { createCentrifugeMock } from '@rtc-agent/client/test-utils';
 *
 * describe('MyComponent', () => {
 *   let mockCentrifuge: MockCentrifugeClient;
 *
 *   beforeEach(() => {
 *     mockCentrifuge = createCentrifugeMock();
 *     // Inject mock into your component/service
 *   });
 *
 *   it('should handle publications', () => {
 *     mockCentrifuge.simulatePublication('topic:u=user-123', {
 *       type: 'update',
 *       data: { id: '123' }
 *     });
 *     // Assert component behavior
 *   });
 * });
 * ```
 *
 * @module test-utils
 */

export {
  MockCentrifugeClient,
  MockSubscription,
  createCentrifugeMock,
  isMockCentrifugeClient,
  isMockSubscription,
} from './centrifuge-mock.js';

export type {
  MockConnectionState,
  MockSubscriptionState,
  MockClientEvent,
  MockSubscriptionEvent,
  MockConnectingContext,
  MockConnectedContext,
  MockDisconnectedContext,
  MockErrorContext,
  MockSubscribedContext,
  MockPublicationContext,
  MockCentrifugeOptions,
  MockSubscriptionOptions,
} from './centrifuge-mock.js';
