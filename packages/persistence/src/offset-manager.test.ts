import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    });

    describe('reset', () => {
        it('should behave identically to clearAll', async () => {
            await manager.updatePosition('ch-1', 1, 'e1');
            await manager.reset();
            expect(await manager.getPosition('ch-1')).toBeUndefined();
        });
    });
});
