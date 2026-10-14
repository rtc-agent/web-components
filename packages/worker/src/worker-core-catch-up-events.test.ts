/**
 * WorkerCore Catch-Up Events Tests
 *
 * Tests for getCatchUpEvents method:
 * - Gap detection boundary conditions
 * - hasMore detection
 * - Edge cases with sequence numbers
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerCore } from './worker-core.js';

// Mock dependencies
vi.mock('@rtc-agent/persistence', () => ({
  virtualFS: {
    write: vi.fn(),
    writeBatch: vi.fn(),
    remove: vi.fn(),
  },
  getDatabase: vi.fn(),
  initializeVirtualFS: vi.fn(),
}));

vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('WorkerCore - getCatchUpEvents', () => {
  let workerCore: WorkerCore;
  let mockDb: any;

  /**
   * Build a mock DB whose `ui_updates` supports the Dexie query chains
   * used by getCatchUpEvents():
   *   - where('seq').above(n).limit(k).toArray()
   *   - orderBy('seq').last()
   */
  function createMockDb(options: {
    entries: Array<{ seq: number; event: object; timestamp: number }>;
  }) {
    const allEntries = [...options.entries].sort((a, b) => a.seq - b.seq);

    return {
      ui_updates: {
        where: (_field: string) => ({
          above: (_fromSeq: number) => {
            // Capture fromSeq for filtering
            let filtered = allEntries.filter((e) => e.seq > _fromSeq);
            return {
              limit: (max: number) => ({
                toArray: async () => filtered.slice(0, max),
              }),
            };
          },
        }),
        orderBy: (_field: string) => ({
          last: async () => {
            if (allEntries.length === 0) return undefined;
            return allEntries[allEntries.length - 1];
          },
        }),
      },
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    const persistence = await import('@rtc-agent/persistence');
    vi.mocked(persistence.getDatabase).mockImplementation(() => mockDb);

    workerCore = new WorkerCore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fromSeq > 0 and entries.length === 0 (empty result boundary)', () => {
    it('should set hasGap = true when latest.seq < fromSeq (all events TTL-deleted beyond cursor)', async () => {
      // DB has events up to seq=5, but we ask for events after seq=10.
      // where('seq').above(10) returns nothing, orderBy('seq').last() returns {seq:5}.
      // Since latest.seq (5) !== fromSeq (10), this is a gap.
      mockDb = createMockDb({
        entries: [
          { seq: 3, event: {}, timestamp: 1 },
          { seq: 5, event: {}, timestamp: 2 },
        ],
      });

      const result = await workerCore.getCatchUpEvents(10);

      expect(result.entries).toEqual([]);
      expect(result.hasGap).toBe(true);
      expect(result.hasMore).toBe(false);
    });

    it('should set hasGap = false when latest.seq === fromSeq (no missed events, cursor is current)', async () => {
      // DB has events up to seq=10, we ask for events after seq=10.
      // where('seq').above(10) returns nothing, orderBy('seq').last() returns {seq:10}.
      // Since latest.seq (10) === fromSeq (10), no gap — cursor is perfectly current.
      mockDb = createMockDb({
        entries: [
          { seq: 8, event: {}, timestamp: 1 },
          { seq: 10, event: {}, timestamp: 2 },
        ],
      });

      const result = await workerCore.getCatchUpEvents(10);

      expect(result.entries).toEqual([]);
      expect(result.hasGap).toBe(false);
      expect(result.hasMore).toBe(false);
    });

    it('should set hasGap = true when DB is completely empty but fromSeq > 0', async () => {
      // All events were TTL-deleted, DB is empty, but we still have a cursor.
      mockDb = createMockDb({ entries: [] });

      const result = await workerCore.getCatchUpEvents(5);

      expect(result.entries).toEqual([]);
      expect(result.hasGap).toBe(true);
    });
  });

  describe('fromSeq > 0 and entries.length > 0 (non-empty result gap detection)', () => {
    it('should detect gap at start when first entry seq > fromSeq + 1', async () => {
      mockDb = createMockDb({
        entries: [
          { seq: 5, event: {}, timestamp: 1 },
          { seq: 6, event: {}, timestamp: 2 },
        ],
      });

      // fromSeq=2, first entry seq=5 > 2+1=3 → gap at start
      const result = await workerCore.getCatchUpEvents(2);

      expect(result.hasGap).toBe(true);
      expect(result.entries.length).toBe(2);
    });

    it('should set hasGap = false for middle gaps (intentionally not detected)', async () => {
      // Middle gaps are NOT checked by design: IndexedDB auto-increment can skip seq
      // numbers when a transaction fails (e.g., constraint violation, quota exceeded),
      // which does not indicate data loss — the event was never persisted.
      mockDb = createMockDb({
        entries: [
          { seq: 3, event: {}, timestamp: 1 },
          { seq: 4, event: {}, timestamp: 2 },
          { seq: 7, event: {}, timestamp: 3 }, // middle gap: expected 5, got 7
          { seq: 8, event: {}, timestamp: 4 },
        ],
      });

      const result = await workerCore.getCatchUpEvents(2);

      // Middle gaps are intentionally not detected (see worker-core.ts comments)
      expect(result.hasGap).toBe(false);
      expect(result.entries.length).toBe(4);
    });

    it('should set hasGap = false when entries are perfectly consecutive from fromSeq', async () => {
      mockDb = createMockDb({
        entries: [
          { seq: 3, event: {}, timestamp: 1 },
          { seq: 4, event: {}, timestamp: 2 },
          { seq: 5, event: {}, timestamp: 3 },
        ],
      });

      const result = await workerCore.getCatchUpEvents(2);

      expect(result.hasGap).toBe(false);
      expect(result.entries.length).toBe(3);
    });
  });

  describe('fromSeq === 0 (no gap detection needed)', () => {
    it('should set hasGap = false regardless of entries', async () => {
      mockDb = createMockDb({
        entries: [
          { seq: 5, event: {}, timestamp: 1 },
          { seq: 10, event: {}, timestamp: 2 },
        ],
      });

      const result = await workerCore.getCatchUpEvents(0);

      expect(result.hasGap).toBe(false);
    });
  });

  describe('hasMore detection', () => {
    it('should set hasMore = true when entries exceed limit', async () => {
      // Create 5 entries, request with limit=3 → should return 3, hasMore=true
      const entries = Array.from({ length: 5 }, (_, i) => ({
        seq: i + 1,
        event: {},
        timestamp: i,
      }));
      mockDb = createMockDb({ entries });

      const result = await workerCore.getCatchUpEvents(0, 3);

      expect(result.hasMore).toBe(true);
      expect(result.entries.length).toBe(3);
    });

    it('should set hasMore = false when entries fit within limit', async () => {
      const entries = [
        { seq: 1, event: {}, timestamp: 1 },
        { seq: 2, event: {}, timestamp: 2 },
      ];
      mockDb = createMockDb({ entries });

      const result = await workerCore.getCatchUpEvents(0, 10);

      expect(result.hasMore).toBe(false);
      expect(result.entries.length).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle database query timeout', async () => {
      mockDb = {
        ui_updates: {
          where: () => ({
            above: () => ({
              limit: () => ({
                toArray: async () => {
                  throw new Error('Query timeout');
                },
              }),
            }),
          }),
          orderBy: () => ({
            last: async () => undefined,
          }),
        },
      };

      await expect(workerCore.getCatchUpEvents(0)).rejects.toThrow(
        'Query timeout',
      );
    });

    it('should handle malformed event data', async () => {
      mockDb = createMockDb({
        entries: [
          { seq: 1, event: null as any, timestamp: 1 },
          { seq: 2, event: undefined as any, timestamp: 2 },
        ],
      });

      const result = await workerCore.getCatchUpEvents(0);
      expect(result.entries).toBeDefined();
      expect(result.entries.length).toBe(2);
    });

    it('should handle very large sequence numbers', async () => {
      mockDb = createMockDb({
        entries: [
          {
            seq: Number.MAX_SAFE_INTEGER - 1,
            event: {},
            timestamp: 1,
          },
          { seq: Number.MAX_SAFE_INTEGER, event: {}, timestamp: 2 },
        ],
      });

      const result = await workerCore.getCatchUpEvents(
        Number.MAX_SAFE_INTEGER - 2,
      );
      expect(result.entries.length).toBe(2);
    });

    it('should handle negative sequence numbers gracefully', async () => {
      mockDb = createMockDb({
        entries: [
          { seq: -1, event: {}, timestamp: 1 },
          { seq: 0, event: {}, timestamp: 2 },
          { seq: 1, event: {}, timestamp: 3 },
        ],
      });

      const result = await workerCore.getCatchUpEvents(-2);
      expect(result.entries.length).toBe(3);
    });
  });
});
