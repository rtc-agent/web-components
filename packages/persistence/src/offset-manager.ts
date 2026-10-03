import { getDatabase, type OffsetRecord } from './database.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('OffsetManager');

/**
 * OffsetManager: handles persistence of offset and epoch values.
 *
 * Uses a two-tier caching strategy:
 * 1. In-memory cache for synchronous reads (fast path)
 * 2. IndexedDB for durability (slow path, used on cache miss)
 *
 * This design ensures that after the first read or write,
 * subsequent reads are synchronous, avoiding race conditions
 * in time-sensitive code paths like scheduleUpdate.
 *
 * Write-through strategy: updatePosition updates both cache and IndexedDB.
 * Read-through strategy: getPosition reads from cache first, falls back to IndexedDB.
 */
export class OffsetManager {
  /**
   * In-memory cache for offset/epoch per channel.
   *
   * This cache is populated on:
   * - First getPosition call (cache miss → load from IndexedDB → populate)
   * - Any updatePosition call (write-through)
   *
   * This ensures that after initial load, subsequent reads are synchronous,
   * which is critical for preventing race conditions in event handlers.
   */
  private readonly cache = new Map<string, { offset: number; epoch: string }>();

  /**
   * Get the offset and epoch for a given channel.
   *
   * Returns from in-memory cache if available (synchronous fast path).
   * Falls back to IndexedDB on cache miss, then populates the cache.
   *
   * @param channel Channel identifier
   * @returns Position object with offset and epoch, or undefined if not found
   */
  async getPosition(channel: string): Promise<{ offset: number; epoch: string } | undefined> {
    // Fast path: synchronous cache hit
    const cached = this.cache.get(channel);
    if (cached !== undefined) {
      log.debug('getPosition (cache hit):', channel, 'offset:', cached.offset, 'epoch:', cached.epoch);
      // Return a copy to prevent external mutation of cached data
      return { offset: cached.offset, epoch: cached.epoch };
    }

    // Slow path: cache miss, load from IndexedDB
    const db = getDatabase();
    const record = await db.offsets.get(channel);
    if (!record) {
      log.debug('getPosition (no record):', channel);
      return undefined;
    }

    const position = { offset: record.offset, epoch: record.epoch };

    // Populate cache for future synchronous reads
    this.cache.set(channel, position);

    log.debug('getPosition (loaded from DB):', channel, 'offset:', record.offset, 'epoch:', record.epoch);
    // Return a copy to prevent external mutation
    return { offset: position.offset, epoch: position.epoch };
  }

  /**
   * Update the offset and epoch for a given channel.
   *
   * Uses write-through strategy: both in-memory cache and IndexedDB
   * are updated. The cache is updated synchronously first, ensuring
   * that subsequent getPosition calls return the updated value immediately.
   *
   * If IndexedDB write fails, the cache is rolled back to maintain consistency.
   *
   * @param channel Channel identifier
   * @param offset New offset value
   * @param epoch New epoch value
   */
  async updatePosition(channel: string, offset: number, epoch: string): Promise<void> {
    log.debug('updatePosition:', channel, 'offset:', offset, 'epoch:', epoch);

    // Save previous cache state for potential rollback
    const previousValue = this.cache.get(channel);

    // Write-through: update cache first (synchronous)
    this.cache.set(channel, { offset, epoch });

    // Then persist to IndexedDB (asynchronous)
    const db = getDatabase();
    const record: OffsetRecord = {
      channel,
      offset,
      epoch,
      updatedAt: Date.now(),
    };

    try {
      await db.offsets.put(record);
    } catch (err) {
      // Rollback cache on persistence failure to maintain consistency
      if (previousValue !== undefined) {
        this.cache.set(channel, previousValue);
      } else {
        this.cache.delete(channel);
      }
      throw err;
    }
  }

  /**
   * Clear the offset for a specific channel (used on epoch change).
   *
   * Clears both in-memory cache and IndexedDB.
   * Cache is cleared synchronously first.
   *
   * If IndexedDB write fails, the cache is rolled back to maintain consistency.
   *
   * @param channel Channel identifier
   */
  async clearPosition(channel: string): Promise<void> {
    log.debug('clearPosition:', channel);

    // Save previous cache state for potential rollback
    const previousValue = this.cache.get(channel);

    // Clear cache first (synchronous)
    this.cache.delete(channel);

    // Then clear IndexedDB (asynchronous)
    const db = getDatabase();
    try {
      await db.offsets.delete(channel);
    } catch (err) {
      // Rollback cache on persistence failure to maintain consistency
      if (previousValue !== undefined) {
        this.cache.set(channel, previousValue);
      }
      throw err;
    }
  }

  /**
   * Clear all offset records.
   *
   * Clears both in-memory cache and IndexedDB.
   * Cache is cleared synchronously first.
   *
   * If IndexedDB write fails, the cache is rolled back to maintain consistency.
   */
  async clearAll(): Promise<void> {
    log.info('clearAll: clearing all offset records');

    // Save previous cache state for potential rollback
    const previousCache = new Map(this.cache);

    // Clear cache first (synchronous)
    this.cache.clear();

    // Then clear IndexedDB (asynchronous)
    const db = getDatabase();
    try {
      await db.offsets.clear();
    } catch (err) {
      // Rollback cache on persistence failure to maintain consistency
      this.cache.clear();
      for (const [key, value] of previousCache) {
        this.cache.set(key, value);
      }
      throw err;
    }
  }

  /**
   * Reset all offsets (equivalent to clearAll).
   */
  async reset(): Promise<void> {
    log.info('reset: resetting all offsets');
    await this.clearAll();
  }

  /**
   * Pre-warm the cache for a channel.
   *
   * Explicitly loads the offset from IndexedDB into the cache.
   * Useful for pre-loading before time-sensitive operations
   * to ensure subsequent reads are synchronous.
   *
   * @param channel Channel identifier
   * @returns The loaded position, or undefined if not found
   */
  async warmCache(channel: string): Promise<{ offset: number; epoch: string } | undefined> {
    // This is effectively the same as getPosition, but makes the intent clear
    return this.getPosition(channel);
  }

  /**
   * Check if a channel's offset is cached in memory.
   *
   * Useful for debugging or checking cache state.
   *
   * @param channel Channel identifier
   * @returns True if the channel is in the in-memory cache
   */
  isCached(channel: string): boolean {
    return this.cache.has(channel);
  }

  /**
   * Get the number of channels currently cached in memory.
   *
   * Useful for debugging and monitoring.
   *
   * @returns Number of cached entries
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Invalidate the in-memory cache for a specific channel.
   *
   * Forces the next getPosition call to read from IndexedDB.
   * Useful for testing or when external processes may have modified IndexedDB.
   *
   * @param channel Channel identifier
   */
  invalidateCache(channel: string): void {
    this.cache.delete(channel);
  }

  /**
   * Invalidate the entire in-memory cache.
   *
   * Forces subsequent getPosition calls to read from IndexedDB.
   * Useful for testing or when external processes may have modified IndexedDB.
   */
  invalidateAllCache(): void {
    this.cache.clear();
  }
}

// Singleton
let offsetManagerInstance: OffsetManager | null = null;

export function getOffsetManager(): OffsetManager {
  if (!offsetManagerInstance) {
    offsetManagerInstance = new OffsetManager();
  }
  return offsetManagerInstance;
}
