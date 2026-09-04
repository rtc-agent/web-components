import { getDatabase, type OffsetRecord } from './database.js';

/**
 * Offset 管理器：负责 offset 和 epoch 的持久化
 */
export class OffsetManager {
  /**
   * 获取指定频道的 offset 和 epoch
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
   * 更新指定频道的 offset 和 epoch
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
   * 清空指定频道的 offset（用于 epoch 变更时）
   */
  async clearPosition(channel: string): Promise<void> {
    const db = getDatabase();
    await db.offsets.delete(channel);
  }

  /**
   * 清空所有 offset 记录
   */
  async clearAll(): Promise<void> {
    const db = getDatabase();
    await db.offsets.clear();
  }

  /**
   * 重置所有 offset（等同于 clearAll）
   */
  async reset(): Promise<void> {
    await this.clearAll();
  }
}

// 单例
let offsetManagerInstance: OffsetManager | null = null;

export function getOffsetManager(): OffsetManager {
  if (!offsetManagerInstance) {
    offsetManagerInstance = new OffsetManager();
  }
  return offsetManagerInstance;
}
