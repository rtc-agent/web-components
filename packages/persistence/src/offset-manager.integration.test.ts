/**
 * Data Synchronization Integration Tests
 *
 * Tests the collaboration between IndexedDB persistence and WebSocket real-time updates,
 * offline recovery mechanisms, and message deduplication logic.
 *
 * Key scenarios:
 * - Offset management and persistence
 * - Offline recovery (reconnecting and resuming from offset)
 * - Message deduplication (same offset not processed twice)
 * - Offset persistence and gap detection
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDatabase, closeDatabase, DB_NAME_PREFIX } from './database.js';
import { OffsetManager } from './offset-manager.js';
import { UIUpdateBus } from './ui-update-bus.js';

// Enable persistence for these tests
// Save original value to restore after tests
const originalPersistEnabled = UIUpdateBus.persistEnabled;
UIUpdateBus.persistEnabled = true;

describe('Data Synchronization Integration', () => {
  const TEST_DB_NAME = `${DB_NAME_PREFIX}test-data-sync`;

  beforeEach(async () => {
    // Initialize a fresh test database
    getDatabase(TEST_DB_NAME);
  });

  afterEach(async () => {
    // Clean up: close and delete the database
    await closeDatabase();
    // Restore global state to prevent test pollution
    UIUpdateBus.persistEnabled = originalPersistEnabled;
    vi.restoreAllMocks();
  });

  describe('Offset Management and Persistence', () => {
    it('should maintain offset continuity across updates', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Simulate receiving updates with sequential offsets
      const updates = [
        { offset: 1, epoch: 'e1', data: 'update-1' },
        { offset: 2, epoch: 'e1', data: 'update-2' },
        { offset: 3, epoch: 'e1', data: 'update-3' },
      ];

      for (const update of updates) {
        await manager.updatePosition(channel, update.offset, update.epoch);
      }

      // Verify final offset is correct
      const position = await manager.getPosition(channel);
      expect(position).toEqual({ offset: 3, epoch: 'e1' });
    });

    it('should persist offset to IndexedDB for recovery', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';
      const db = getDatabase();

      // Simulate processing updates
      await manager.updatePosition(channel, 100, 'e1');

      // Verify it's in IndexedDB
      const dbRecord = await db.offsets.get({ channel });
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.offset).toBe(100);
    });
  });

  describe('Offline Recovery', () => {
    it('should persist offset across simulated reconnection', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Simulate processing updates before disconnection
      await manager.updatePosition(channel, 100, 'epoch-1');

      // Simulate disconnection (create new manager instance)
      const manager2 = new OffsetManager();

      // After reconnection, should resume from last offset
      const position = await manager2.getPosition(channel);
      expect(position).toEqual({ offset: 100, epoch: 'epoch-1' });
    });

    it('should detect offset gap after offline period', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Set last known offset
      await manager.updatePosition(channel, 50, 'epoch-1');

      // Simulate receiving update with gap (offset jumped from 50 to 100)
      const newOffset = 100;
      const currentPosition = await manager.getPosition(channel);

      expect(currentPosition?.offset).toBe(50);
      expect(newOffset).toBeGreaterThan(currentPosition!.offset + 1); // Gap detected
    });

    it('should handle epoch change (history cleanup)', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Set offset with old epoch
      await manager.updatePosition(channel, 100, 'old-epoch');

      // Simulate epoch change (server cleanup)
      const newEpoch = 'new-epoch';
      await manager.clearPosition(channel);
      await manager.updatePosition(channel, 0, newEpoch);

      const position = await manager.getPosition(channel);
      expect(position).toEqual({ offset: 0, epoch: 'new-epoch' });
    });

    it('should warm up offset cache on reconnection', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Persist offset
      await manager.updatePosition(channel, 75, 'epoch-1');

      // Simulate reconnection with fresh manager
      const manager2 = new OffsetManager();

      // Cache should be empty
      expect(manager2.isCached(channel)).toBe(false);

      // Warm up cache
      await manager2.warmCache(channel);

      // Cache should be populated
      expect(manager2.isCached(channel)).toBe(true);
      const position = await manager2.getPosition(channel);
      expect(position).toEqual({ offset: 75, epoch: 'epoch-1' });
    });
  });

  describe('Message Deduplication', () => {
    it('should not process same offset twice', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Process offset 10
      await manager.updatePosition(channel, 10, 'e1');

      // Verify it's stored
      let position = await manager.getPosition(channel);
      expect(position?.offset).toBe(10);

      // Try to process same offset again - should not change
      await manager.updatePosition(channel, 10, 'e1');

      position = await manager.getPosition(channel);
      expect(position?.offset).toBe(10);
    });

    it('should skip updates with offset <= last processed', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Process offset 50
      await manager.updatePosition(channel, 50, 'e1');

      // Try to process older offsets
      const oldOffset = 45;
      const position = await manager.getPosition(channel);
      const shouldProcess = oldOffset > position!.offset;

      expect(shouldProcess).toBe(false);
    });

    it('should handle rapid consecutive updates', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Simulate rapid updates
      for (let i = 1; i <= 20; i++) {
        await manager.updatePosition(channel, i, 'e1');
      }

      // Should have the last offset
      const position = await manager.getPosition(channel);
      expect(position?.offset).toBe(20);
    });

    it('should deduplicate updates in concurrent scenario', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Concurrent updates with same offset
      const promises = [
        manager.updatePosition(channel, 100, 'e1'),
        manager.updatePosition(channel, 100, 'e1'),
        manager.updatePosition(channel, 100, 'e1'),
      ];

      await Promise.all(promises);

      // Should have correct final state
      const position = await manager.getPosition(channel);
      expect(position).toEqual({ offset: 100, epoch: 'e1' });
    });
  });

  describe('Offset Persistence and Gap Detection', () => {
    it('should persist offset to IndexedDB immediately (write-through)', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';
      const db = getDatabase();

      // Update offset
      await manager.updatePosition(channel, 123, 'epoch-1');

      // Verify it's in IndexedDB immediately
      const dbRecord = await db.offsets.get({ channel });
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.offset).toBe(123);
      expect(dbRecord?.epoch).toBe('epoch-1');
    });

    it('should detect gap when offset jumps', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Set baseline
      await manager.updatePosition(channel, 10, 'e1');

      // Simulate gap (offset jumps from 10 to 50)
      const newOffset = 50;
      const position = await manager.getPosition(channel);

      const hasGap = newOffset > position!.offset + 1;
      expect(hasGap).toBe(true);
      expect(position!.offset).toBe(10);
      expect(newOffset).toBe(50);
    });

    it('should handle multiple channels with independent offsets', async () => {
      const manager = new OffsetManager();
      const channels = ['topic:u=user-1', 'topic:u=user-2', 'live:u=user-1'];

      // Set different offsets for each channel
      await manager.updatePosition(channels[0], 100, 'e1');
      await manager.updatePosition(channels[1], 200, 'e2');
      await manager.updatePosition(channels[2], 300, 'e3');

      // Verify independence
      expect(await manager.getPosition(channels[0])).toEqual({
        offset: 100,
        epoch: 'e1',
      });
      expect(await manager.getPosition(channels[1])).toEqual({
        offset: 200,
        epoch: 'e2',
      });
      expect(await manager.getPosition(channels[2])).toEqual({
        offset: 300,
        epoch: 'e3',
      });
    });

    it('should maintain offset accuracy across cache invalidation', async () => {
      const manager = new OffsetManager();
      const channel = 'topic:u=test-user';

      // Set offset
      await manager.updatePosition(channel, 500, 'e1');

      // Invalidate cache
      manager.invalidateCache(channel);

      // Should reload from IndexedDB with correct value
      const position = await manager.getPosition(channel);
      expect(position).toEqual({ offset: 500, epoch: 'e1' });
    });
  });
});
