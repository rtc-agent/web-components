import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OffsetManager } from './offset-manager.js';
import { getDatabase, closeDatabase, DB_NAME_PREFIX } from './database.js';

describe('OffsetManager', () => {
    const TEST_DB_NAME = `${DB_NAME_PREFIX}test-offset-manager`;
    let manager: OffsetManager;

    beforeEach(async () => {
        // Initialize a fresh test database
        getDatabase(TEST_DB_NAME);
        manager = new OffsetManager();
    });

    afterEach(async () => {
        // Clean up: close and delete the database
        await closeDatabase();
    });

    // ── getPosition ──

    describe('getPosition', () => {
        it('should return undefined for unknown channel', async () => {
            const result = await manager.getPosition('unknown-channel');
            expect(result).toBeUndefined();
        });

        it('should return stored offset and epoch', async () => {
            await manager.updatePosition('ch-1', 42, 'epoch-1');
            const result = await manager.getPosition('ch-1');
            expect(result).toEqual({ offset: 42, epoch: 'epoch-1' });
        });

        it('should return a copy of cached data (not mutable reference)', async () => {
            await manager.updatePosition('ch-1', 42, 'epoch-1');
            const result1 = await manager.getPosition('ch-1');

            // Try to mutate the returned object
            if (result1) {
                result1.offset = 999;
                result1.epoch = 'mutated';
            }

            // Get again and verify original is unchanged
            const result2 = await manager.getPosition('ch-1');
            expect(result2).toEqual({ offset: 42, epoch: 'epoch-1' });
        });
    });

    // ── updatePosition ──

    describe('updatePosition', () => {
        it('should create a new offset record', async () => {
            await manager.updatePosition('ch-new', 100, 'e1');
            const result = await manager.getPosition('ch-new');
            expect(result).toEqual({ offset: 100, epoch: 'e1' });
        });

        it('should update an existing offset record', async () => {
            await manager.updatePosition('ch-1', 10, 'e1');
            await manager.updatePosition('ch-1', 20, 'e2');
            const result = await manager.getPosition('ch-1');
            expect(result).toEqual({ offset: 20, epoch: 'e2' });
        });

        it('should handle zero offset', async () => {
            await manager.updatePosition('ch-zero', 0, 'e0');
            const result = await manager.getPosition('ch-zero');
            expect(result).toEqual({ offset: 0, epoch: 'e0' });
        });

        it('should track multiple channels independently', async () => {
            await manager.updatePosition('ch-a', 1, 'ea');
            await manager.updatePosition('ch-b', 2, 'eb');
            await manager.updatePosition('ch-c', 3, 'ec');

            expect(await manager.getPosition('ch-a')).toEqual({ offset: 1, epoch: 'ea' });
            expect(await manager.getPosition('ch-b')).toEqual({ offset: 2, epoch: 'eb' });
            expect(await manager.getPosition('ch-c')).toEqual({ offset: 3, epoch: 'ec' });
        });

        it('should handle very large offset values', async () => {
            const largeOffset = Number.MAX_SAFE_INTEGER;
            await manager.updatePosition('ch-large', largeOffset, 'e-large');
            const result = await manager.getPosition('ch-large');
            expect(result).toEqual({ offset: largeOffset, epoch: 'e-large' });
        });

        it('should handle empty epoch string', async () => {
            await manager.updatePosition('ch-empty-epoch', 10, '');
            const result = await manager.getPosition('ch-empty-epoch');
            expect(result).toEqual({ offset: 10, epoch: '' });
        });

        it('should handle special characters in channel name', async () => {
            const specialChannel = 'topic:u=user-123_with.special:chars';
            await manager.updatePosition(specialChannel, 50, 'e-special');
            const result = await manager.getPosition(specialChannel);
            expect(result).toEqual({ offset: 50, epoch: 'e-special' });
        });
    });

    // ── clearPosition ──

    describe('clearPosition', () => {
        it('should clear a specific channel', async () => {
            await manager.updatePosition('ch-1', 42, 'e1');
            await manager.clearPosition('ch-1');
            expect(await manager.getPosition('ch-1')).toBeUndefined();
        });

        it('should not affect other channels', async () => {
            await manager.updatePosition('ch-a', 1, 'ea');
            await manager.updatePosition('ch-b', 2, 'eb');
            await manager.clearPosition('ch-a');

            expect(await manager.getPosition('ch-a')).toBeUndefined();
            expect(await manager.getPosition('ch-b')).toEqual({ offset: 2, epoch: 'eb' });
        });

        it('should be a no-op for non-existent channel', async () => {
            // Should not throw
            await expect(manager.clearPosition('nonexistent')).resolves.toBeUndefined();
        });

        it('should also clear from memory cache', async () => {
            await manager.updatePosition('ch-1', 42, 'e1');
            expect(manager.isCached('ch-1')).toBe(true);

            await manager.clearPosition('ch-1');
            expect(manager.isCached('ch-1')).toBe(false);
        });
    });

    // ── clearAll / reset ──

    describe('clearAll', () => {
        it('should clear all offset records', async () => {
            await manager.updatePosition('ch-1', 1, 'e1');
            await manager.updatePosition('ch-2', 2, 'e2');
            await manager.clearAll();

            expect(await manager.getPosition('ch-1')).toBeUndefined();
            expect(await manager.getPosition('ch-2')).toBeUndefined();
        });

        it('should also clear memory cache', async () => {
            await manager.updatePosition('ch-1', 1, 'e1');
            await manager.updatePosition('ch-2', 2, 'e2');
            expect(manager.getCacheSize()).toBe(2);

            await manager.clearAll();
            expect(manager.getCacheSize()).toBe(0);
        });
    });

    describe('reset', () => {
        it('should behave identically to clearAll', async () => {
            await manager.updatePosition('ch-1', 1, 'e1');
            await manager.reset();
            expect(await manager.getPosition('ch-1')).toBeUndefined();
        });
    });

    // ── Memory Cache Behavior ──

    describe('memory cache', () => {
        it('should populate cache on first getPosition call (cache miss)', async () => {
            // First, write directly to IndexedDB (bypass cache)
            const db = getDatabase();
            await db.offsets.put({
                channel: 'ch-direct',
                offset: 100,
                epoch: 'e-direct',
                updatedAt: Date.now(),
            });

            // Verify not cached yet
            expect(manager.isCached('ch-direct')).toBe(false);

            // First getPosition should load from DB and cache
            const result = await manager.getPosition('ch-direct');
            expect(result).toEqual({ offset: 100, epoch: 'e-direct' });

            // Now should be cached
            expect(manager.isCached('ch-direct')).toBe(true);
        });

        it('should return from cache on subsequent calls (cache hit)', async () => {
            await manager.updatePosition('ch-1', 42, 'e1');

            // Should be cached after update
            expect(manager.isCached('ch-1')).toBe(true);

            // Spy on DB to verify no second read
            const db = getDatabase();
            const dbSpy = vi.spyOn(db.offsets, 'get');

            // Second call should hit cache, not DB
            const result = await manager.getPosition('ch-1');
            expect(result).toEqual({ offset: 42, epoch: 'e1' });

            // DB should not have been queried
            expect(dbSpy).not.toHaveBeenCalled();
        });

        it('should update cache synchronously on updatePosition', async () => {
            // Start with no cache
            expect(manager.isCached('ch-1')).toBe(false);

            // updatePosition should update cache immediately (synchronously)
            const updatePromise = manager.updatePosition('ch-1', 100, 'e1');

            // Cache should be updated before promise resolves
            // (This tests the write-through behavior)
            expect(manager.isCached('ch-1')).toBe(true);

            await updatePromise;

            const result = await manager.getPosition('ch-1');
            expect(result).toEqual({ offset: 100, epoch: 'e1' });
        });

        it('should handle rapid consecutive updates', async () => {
            const channel = 'ch-rapid';

            // Perform many rapid updates
            for (let i = 0; i < 100; i++) {
                await manager.updatePosition(channel, i, `e${i}`);
            }

            // Should have the last value
            const result = await manager.getPosition(channel);
            expect(result).toEqual({ offset: 99, epoch: 'e99' });
        });

        it('should maintain cache consistency across multiple channels', async () => {
            const channels = ['ch-a', 'ch-b', 'ch-c', 'ch-d', 'ch-e'];

            // Update all channels
            for (let i = 0; i < channels.length; i++) {
                await manager.updatePosition(channels[i], i * 10, `e${i}`);
            }

            // Verify all are cached correctly
            expect(manager.getCacheSize()).toBe(channels.length);

            for (let i = 0; i < channels.length; i++) {
                expect(manager.isCached(channels[i])).toBe(true);
                const result = await manager.getPosition(channels[i]);
                expect(result).toEqual({ offset: i * 10, epoch: `e${i}` });
            }
        });
    });

    // ── Cache Invalidation ──

    describe('cache invalidation', () => {
        it('invalidateCache should remove specific channel from cache', async () => {
            await manager.updatePosition('ch-1', 42, 'e1');
            expect(manager.isCached('ch-1')).toBe(true);

            manager.invalidateCache('ch-1');
            expect(manager.isCached('ch-1')).toBe(false);

            // But DB should still have the data
            const result = await manager.getPosition('ch-1');
            expect(result).toEqual({ offset: 42, epoch: 'e1' });
        });

        it('invalidateAllCache should clear entire cache', async () => {
            await manager.updatePosition('ch-1', 1, 'e1');
            await manager.updatePosition('ch-2', 2, 'e2');
            await manager.updatePosition('ch-3', 3, 'e3');

            expect(manager.getCacheSize()).toBe(3);

            manager.invalidateAllCache();
            expect(manager.getCacheSize()).toBe(0);

            // Data should still be in DB
            expect(await manager.getPosition('ch-1')).toEqual({ offset: 1, epoch: 'e1' });
        });

        it('should reload from DB after cache invalidation', async () => {
            await manager.updatePosition('ch-1', 100, 'e1');
            manager.invalidateCache('ch-1');

            // Manually modify DB to simulate external change
            const db = getDatabase();
            await db.offsets.put({
                channel: 'ch-1',
                offset: 999,
                epoch: 'e-modified',
                updatedAt: Date.now(),
            });

            // Next getPosition should load from DB (cache was invalidated)
            const result = await manager.getPosition('ch-1');
            expect(result).toEqual({ offset: 999, epoch: 'e-modified' });
        });
    });

    // ── warmCache ──

    describe('warmCache', () => {
        it('should pre-load data into cache', async () => {
            // Write directly to DB
            const db = getDatabase();
            await db.offsets.put({
                channel: 'ch-warm',
                offset: 500,
                epoch: 'e-warm',
                updatedAt: Date.now(),
            });

            expect(manager.isCached('ch-warm')).toBe(false);

            // Warm the cache
            const result = await manager.warmCache('ch-warm');
            expect(result).toEqual({ offset: 500, epoch: 'e-warm' });
            expect(manager.isCached('ch-warm')).toBe(true);
        });

        it('should return undefined for non-existent channel', async () => {
            const result = await manager.warmCache('nonexistent');
            expect(result).toBeUndefined();
        });

        it('should be idempotent', async () => {
            await manager.updatePosition('ch-1', 42, 'e1');

            // Call warmCache multiple times
            await manager.warmCache('ch-1');
            await manager.warmCache('ch-1');
            await manager.warmCache('ch-1');

            // Should still have correct value
            expect(await manager.getPosition('ch-1')).toEqual({ offset: 42, epoch: 'e1' });
            expect(manager.getCacheSize()).toBe(1);
        });
    });

    // ── Error Handling ──

    describe('error handling', () => {
        it('should handle DB read errors gracefully', async () => {
            // Create a manager that will fail on DB read
            const db = getDatabase();
            const originalGet = db.offsets.get.bind(db.offsets);

            // Mock DB to throw error
            vi.spyOn(db.offsets, 'get').mockRejectedValueOnce(new Error('DB read error'));

            // Should propagate error
            await expect(manager.getPosition('ch-error')).rejects.toThrow('DB read error');
        });

        it('should rollback cache on DB write failure', async () => {
            const db = getDatabase();

            // Set initial value
            await manager.updatePosition('ch-1', 100, 'e1');
            expect(await manager.getPosition('ch-1')).toEqual({ offset: 100, epoch: 'e1' });

            // Mock DB to throw error on next write
            vi.spyOn(db.offsets, 'put').mockRejectedValueOnce(new Error('DB write error'));

            // Try to update - should fail
            await expect(manager.updatePosition('ch-1', 200, 'e2')).rejects.toThrow('DB write error');

            // Cache should have rolled back to previous value
            const result = await manager.getPosition('ch-1');
            expect(result).toEqual({ offset: 100, epoch: 'e1' });
        });

        it('should remove from cache if DB write fails on new channel', async () => {
            const db = getDatabase();

            // Mock DB to throw error
            vi.spyOn(db.offsets, 'put').mockRejectedValueOnce(new Error('DB write error'));

            // Try to create new record - should fail
            await expect(manager.updatePosition('ch-new', 100, 'e1')).rejects.toThrow('DB write error');

            // Should not be cached
            expect(manager.isCached('ch-new')).toBe(false);
        });
    });

    // ── Concurrent Operations ──

    describe('concurrent operations', () => {
        it('should handle concurrent updates to same channel', async () => {
            const channel = 'ch-concurrent';

            // Start multiple concurrent updates
            const promises = [
                manager.updatePosition(channel, 1, 'e1'),
                manager.updatePosition(channel, 2, 'e2'),
                manager.updatePosition(channel, 3, 'e3'),
            ];

            await Promise.all(promises);

            // Should have one of the values (order not guaranteed)
            const result = await manager.getPosition(channel);
            expect(result).toBeDefined();
            expect([1, 2, 3]).toContain(result?.offset);
        });

        it('should handle concurrent reads and writes', async () => {
            const channel = 'ch-mixed';

            // Initial value
            await manager.updatePosition(channel, 0, 'e0');

            // Concurrent reads and writes
            const readPromises = [];
            const writePromises = [];

            for (let i = 1; i <= 10; i++) {
                readPromises.push(manager.getPosition(channel));
                writePromises.push(manager.updatePosition(channel, i, `e${i}`));
            }

            await Promise.all([...readPromises, ...writePromises]);

            // Should have a valid value
            const result = await manager.getPosition(channel);
            expect(result).toBeDefined();
        });

        it('should handle concurrent updates to different channels', async () => {
            const promises = [];

            for (let i = 0; i < 100; i++) {
                promises.push(manager.updatePosition(`ch-${i}`, i, `e${i}`));
            }

            await Promise.all(promises);

            // All should be correct
            for (let i = 0; i < 100; i++) {
                const result = await manager.getPosition(`ch-${i}`);
                expect(result).toEqual({ offset: i, epoch: `e${i}` });
            }
        });
    });

    // ── Race Condition Prevention ──

    describe('race condition prevention', () => {
        it('should provide synchronous reads after warm-up', async () => {
            const channel = 'ch-race';

            // Warm up the cache
            await manager.updatePosition(channel, 100, 'e1');

            // Multiple synchronous-style reads should all get same value
            const reads = await Promise.all([
                manager.getPosition(channel),
                manager.getPosition(channel),
                manager.getPosition(channel),
            ]);

            expect(reads[0]).toEqual(reads[1]);
            expect(reads[1]).toEqual(reads[2]);
        });

        it('should maintain consistency during rapid read-write cycles', async () => {
            const channel = 'ch-cycle';
            let expectedOffset = 0;

            for (let i = 0; i < 50; i++) {
                await manager.updatePosition(channel, expectedOffset, `e${expectedOffset}`);
                const result = await manager.getPosition(channel);
                expect(result?.offset).toBe(expectedOffset);
                expectedOffset++;
            }
        });

        it('should handle subscribe-like scenario correctly', async () => {
            // Simulate the scenario from the issue:
            // 1. Cache is empty
            // 2. Publication arrives before subscribed event completes
            // 3. scheduleUpdate checks cache (should be able to read after warm-up)

            const channel = 'topic:u=test-user';

            // Simulate: first, load from DB (simulating reconnect scenario)
            const db = getDatabase();
            await db.offsets.put({
                channel,
                offset: 100,
                epoch: 'e1',
                updatedAt: Date.now(),
            });

            // Pre-warm cache (like subscribeChannels should do)
            await manager.warmCache(channel);

            // Now cache should be populated
            expect(manager.isCached(channel)).toBe(true);

            // Simulate rapid publications arriving
            const publications = [
                { offset: 101, epoch: 'e1' },
                { offset: 102, epoch: 'e1' },
                { offset: 103, epoch: 'e1' },
            ];

            // Each publication should see the correct lastOffset
            for (const pub of publications) {
                const position = await manager.getPosition(channel);
                expect(position?.offset).toBeLessThan(pub.offset);

                // Process and update
                await manager.updatePosition(channel, pub.offset, pub.epoch);
            }

            // Final state should be correct
            const finalPosition = await manager.getPosition(channel);
            expect(finalPosition).toEqual({ offset: 103, epoch: 'e1' });
        });
    });

    // ── Utility Methods ──

    describe('utility methods', () => {
        it('getCacheSize should return correct count', async () => {
            expect(manager.getCacheSize()).toBe(0);

            await manager.updatePosition('ch-1', 1, 'e1');
            expect(manager.getCacheSize()).toBe(1);

            await manager.updatePosition('ch-2', 2, 'e2');
            expect(manager.getCacheSize()).toBe(2);

            await manager.clearPosition('ch-1');
            expect(manager.getCacheSize()).toBe(1);

            await manager.clearAll();
            expect(manager.getCacheSize()).toBe(0);
        });

        it('isCached should return correct status', async () => {
            expect(manager.isCached('ch-1')).toBe(false);

            await manager.updatePosition('ch-1', 1, 'e1');
            expect(manager.isCached('ch-1')).toBe(true);

            manager.invalidateCache('ch-1');
            expect(manager.isCached('ch-1')).toBe(false);
        });
    });

    // ── Edge Cases ──

    describe('edge cases', () => {
        it('should handle Unicode characters in epoch', async () => {
            await manager.updatePosition('ch-unicode', 42, 'epoch-日本語-🔥');
            const result = await manager.getPosition('ch-unicode');
            expect(result).toEqual({ offset: 42, epoch: 'epoch-日本語-🔥' });
        });

        it('should handle very long epoch strings', async () => {
            const longEpoch = 'e'.repeat(10000);
            await manager.updatePosition('ch-long', 1, longEpoch);
            const result = await manager.getPosition('ch-long');
            expect(result?.epoch).toBe(longEpoch);
        });

        it('should handle very long channel names', async () => {
            const longChannel = 'ch-'.repeat(1000);
            await manager.updatePosition(longChannel, 1, 'e1');
            const result = await manager.getPosition(longChannel);
            expect(result).toEqual({ offset: 1, epoch: 'e1' });
        });

        it('should handle offset of exactly 1', async () => {
            await manager.updatePosition('ch-one', 1, 'e1');
            const result = await manager.getPosition('ch-one');
            expect(result).toEqual({ offset: 1, epoch: 'e1' });
        });

        it('should preserve offset value across cache invalidation', async () => {
            await manager.updatePosition('ch-1', 12345, 'e1');
            manager.invalidateCache('ch-1');

            const result = await manager.getPosition('ch-1');
            expect(result).toEqual({ offset: 12345, epoch: 'e1' });
        });
    });
});
