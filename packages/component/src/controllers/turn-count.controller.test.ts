/**
 * TurnCount Controller Tests
 *
 * Tests for the TurnCountController which manages pending_turn_count and running_turn_count.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TurnCountController } from './turn-count.controller.js';
import type { ReactiveControllerHost } from 'lit';
import type { IPersistenceLayer } from '@rtc-agent/persistence';

// Mock host
class MockHost implements ReactiveControllerHost {
  controllers: any[] = [];
  updateRequested = false;

  addController(controller: any) {
    this.controllers.push(controller);
  }

  removeController(controller: any) {
    const index = this.controllers.indexOf(controller);
    if (index >= 0) {
      this.controllers.splice(index, 1);
    }
  }

  requestUpdate() {
    this.updateRequested = true;
  }

  get updateComplete() {
    return Promise.resolve(true);
  }
}

// Mock persistence layer
const createMockPersistence = (
  session: any = null,
  shouldThrow = false,
): IPersistenceLayer => {
  return {
    getSession: vi.fn().mockImplementation(async () => {
      if (shouldThrow) {
        throw new Error('Mock error');
      }
      return session;
    }),
  } as unknown as IPersistenceLayer;
};

describe('TurnCountController', () => {
  let host: MockHost;
  let controller: TurnCountController;

  beforeEach(() => {
    host = new MockHost();
    controller = new TurnCountController(host);
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const value = controller.value;
      expect(value.state.pendingTurnCount).toBe(0);
      expect(value.state.runningTurnCount).toBe(0);
    });

    it('should provide refresh action', () => {
      expect(controller.value.actions.refresh).toBeDefined();
      expect(typeof controller.value.actions.refresh).toBe('function');
    });

    it('should register with host', () => {
      expect(host.controllers).toContain(controller);
    });
  });

  describe('dependency injection', () => {
    it('should accept persistence layer', () => {
      const mockPersistence = createMockPersistence();
      expect(() => controller.setPersistence(mockPersistence)).not.toThrow();
    });

    it('should accept session ID getter', () => {
      const getter = () => 'test-session-id';
      expect(() => controller.setSessionIdGetter(getter)).not.toThrow();
    });
  });

  describe('refresh()', () => {
    it('should set default values when no session ID is provided', async () => {
      const mockPersistence = createMockPersistence();
      controller.setPersistence(mockPersistence);
      controller.setSessionIdGetter(() => null);

      await controller.refresh();

      expect(controller.value.state.pendingTurnCount).toBe(0);
      expect(controller.value.state.runningTurnCount).toBe(0);
      expect(host.updateRequested).toBe(true);
    });

    it('should set default values when persistence is not set', async () => {
      controller.setSessionIdGetter(() => 'test-session-id');

      await controller.refresh();

      expect(controller.value.state.pendingTurnCount).toBe(0);
      expect(controller.value.state.runningTurnCount).toBe(0);
      expect(host.updateRequested).toBe(true);
    });

    it('should set default values when session is not found', async () => {
      const mockPersistence = createMockPersistence(null);
      controller.setPersistence(mockPersistence);
      controller.setSessionIdGetter(() => 'test-session-id');

      await controller.refresh();

      expect(controller.value.state.pendingTurnCount).toBe(0);
      expect(controller.value.state.runningTurnCount).toBe(0);
      expect(mockPersistence.getSession).toHaveBeenCalledWith('test-session-id');
    });

    it('should update state with session turn counts', async () => {
      const mockSession = {
        pending_turn_count: 3,
        running_turn_count: 1,
      };
      const mockPersistence = createMockPersistence(mockSession);
      controller.setPersistence(mockPersistence);
      controller.setSessionIdGetter(() => 'test-session-id');

      await controller.refresh();

      expect(controller.value.state.pendingTurnCount).toBe(3);
      expect(controller.value.state.runningTurnCount).toBe(1);
      expect(mockPersistence.getSession).toHaveBeenCalledWith('test-session-id');
    });

    it('should handle errors gracefully', async () => {
      const mockPersistence = createMockPersistence(null, true);
      controller.setPersistence(mockPersistence);
      controller.setSessionIdGetter(() => 'test-session-id');

      await controller.refresh();

      expect(controller.value.state.pendingTurnCount).toBe(0);
      expect(controller.value.state.runningTurnCount).toBe(0);
      expect(host.updateRequested).toBe(true);
    });
  });

  describe('value caching', () => {
    it('should return cached value when state has not changed', () => {
      const value1 = controller.value;
      const value2 = controller.value;

      expect(value1).toBe(value2); // Same reference
    });

    it('should create new value reference after state change', async () => {
      const mockSession = {
        pending_turn_count: 2,
        running_turn_count: 0,
      };
      const mockPersistence = createMockPersistence(mockSession);
      controller.setPersistence(mockPersistence);
      controller.setSessionIdGetter(() => 'test-session-id');

      const value1 = controller.value;
      await controller.refresh();
      const value2 = controller.value;

      expect(value1).not.toBe(value2); // Different reference
      expect(value2.state.pendingTurnCount).toBe(2);
    });
  });

  describe('actions.refresh()', () => {
    it('should call refresh method', async () => {
      const mockSession = {
        pending_turn_count: 1,
        running_turn_count: 1,
      };
      const mockPersistence = createMockPersistence(mockSession);
      controller.setPersistence(mockPersistence);
      controller.setSessionIdGetter(() => 'test-session-id');

      await controller.value.actions.refresh();

      expect(controller.value.state.pendingTurnCount).toBe(1);
      expect(controller.value.state.runningTurnCount).toBe(1);
    });
  });
});
