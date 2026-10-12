import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIUpdateBus, getUIUpdateBus, closeUIUpdateBus } from './ui-update-bus';
import type { UIUpdateEvent } from './ui-update-bus';
import { getDatabase, closeDatabase, flushAll, DB_NAME_PREFIX } from './database';

const TEST_DB = `${DB_NAME_PREFIX}test-ui-update-bus-async`;

describe('UIUpdateBus - publish() async behavior', () => {
  let bus: UIUpdateBus;

  beforeEach(async () => {
    // Reset singleton state
    closeUIUpdateBus();
    await closeDatabase();

    // Get fresh database
    getDatabase(TEST_DB);
    await flushAll();

    // Get fresh bus instance
    bus = getUIUpdateBus();

    // Ensure bus is not suspended
    while ((bus as any)._suspendDepth > 0) {
      bus.resume();
    }

    // Initialize the bus
    await bus.init();

    // Enable persistence for these tests
    UIUpdateBus.persistEnabled = true;
  });

  afterEach(async () => {
    closeUIUpdateBus();
    await closeDatabase();
    UIUpdateBus.persistEnabled = true;
  });

  const createTestEvent = (entityId = 'test-1'): UIUpdateEvent => ({
    entity: 'session',
    action: 'created',
    entityId,
    field: 'content',
    oldValue: undefined,
    newValue: 'test',
  });

  describe('publish() async behavior verification', () => {
    it('should return a Promise', () => {
      const result = bus.publish(createTestEvent());
      expect(result).toBeInstanceOf(Promise);
    });

    it('should dispatch event to listener after await publish()', async () => {
      const listener = vi.fn();
      bus.subscribe(listener);

      const event = createTestEvent();
      await bus.publish(event);

      // Wait for async listener dispatch
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(listener).toHaveBeenCalledWith(event, expect.any(Number));
    });

    it('should persist event to IndexedDB after await publish()', async () => {
      const db = getDatabase(TEST_DB);
      const event = createTestEvent('persist-test');

      await bus.publish(event);

      // Verify event exists in IndexedDB
      const records = await db.ui_updates.toArray();
      expect(records.length).toBeGreaterThan(0);

      const lastRecord = records[records.length - 1];
      expect(lastRecord.event).toMatchObject({
        entity: 'session',
        action: 'created',
        entityId: 'persist-test',
      });
    });

    it('should use real DB auto-increment seq for publish()', async () => {
      const db = getDatabase(TEST_DB);

      // Publish first event
      const event1 = createTestEvent('seq-1');
      await bus.publish(event1);

      // Publish second event
      const event2 = createTestEvent('seq-2');
      await bus.publish(event2);

      // Verify seq values are real auto-increment values
      const records = await db.ui_updates.toArray();
      expect(records.length).toBe(2);

      // Seq should be sequential
      expect(records[0].seq).toBeLessThan(records[1].seq);

      // Verify listener receives the correct seq
      const receivedSeqs: number[] = [];
      bus.subscribe((event, seq) => {
        receivedSeqs.push(seq);
      });

      await bus.publish(createTestEvent('seq-3'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The seq passed to listener should match the DB record
      const lastRecord = await db.ui_updates.orderBy('seq').last();
      expect(receivedSeqs[0]).toBe(lastRecord.seq);
    });

    it('should handle IndexedDB write failure gracefully', async () => {
      // Disable persistence to simulate failure scenario
      UIUpdateBus.persistEnabled = false;

      const listener = vi.fn();
      bus.subscribe(listener);

      const event = createTestEvent('error-test');

      // Should not throw even if persistence fails
      await expect(bus.publish(event)).resolves.toBeUndefined();

      // Wait for dispatch
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Listener should still be called
      expect(listener).toHaveBeenCalledWith(event, 0);
    });

    it('should await IndexedDB write before dispatching to listeners', async () => {
      const db = getDatabase(TEST_DB);
      const listener = vi.fn();

      bus.subscribe(async (event, seq) => {
        // When listener is called, event should already be in DB
        const records = await db.ui_updates.toArray();
        const found = records.some((r) => r.event.entityId === event.entityId);
        expect(found).toBe(true);
        listener();
      });

      await bus.publish(createTestEvent('await-test'));

      // Wait for async listener
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listener).toHaveBeenCalled();
    });

    it('should handle multiple concurrent publish() calls correctly', async () => {
      const listener = vi.fn();
      bus.subscribe(listener);

      // Publish multiple events concurrently
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(bus.publish(createTestEvent(`concurrent-${i}`)));
      }

      // Wait for all publishes to complete
      await Promise.all(promises);

      // Wait for all listeners to be called
      await new Promise((resolve) => setTimeout(resolve, 50));

      // All events should be dispatched
      expect(listener).toHaveBeenCalledTimes(10);

      // Verify all events are in DB
      const db = getDatabase(TEST_DB);
      const records = await db.ui_updates.toArray();
      expect(records.length).toBe(10);
    });

    it('should preserve event order in listener despite async persistence', async () => {
      const receivedOrder: string[] = [];

      bus.subscribe((event) => {
        receivedOrder.push(event.entityId);
      });

      // Publish events sequentially
      await bus.publish(createTestEvent('order-1'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      await bus.publish(createTestEvent('order-2'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      await bus.publish(createTestEvent('order-3'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Events should be received in order
      expect(receivedOrder).toEqual(['order-1', 'order-2', 'order-3']);
    });

    it('should support fire-and-forget pattern (no await)', async () => {
      const listener = vi.fn();
      bus.subscribe(listener);

      // Publish without await (fire-and-forget)
      bus.publish(createTestEvent('fire-and-forget'));

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Event should still be dispatched
      expect(listener).toHaveBeenCalled();
    });

    it('should skip persistence when skipPersist is true', async () => {
      const db = getDatabase(TEST_DB);
      const listener = vi.fn();
      bus.subscribe(listener);

      const event = createTestEvent('skip-persist');
      await bus.publish(event, { skipPersist: true });

      // Wait for dispatch
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Listener should be called
      expect(listener).toHaveBeenCalledWith(event, 0);

      // But event should NOT be in DB (seq should be 0)
      const records = await db.ui_updates.toArray();
      const found = records.some((r) => r.event.entityId === 'skip-persist');
      expect(found).toBe(false);
    });

    it('should use seqOverride when provided', async () => {
      const listener = vi.fn();
      bus.subscribe(listener);

      const customSeq = 999;
      await bus.publish(createTestEvent('seq-override'), {
        seqOverride: customSeq,
        skipPersist: true,
      });

      // Wait for dispatch
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Listener should receive the overridden seq
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'seq-override' }),
        customSeq,
      );
    });
  });
});
