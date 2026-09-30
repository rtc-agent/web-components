import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';
import type { UIUpdateQueueEntry } from './database';
import * as databaseModule from './database.js';

// Mock getDatabase at the top level using vi.hoisted() to create a mutable reference.
// This ensures the mock is in place BEFORE ui-update-bus imports getDatabase.
const mockState = vi.hoisted(() => ({ db: null as any }));

// Spy on getDatabase to return our mock DB
vi.spyOn(databaseModule, 'getDatabase').mockImplementation(() => {
  if (!mockState.db) throw new Error('getDatabase: mock DB not set');
  return mockState.db;
});

// Now import ui-update-bus (after mock is set up)
import { getUIUpdateBus, closeUIUpdateBus, UIUpdateBus } from './ui-update-bus';
import type { UIUpdateEvent } from './ui-update-bus';

/**
 * Edge case tests for persistent UIUpdateBus queue.
 *
 * Tests extreme scenarios:
 * - Page refresh during active operations
 * - Multiple tabs with independent cursors
 * - Weak network reconnection
 * - TTL cleanup
 * - Partial catch-up failures
 */

// Mock sessionStorage for Node.js test environment
const mockStorage: Record<string, string> = {};
const sessionStorageMock = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }),
  get length() { return Object.keys(mockStorage).length; },
  key: vi.fn((i: number) => Object.keys(mockStorage)[i] ?? null),
};

// Patch globalThis for test environment
(globalThis as any).sessionStorage = sessionStorageMock;

// Test database name suffix to ensure isolation
let testId = 0;

/**
 * Create a fresh test database (unique per test to avoid seq counter collision)
 */
function createTestDB(): Dexie & { ui_updates: Dexie.Table<UIUpdateQueueEntry, number> } {
  const dbName = `test-persistent-queue-${++testId}`;
  const db = new Dexie(dbName) as Dexie & { ui_updates: Dexie.Table<UIUpdateQueueEntry, number> };
  db.version(1).stores({
    ui_updates: '++seq, timestamp',
  });
  return db;
}

