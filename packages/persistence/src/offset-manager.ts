import { getDatabase, type OffsetRecord } from './database.js';

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
      return undefined;
    }
    return { offset: record.offset, epoch: record.epoch };
  }

  /**
   * Update the offset and epoch for a given channel.
   */
  async updatePosition(channel: string, offset: number, epoch: string): Promise<void> {
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
    const db = getDatabase();
    await db.offsets.delete(channel);
  }

  /**
   * Clear all offset records.
   */
  async clearAll(): Promise<void> {
    const db = getDatabase();
    await db.offsets.clear();
  }

  /**
   * Reset all offsets (equivalent to clearAll).
   */
  async reset(): Promise<void> {
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
