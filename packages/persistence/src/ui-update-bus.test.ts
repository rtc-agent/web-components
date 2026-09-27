import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIUpdateBus, getUIUpdateBus, closeUIUpdateBus } from './ui-update-bus';
import type { UIUpdateEvent, BulkUpdateEvent } from './ui-update-bus';

describe('UIUpdateBus', () => {
  let bus: UIUpdateBus;

  beforeEach(() => {
    // Reset singleton before each test
    closeUIUpdateBus();
    bus = getUIUpdateBus();
    // Ensure bus is not suspended
    while ((bus as any)._suspendDepth > 0) {
      bus.resume();
    }
    vi.useFakeTimers();
  });

  afterEach(() => {
    closeUIUpdateBus();
    vi.useRealTimers();
  });

  const createTestEvent = (entityId = 'test-1'): UIUpdateEvent => ({
    entity: 'session',
    action: 'created',
    entityId,
    field: 'content',
    oldValue: undefined,
    newValue: 'test',
  });

  describe('suspend/resume reference counting (Fix 35)', () => {
    it('should suspend on first suspend call', () => {
      bus.suspend();
      const listener = vi.fn();
      bus.subscribe(listener);

      bus.publish(createTestEvent());

      expect(listener).not.toHaveBeenCalled();
    });

    it('should resume when depth reaches 0', async () => {
      bus.suspend();
      bus.resume();

      const listener = vi.fn();
      bus.subscribe(listener);

      bus.publish(createTestEvent());

      await vi.advanceTimersByTimeAsync(0);

      expect(listener).toHaveBeenCalled();
    });

    it('should support nested suspend/resume calls', async () => {
      const listener = vi.fn();
      const bulkListener = vi.fn();
      bus.subscribe(listener);
      bus.onBulkUpdate(bulkListener);

      bus.suspend();
      bus.suspend();
      bus.publish(createTestEvent('1'));
      expect(listener).not.toHaveBeenCalled();

      bus.resume();
      bus.publish(createTestEvent('2'));
      await vi.advanceTimersByTimeAsync(0);
      expect(listener).not.toHaveBeenCalled(); // Still suspended (depth=1)

      bus.resume();
      await vi.advanceTimersByTimeAsync(0);
      // Regular listener should NOT be called for events during suspend
      expect(listener).not.toHaveBeenCalled();
      // Bulk listener should be notified
      expect(bulkListener).toHaveBeenCalledTimes(1);
      bus.publish(createTestEvent('3'));
      await vi.advanceTimersByTimeAsync(0);
      // Now regular listener should be called
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should ignore resume without matching suspend', async () => {
      const listener = vi.fn();
      bus.subscribe(listener);

      bus.resume();
      bus.resume();
      bus.publish(createTestEvent());

      await vi.advanceTimersByTimeAsync(0);

      expect(listener).toHaveBeenCalled();
    });

    it('should flush collected events on resume', () => {
      const bulkListener = vi.fn();
      bus.onBulkUpdate(bulkListener);

      bus.suspend();
      bus.publish(createTestEvent('1'));
      bus.publish(createTestEvent('2'));
      bus.publish(createTestEvent('3'));

      bus.resume();

      expect(bulkListener).toHaveBeenCalledWith({
        entities: new Set(['session']),
        eventCount: 3,
      });
    });

    it('should start safety timer on first suspend', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      bus.suspend();

      // Advance time by 30 seconds (MAX_SUSPEND_MS)
      vi.advanceTimersByTime(30_000);

      // Should have force resumed
      const listener = vi.fn();
      bus.subscribe(listener);
      bus.publish(createTestEvent());

      await vi.advanceTimersByTimeAsync(0);

      expect(listener).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should force resume after safety timeout', async () => {
      const listener = vi.fn();
      const bulkListener = vi.fn();
      bus.subscribe(listener);
      bus.onBulkUpdate(bulkListener);

      bus.suspend();
      bus.publish(createTestEvent('1'));
      expect(listener).not.toHaveBeenCalled();

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30_000);

      // Should have force resumed and flushed events as bulk update
      await vi.advanceTimersByTimeAsync(0);
      // Regular listener should NOT be called for events during suspend
      expect(listener).not.toHaveBeenCalled();
      // Bulk listener should be notified
      expect(bulkListener).toHaveBeenCalled();
    });

    it('should clear safety timer on normal resume', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.suspend();
      bus.resume();

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30_000);

      // Should not have force resumed (safety timer was cleared)
      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should handle multiple suspend/resume cycles', async () => {
      const listener = vi.fn();
      const bulkListener = vi.fn();
      bus.subscribe(listener);
      bus.onBulkUpdate(bulkListener);

      bus.suspend();
      bus.publish(createTestEvent('1'));
      bus.resume();
      await vi.advanceTimersByTimeAsync(0);
      // Regular listener should NOT be called for events during suspend
      expect(listener).not.toHaveBeenCalled();
      // Bulk listener should be notified
      expect(bulkListener).toHaveBeenCalledTimes(1);

      bus.suspend();
      bus.publish(createTestEvent('2'));
      bus.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(bulkListener).toHaveBeenCalledTimes(2);

      // Events published after resume should dispatch normally
      bus.publish(createTestEvent('3'));
      await vi.advanceTimersByTimeAsync(0);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should reset depth on clear()', async () => {
      bus.suspend();
      bus.suspend();
      bus.clear();

      const listener = vi.fn();
      bus.subscribe(listener);
      bus.publish(createTestEvent());

      await vi.advanceTimersByTimeAsync(0);

      expect(listener).toHaveBeenCalled();
    });

    it('should clear safety timer on clear()', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.suspend();
      bus.clear();

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30_000);

      // Should not have force resumed (safety timer was cleared)
      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should track suspend depth correctly', () => {
      expect((bus as any)._suspendDepth).toBe(0);

      bus.suspend();
      expect((bus as any)._suspendDepth).toBe(1);

      bus.suspend();
      expect((bus as any)._suspendDepth).toBe(2);

      bus.resume();
      expect((bus as any)._suspendDepth).toBe(1);

      bus.resume();
      expect((bus as any)._suspendDepth).toBe(0);
    });

    it('should handle nested suspend with events at different depths', async () => {
      const listener = vi.fn();
      const bulkListener = vi.fn();
      bus.subscribe(listener);
      bus.onBulkUpdate(bulkListener);

      bus.suspend();
      bus.publish(createTestEvent('1'));

      bus.suspend();
      bus.publish(createTestEvent('2'));

      bus.resume(); // depth 2 -> 1, still suspended
      expect(listener).not.toHaveBeenCalled();
      expect(bulkListener).not.toHaveBeenCalled();

      bus.resume(); // depth 1 -> 0, resume
      await vi.advanceTimersByTimeAsync(0);
      // Regular listener should NOT be called for events during suspend
      expect(listener).not.toHaveBeenCalled();
      // Bulk listener should be notified
      expect(bulkListener).toHaveBeenCalledTimes(1);
    });

    it('should prevent permanent suspend with safety timeout', async () => {
      const listener = vi.fn();
      const bulkListener = vi.fn();
      bus.subscribe(listener);
      bus.onBulkUpdate(bulkListener);

      // Suspend without resume
      bus.suspend();
      bus.publish(createTestEvent('1'));

      // Wait for safety timeout
      vi.advanceTimersByTime(30_000);

      // Should have force resumed
      await vi.advanceTimersByTimeAsync(0);
      // Bulk listener should be notified for events during suspend
      expect(bulkListener).toHaveBeenCalled();
      // Regular listener should NOT be called for events during suspend
      expect(listener).not.toHaveBeenCalled();

      // Should be able to publish normally now
      bus.publish(createTestEvent('2'));
      await vi.advanceTimersByTimeAsync(0);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle rapid suspend/resume cycles', async () => {
      const listener = vi.fn();
      const bulkListener = vi.fn();
      bus.subscribe(listener);
      bus.onBulkUpdate(bulkListener);

      for (let i = 0; i < 10; i++) {
        bus.suspend();
        bus.publish(createTestEvent(`rapid-${i}`));
        bus.resume();
      }

      await vi.advanceTimersByTimeAsync(0);

      // Each suspend/resume cycle should trigger a bulk update
      expect(bulkListener).toHaveBeenCalledTimes(10);
      // Regular listener should NOT be called for events during suspend
      expect(listener).not.toHaveBeenCalled();
    });

    it('should clear safety timer on nested resume to depth 0', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.suspend();
      bus.suspend();
      bus.resume();
      bus.resume();

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30_000);

      // Should not have force resumed
      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });

  describe('basic functionality', () => {
    it('should dispatch events to listeners', async () => {
      const listener = vi.fn();
      bus.subscribe(listener);

      const event = createTestEvent();
      bus.publish(event);

      // Wait for async Promise chain to complete
      await vi.advanceTimersByTimeAsync(0);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should support entity-specific subscriptions', async () => {
      const sessionListener = vi.fn();
      const messageListener = vi.fn();

      bus.subscribe('session', sessionListener);
      bus.subscribe('message', messageListener);

      bus.publish(createTestEvent());

      await vi.advanceTimersByTimeAsync(0);

      expect(sessionListener).toHaveBeenCalled();
      expect(messageListener).not.toHaveBeenCalled();
    });

    it('should support wildcard subscriptions', async () => {
      const listener = vi.fn();
      bus.subscribe(listener);

      bus.publish(createTestEvent());
      bus.publish({ ...createTestEvent(), entity: 'message' });

      await vi.advanceTimersByTimeAsync(0);

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should support unsubscribe', async () => {
      const listener = vi.fn();
      const unsubscribe = bus.subscribe(listener);

      bus.publish(createTestEvent());
      await vi.advanceTimersByTimeAsync(0);

      unsubscribe();
      bus.publish(createTestEvent());
      await vi.advanceTimersByTimeAsync(0);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should queue async listener calls', async () => {
      const order: number[] = [];
      const listener = vi.fn().mockImplementation(async (event: UIUpdateEvent) => {
        order.push(parseInt(event.entityId));
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      bus.subscribe(listener);

      bus.publish(createTestEvent('1'));
      bus.publish(createTestEvent('2'));
      bus.publish(createTestEvent('3'));

      await vi.advanceTimersByTimeAsync(50);

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('Promise chain timeout (Fix 36)', () => {
    it('should timeout listener that never resolves', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const listener = vi.fn().mockImplementation(() => {
        // Return a Promise that never resolves
        return new Promise(() => {});
      });

      bus.subscribe(listener);
      bus.publish(createTestEvent());

      // Advance time by 10 seconds (CHAIN_TIMEOUT_MS)
      await vi.advanceTimersByTimeAsync(10_000);

      // Should have logged timeout error
      expect(errorSpy).toHaveBeenCalled();
      // The error is caught by the .catch() handler: log.error('listener error:', err)
      // So the call is console.error('listener error:', errorObject)
      const errorArg = errorSpy.mock.calls[0][2];
      expect(errorArg).toBeInstanceOf(Error);
      expect(errorArg.message).toContain('Listener chain timeout');

      errorSpy.mockRestore();
    });

    it('should allow subsequent events after timeout', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const callOrder: string[] = [];

      const listener = vi.fn().mockImplementation(async (event: UIUpdateEvent) => {
        if (event.entityId === 'hang') {
          // First event hangs forever
          await new Promise(() => {});
        }
        callOrder.push(event.entityId);
      });

      bus.subscribe(listener);

      // Publish hanging event
      bus.publish(createTestEvent('hang'));

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(10_000);

      // Publish normal event
      bus.publish(createTestEvent('normal'));
      await vi.advanceTimersByTimeAsync(0);

      // Normal event should have been processed
      expect(callOrder).toContain('normal');

      errorSpy.mockRestore();
    });

    it('should not timeout normal async listeners', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const listener = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      bus.subscribe(listener);
      bus.publish(createTestEvent());

      // Advance time by 100ms (less than timeout)
      await vi.advanceTimersByTimeAsync(100);

      // Should not have logged timeout error
      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should timeout per listener chain independently', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const hangingListener = vi.fn().mockImplementation(() => {
        return new Promise(() => {});
      });

      const normalListener = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      bus.subscribe(hangingListener);
      bus.subscribe(normalListener);

      bus.publish(createTestEvent());

      // Advance time by 10 seconds
      await vi.advanceTimersByTimeAsync(10_000);

      // Hanging listener should timeout
      expect(errorSpy).toHaveBeenCalled();
      // Normal listener should complete without timeout
      expect(normalListener).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should timeout per entity independently', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const callOrder: string[] = [];

      const listener = vi.fn().mockImplementation(async (event: UIUpdateEvent) => {
        if (event.entity === 'session' && event.entityId === 'hang') {
          // Hang only for specific session
          await new Promise(() => {});
        }
        callOrder.push(`${event.entity}:${event.entityId}`);
      });

      bus.subscribe(listener);

      // Publish hanging event
      bus.publish({ ...createTestEvent('hang'), entity: 'session' });

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(10_000);

      // Publish normal event for different entity
      bus.publish({ ...createTestEvent('1'), entity: 'message' });
      await vi.advanceTimersByTimeAsync(0);

      // Normal event should have been processed
      expect(callOrder).toContain('message:1');

      errorSpy.mockRestore();
    });

    it('should clean up processing chain after timeout', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const listener = vi.fn().mockImplementation(() => {
        return new Promise(() => {});
      });

      bus.subscribe(listener);
      bus.publish(createTestEvent('1'));

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(10_000);

      // Processing chain should be cleaned up
      expect((bus as any)._processingChains.size).toBe(0);

      errorSpy.mockRestore();
    });
  });
});