describe('Persistent UIUpdateBus Queue - Edge Cases', () => {
  let bus: UIUpdateBus;
  let db: Dexie & { ui_updates: Dexie.Table<UIUpdateQueueEntry, number> };

  beforeEach(async () => {
    // Enable persistence for this test (test-setup.ts disables it globally)
    UIUpdateBus.persistEnabled = true;

    // Reset singletons
    closeUIUpdateBus();
    bus = getUIUpdateBus();

    // Create fresh database (unique name to avoid auto-increment collision)
    db = createTestDB();

    // Set the mock DB reference (vi.spyOn uses this)
    mockState.db = db;

    // Clear sessionStorage
    sessionStorageMock.clear();

    // Initialize the bus: set the _initialized flag (required before publish persists)
    await bus.init();
  });

  afterEach(async () => {
    closeUIUpdateBus();
    await db.delete();
    mockState.db = null;
  });

  const createTestEvent = (entityId: string, field = 'content'): UIUpdateEvent => ({
    entity: 'session',
    action: 'created',
    entityId,
    field,
    oldValue: undefined,
    newValue: `value-${entityId}`,
  });

  /**
   * Helper: simulate tab behavior (mimics WorkerBridge's catch-up logic)
   */
  class TabSimulator {
    private _lastProcessedSeq = 0;
    private receivedEvents: UIUpdateEvent[] = [];
    private storageKey: string;

    constructor(tabId: string) {
      this.storageKey = `rtc-ui-update-seq-${tabId}`;
      this.loadFromStorage();
    }

    private loadFromStorage(): void {
      try {
        const stored = sessionStorageMock.getItem(this.storageKey);
        if (stored !== null) {
          const seq = parseInt(stored, 10);
          if (!isNaN(seq) && seq >= 0) {
            this._lastProcessedSeq = seq;
          }
        }
      } catch {
        // sessionStorage unavailable
      }
    }

    private saveToStorage(): void {
      try {
        sessionStorageMock.setItem(this.storageKey, String(this._lastProcessedSeq));
      } catch {
        // sessionStorage unavailable
      }
    }

    receiveRealtimeEvent(event: UIUpdateEvent): void {
      this.receivedEvents.push(event);
    }

    async catchUp(): Promise<number> {
      const entries = await db.ui_updates
        .where('seq')
        .above(this._lastProcessedSeq)
        .toArray();

      let catchUpCount = 0;
      let skippedInvalid = 0;
      for (const entry of entries) {
        try {
          // Runtime validation: skip events with invalid structure
          if (!this.isValidUIUpdateEvent(entry.event)) {
            skippedInvalid++;
            this._lastProcessedSeq = entry.seq;
            this.saveToStorage();
            continue;
          }
          this.receivedEvents.push(entry.event as UIUpdateEvent);
          this._lastProcessedSeq = entry.seq;
          this.saveToStorage();
          catchUpCount++;
        } catch {
          break;
        }
      }

      return catchUpCount;
    }

    private isValidUIUpdateEvent(event: unknown): event is UIUpdateEvent {
      if (!event || typeof event !== 'object') return false;
      const e = event as Record<string, unknown>;
      return typeof e.entity === 'string' &&
             typeof e.action === 'string' &&
             typeof e.entityId === 'string';
    }

    getReceivedEvents(): UIUpdateEvent[] {
      return [...this.receivedEvents];
    }

    getLastProcessedSeq(): number {
      return this._lastProcessedSeq;
    }

    setLastProcessedSeq(seq: number): void {
      this._lastProcessedSeq = seq;
      this.saveToStorage();
    }

    clearReceivedEvents(): void {
      this.receivedEvents = [];
    }

    simulatePageRefresh(): void {
      this.receivedEvents = [];
      this.loadFromStorage();
    }
  }

  // bus.publish() is now async and awaits the DB write internally.
  // Simply await the call to ensure persistence completes before assertions.
  async function publishAndPersist(event: UIUpdateEvent): Promise<void> {
    await bus.publish(event);
  }

  describe('Scenario 1: Page refresh during active operation', () => {
    it('should recover events after page refresh', async () => {
      const tab = new TabSimulator('tab-1');

      // Step 1: Publish events (simulating active AI operation)
      const event1 = createTestEvent('session-1');
      const event2 = createTestEvent('session-2');
      const event3 = createTestEvent('session-3');

      await publishAndPersist(event1);
      tab.receiveRealtimeEvent(event1);

      await publishAndPersist(event2);
      tab.receiveRealtimeEvent(event2);

      await publishAndPersist(event3);
      tab.receiveRealtimeEvent(event3);

      // Verify all events persisted to DB
      const allEntries = await db.ui_updates.toArray();
      expect(allEntries).toHaveLength(3);

      // Step 2: Simulate page refresh (in-memory state cleared, sessionStorage preserved)
      tab.simulatePageRefresh();
      expect(tab.getReceivedEvents()).toHaveLength(0);

      // Step 3: Catch up after refresh
      const catchUpCount = await tab.catchUp();
      expect(catchUpCount).toBe(3);
      expect(tab.getReceivedEvents()).toHaveLength(3);
      expect(tab.getLastProcessedSeq()).toBe(3);

      // Verify events are in correct order
      const events = tab.getReceivedEvents();
      expect(events[0].entityId).toBe('session-1');
      expect(events[1].entityId).toBe('session-2');
      expect(events[2].entityId).toBe('session-3');
    });

    it('should not re-deliver events after successful catch-up', async () => {
      const tab = new TabSimulator('tab-1');

      await publishAndPersist(createTestEvent('session-1'));
      await publishAndPersist(createTestEvent('session-2'));
      await tab.catchUp();

      expect(tab.getReceivedEvents()).toHaveLength(2);
      expect(tab.getLastProcessedSeq()).toBe(2);

      // Simulate refresh and catch up again
      tab.simulatePageRefresh();
      const catchUpCount = await tab.catchUp();

      // Should not catch up any new events (all already processed)
      expect(catchUpCount).toBe(0);
      expect(tab.getReceivedEvents()).toHaveLength(0);
    });
  });

  describe('Scenario 2: Multiple tabs with independent cursors', () => {
    it('should maintain separate cursors for each tab', async () => {
      const tabA = new TabSimulator('tab-a');
      const tabB = new TabSimulator('tab-b');

      // Publish 5 events
      for (let i = 1; i <= 5; i++) {
        await publishAndPersist(createTestEvent(`session-${i}`));
      }

      // Tab A catches up to seq 3
      const entriesA = await db.ui_updates
        .where('seq')
        .above(0)
        .limit(3)
        .toArray();

      for (const entry of entriesA) {
        tabA.receiveRealtimeEvent(entry.event as UIUpdateEvent);
        tabA.setLastProcessedSeq(entry.seq);
      }

      expect(tabA.getLastProcessedSeq()).toBe(3);

      // Tab B catches up to seq 5
      await tabB.catchUp();
      expect(tabB.getLastProcessedSeq()).toBe(5);

      // Verify both tabs processed correct events
      expect(tabA.getReceivedEvents()).toHaveLength(3);
      expect(tabB.getReceivedEvents()).toHaveLength(5);
    });

    it('should handle tab refresh independently', async () => {
      const tabA = new TabSimulator('tab-a');
      const tabB = new TabSimulator('tab-b');

      for (let i = 1; i <= 5; i++) {
        await publishAndPersist(createTestEvent(`session-${i}`));
      }

      // Tab A catches up to seq 3
      const entriesA = await db.ui_updates
        .where('seq')
        .above(0)
        .limit(3)
        .toArray();

      for (const entry of entriesA) {
        tabA.receiveRealtimeEvent(entry.event as UIUpdateEvent);
        tabA.setLastProcessedSeq(entry.seq);
      }

      // Tab B catches up to seq 5
      await tabB.catchUp();

      // Tab A refreshes
      tabA.simulatePageRefresh();
      expect(tabA.getReceivedEvents()).toHaveLength(0);

      // Tab A catches up again (should get events 4 and 5)
      const catchUpCount = await tabA.catchUp();
      expect(catchUpCount).toBe(2);
      expect(tabA.getLastProcessedSeq()).toBe(5);

      // Tab B was not affected
      expect(tabB.getLastProcessedSeq()).toBe(5);
    });
  });

  describe('Scenario 3: Weak network / reconnection', () => {
    it('should handle events published during disconnection', async () => {
      const tab = new TabSimulator('tab-1');

      // Tab is "connected" and receives first event via real-time
      // (real-time delivery does NOT update lastProcessedSeq)
      const event1 = createTestEvent('session-1');
      await publishAndPersist(event1);
      tab.receiveRealtimeEvent(event1);
      expect(tab.getLastProcessedSeq()).toBe(0); // Real-time doesn't advance cursor

      // Simulate disconnection (tab stops receiving real-time events)
      // But events continue to be published and persisted
      const event2 = createTestEvent('session-2');
      const event3 = createTestEvent('session-3');
      await publishAndPersist(event2);
      await publishAndPersist(event3);

      // Tab didn't receive events 2 and 3 (disconnected)
      expect(tab.getReceivedEvents()).toHaveLength(1);

      // Simulate reconnection: catchUp replays from lastProcessedSeq=0
      // This means event1 is re-delivered (duplicate), but handlers are idempotent
      const catchUpCount = await tab.catchUp();
      expect(catchUpCount).toBe(3); // Replays all 3 events from seq 0
      expect(tab.getReceivedEvents()).toHaveLength(4); // event1 (real-time) + event1,2,3 (catchUp)
      expect(tab.getLastProcessedSeq()).toBe(3);
    });

    it('should handle rapid reconnect/disconnect cycles', async () => {
      const tab = new TabSimulator('tab-1');

      // Cycle 1: connect, receive event, disconnect
      await publishAndPersist(createTestEvent('session-1'));
      await tab.catchUp();
      expect(tab.getLastProcessedSeq()).toBe(1);

      // Cycle 2: disconnect, publish events, reconnect
      await publishAndPersist(createTestEvent('session-2'));
      await publishAndPersist(createTestEvent('session-3'));
      await tab.catchUp();
      expect(tab.getLastProcessedSeq()).toBe(3);

      // Cycle 3: disconnect, publish event, reconnect
      await publishAndPersist(createTestEvent('session-4'));
      await tab.catchUp();
      expect(tab.getLastProcessedSeq()).toBe(4);

      expect(tab.getReceivedEvents()).toHaveLength(4);
    });
  });

  describe('Scenario 4: TTL cleanup', () => {
    it('should clean up events older than 30 minutes', async () => {
      // Publish events with old timestamps
      await publishAndPersist(createTestEvent('session-old'));

      // Manually update timestamp to simulate old event
      const entries = await db.ui_updates.toArray();
      const oldTimestamp = Date.now() - 31 * 60 * 1000; // 31 minutes ago
      await db.ui_updates.update(entries[0].seq, { timestamp: oldTimestamp });

      // Publish recent event
      await publishAndPersist(createTestEvent('session-recent'));

      // Verify both events exist
      const beforeCleanup = await db.ui_updates.toArray();
      expect(beforeCleanup).toHaveLength(2);

      // Simulate cleanup (normally happens in WorkerCore.close())
      const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
      const deleted = await db.ui_updates.where('timestamp').below(cutoff).delete();
      expect(deleted).toBe(1);

      // Verify only recent event remains
      const afterCleanup = await db.ui_updates.toArray();
      expect(afterCleanup).toHaveLength(1);
      expect((afterCleanup[0].event as UIUpdateEvent).entityId).toBe('session-recent');
    });

    it('should not catch up events that were cleaned up', async () => {
      const tab = new TabSimulator('tab-1');

      // Publish event and clean it up
      await publishAndPersist(createTestEvent('session-old'));
      const entries = await db.ui_updates.toArray();
      const oldTimestamp = Date.now() - 31 * 60 * 1000; // 31 minutes ago
      await db.ui_updates.update(entries[0].seq, { timestamp: oldTimestamp });

      const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
      await db.ui_updates.where('timestamp').below(cutoff).delete();

      // Publish new event
      await publishAndPersist(createTestEvent('session-new'));

      // Tab catches up (should only get the new event)
      const catchUpCount = await tab.catchUp();
      expect(catchUpCount).toBe(1);
      expect(tab.getReceivedEvents()).toHaveLength(1);
      expect(tab.getReceivedEvents()[0].entityId).toBe('session-new');
    });
  });

  describe('Scenario 5: Partial catch-up failure', () => {
    it('should stop at first failure and retry from last ACK', async () => {
      const tab = new TabSimulator('tab-1');

      // Publish 5 events
      for (let i = 1; i <= 5; i++) {
        await publishAndPersist(createTestEvent(`session-${i}`));
      }

      // Manually catch up, simulating failure on 3rd event
      const entries = await db.ui_updates.where('seq').above(0).toArray();
      let deliveredCount = 0;
      for (const entry of entries) {
        deliveredCount++;
        if (deliveredCount === 3) {
          break; // Simulate failure: stop processing
        }
        tab.receiveRealtimeEvent(entry.event as UIUpdateEvent);
        tab.setLastProcessedSeq(entry.seq);
      }

      expect(tab.getLastProcessedSeq()).toBe(2); // Only processed 2 events
      expect(tab.getReceivedEvents()).toHaveLength(2);

      // Resume catch-up (should continue from seq 2)
      const catchUpCount = await tab.catchUp();
      expect(catchUpCount).toBe(3); // Processed events 3, 4, 5
      expect(tab.getLastProcessedSeq()).toBe(5);
      expect(tab.getReceivedEvents()).toHaveLength(5);
    });
  });

  describe('Scenario 6: sessionStorage unavailable', () => {
    it('should fallback to lastProcessedSeq = 0 when sessionStorage is unavailable', () => {
      // Simulate sessionStorage unavailable by clearing and making getItem throw
      sessionStorageMock.clear();
      sessionStorageMock.getItem.mockImplementationOnce(() => {
        throw new Error('sessionStorage unavailable');
      });

      // Create tab (should fallback to 0)
      const tab = new TabSimulator('tab-1');
      expect(tab.getLastProcessedSeq()).toBe(0);
    });
  });

  describe('Scenario 7: High volume stress test', () => {
    it('should handle 1000 events without performance degradation', async () => {
      const tab = new TabSimulator('tab-1');

      const startTime = Date.now();

      // Publish 1000 events
      for (let i = 1; i <= 1000; i++) {
        const clonedEvent = JSON.parse(JSON.stringify(createTestEvent(`session-${i}`)));
        await db.ui_updates.add({ event: clonedEvent, timestamp: Date.now() });
      }

      const publishTime = Date.now() - startTime;
      expect(publishTime).toBeLessThan(10000); // Should complete in < 10 seconds

      // Catch up all events
      const catchUpStart = Date.now();
      const catchUpCount = await tab.catchUp();
      const catchUpTime = Date.now() - catchUpStart;

      expect(catchUpCount).toBe(1000);
      expect(catchUpTime).toBeLessThan(10000); // Should complete in < 10 seconds
      expect(tab.getLastProcessedSeq()).toBe(1000);
    });
  });

  describe('Scenario 8: structuredClone failure fallback', () => {
    it('should fallback to JSON serialization when structuredClone fails', async () => {
      // Create an event with a property that structuredClone cannot handle
      // (Note: in practice, UIUpdateEvent should always be cloneable, but we test the fallback)
      const event = createTestEvent('session-1');

      // Spy on structuredClone to simulate failure
      const originalStructuredClone = globalThis.structuredClone;
      let cloneCallCount = 0;
      (globalThis as any).structuredClone = (obj: any) => {
        cloneCallCount++;
        // Throw on first call to trigger fallback
        if (cloneCallCount === 1) {
          throw new Error('DataCloneError: structuredClone failed');
        }
        return originalStructuredClone(obj);
      };

      try {
        // Publish should succeed via JSON fallback
        await publishAndPersist(event);

        // Verify event was persisted
        const entries = await db.ui_updates.toArray();
        expect(entries).toHaveLength(1);
        expect((entries[0].event as UIUpdateEvent).entityId).toBe('session-1');
      } finally {
        // Restore original structuredClone
        (globalThis as any).structuredClone = originalStructuredClone;
      }
    });
  });

  describe('Scenario 9: Invalid event structure', () => {
    it('should skip events with invalid structure during catch-up', async () => {
      const tab = new TabSimulator('tab-1');

      // Add valid event
      await db.ui_updates.add({
        event: createTestEvent('valid-session'),
        timestamp: Date.now(),
      });

      // Add invalid event (missing required fields)
      await db.ui_updates.add({
        event: { invalid: 'structure' },
        timestamp: Date.now(),
      });

      // Add another valid event
      await db.ui_updates.add({
        event: createTestEvent('another-valid'),
        timestamp: Date.now(),
      });

      // Catch up should skip the invalid event and only receive 2 valid events
      const catchUpCount = await tab.catchUp();
      expect(catchUpCount).toBe(2); // Only valid events counted
      expect(tab.getReceivedEvents()).toHaveLength(2);
      expect(tab.getReceivedEvents()[0].entityId).toBe('valid-session');
      expect(tab.getReceivedEvents()[1].entityId).toBe('another-valid');
      // But lastProcessedSeq should advance past all 3 entries
      expect(tab.getLastProcessedSeq()).toBe(3);
    });
  });
});
