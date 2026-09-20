import { getDatabase, type OffsetRecord } from './database.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('OffsetManager');

/**
 * OffsetManager: handles persistence of offset and epoch values.
 */
export class OffsetManager {
  /**
   * Get the offset and epoch for a given channel.
   */
  async getPosition(channel: string): Promise<{ offset: number; epoch: string } | undefined> {
    const db = getDatabase();
    const record = await db.offsets.get(channel);
    if (!record) {
      log.debug('getPosition: no record for channel:', channel);
      return undefined;
    }
    log.debug('getPosition:', channel, 'offset:', record.offset, 'epoch:', record.epoch);
    return { offset: record.offset, epoch: record.epoch };
  }

  /**
   * Update the offset and epoch for a given channel.
   */
  async updatePosition(channel: string, offset: number, epoch: string): Promise<void> {
    log.debug('updatePosition:', channel, 'offset:', offset, 'epoch:', epoch);
    const db = getDatabase();
    const record: OffsetRecord = {
      channel,
      offset,
      epoch,
      updatedAt: Date.now(),
    };
    await db.offsets.put(record);
  }

  /**
   * Clear the offset for a specific channel (used on epoch change).
   */
  async clearPosition(channel: string): Promise<void> {
    log.debug('clearPosition:', channel);
    const db = getDatabase();
    await db.offsets.delete(channel);
  }

  /**
   * Clear all offset records.
   */
  async clearAll(): Promise<void> {
    log.info('clearAll: clearing all offset records');
    const db = getDatabase();
    await db.offsets.clear();
  }

  /**
   * Reset all offsets (equivalent to clearAll).
   */
  async reset(): Promise<void> {
    log.info('reset: resetting all offsets');
    await this.clearAll();
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
