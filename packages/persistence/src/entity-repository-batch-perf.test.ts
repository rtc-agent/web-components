import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getDatabase, flushAll, DB_NAME_PREFIX } from './database.js';
import { EntityRepository } from './entity-repository.js';
import type { Update } from '@rtc-agent/protocol';

const TEST_DB = `${DB_NAME_PREFIX}test-batch-perf`;
const TEST_DEVICE_ID = 'test-device-perf';

describe('applyUpdates performance benchmark', () => {
  let repo: EntityRepository;

  beforeEach(async () => {
    getDatabase(TEST_DB);
    await flushAll();
    repo = new EntityRepository(TEST_DEVICE_ID);
  });

  function generateUpdates(sessionCount: number, turnsPerSession: number, messagesPerTurn: number): Update[] {
    const updates: Update[] = [];
    let offset = 1;

    for (let i = 0; i < sessionCount; i++) {
      const sessionId = `srv-s-${i}`;
      const sessionClientId = `c-s-${i}`;

      // Session update
      updates.push({
        id: `u-${offset}`,
        items: [{ entity: 'session', action: 'created', entity_id: sessionId }],
        data_list: [{ id: sessionId, client_id: sessionClientId, status: 'active', title: `Session ${i}` }],
        offset: offset++,
      });

      // Turn updates
      for (let j = 0; j < turnsPerSession; j++) {
        const turnId = `srv-t-${i}-${j}`;
        const turnClientId = `c-t-${i}-${j}`;

        updates.push({
          id: `u-${offset}`,
          items: [{ entity: 'turn', action: 'created', entity_id: turnId }],
          data_list: [{
            id: turnId,
            client_id: turnClientId,
            session_id: sessionId,
            status: j % 2 === 0 ? 'pending' : 'running',
          }],
          offset: offset++,
        });

        // Message updates
        for (let k = 0; k < messagesPerTurn; k++) {
          const msgId = `srv-m-${i}-${j}-${k}`;
          const msgClientId = `c-m-${i}-${j}-${k}`;

          updates.push({
            id: `u-${offset}`,
            items: [{ entity: 'message', action: 'created', entity_id: msgId }],
            data_list: [{
              id: msgId,
              client_id: msgClientId,
              session_id: sessionId,
              role: k % 2 === 0 ? 'user' : 'assistant',
              content: `Message ${k}`,
            }],
            offset: offset++,
          });
        }
      }
    }

    return updates;
  }

  it('benchmark: 10 sessions, 2 turns each, 2 messages each', async () => {
    const updates = generateUpdates(10, 2, 2);
    const totalItems = updates.reduce((sum, u) => sum + u.items.length, 0);

    const start = performance.now();
    await repo.applyUpdates(updates);
    const elapsed = performance.now() - start;

    console.log(`\n[Benchmark] 10 sessions × 2 turns × 2 messages:`);
    console.log(`  Total items: ${totalItems}`);
    console.log(`  Time: ${elapsed.toFixed(2)}ms`);
    console.log(`  Per-item: ${(elapsed / totalItems).toFixed(3)}ms`);

    expect(elapsed).toBeLessThan(100); // Should be well under 100ms
  });

  it('benchmark: 50 sessions, 5 turns each, 5 messages each', async () => {
    const updates = generateUpdates(50, 5, 5);
    const totalItems = updates.reduce((sum, u) => sum + u.items.length, 0);

    const start = performance.now();
    await repo.applyUpdates(updates);
    const elapsed = performance.now() - start;

    console.log(`\n[Benchmark] 50 sessions × 5 turns × 5 messages:`);
    console.log(`  Total items: ${totalItems}`);
    console.log(`  Time: ${elapsed.toFixed(2)}ms`);
    console.log(`  Per-item: ${(elapsed / totalItems).toFixed(3)}ms`);

    expect(elapsed).toBeLessThan(500); // Should be well under 500ms
  });

  it('benchmark: compare single vs batch for 100 items', async () => {
    const updates = generateUpdates(10, 3, 3);
    const totalItems = updates.reduce((sum, u) => sum + u.items.length, 0);

    // Batch path
    await flushAll();
    repo = new EntityRepository(TEST_DEVICE_ID);
    const batchStart = performance.now();
    await repo.applyUpdates(updates);
    const batchTime = performance.now() - batchStart;

    // Single path (applyUpdate for each)
    await flushAll();
    repo = new EntityRepository(TEST_DEVICE_ID);
    const singleStart = performance.now();
    for (const update of updates) {
      await repo.applyUpdate(update);
    }
    const singleTime = performance.now() - singleStart;

    const speedup = singleTime / batchTime;

    console.log(`\n[Benchmark] Comparison for ${totalItems} items:`);
    console.log(`  Single (applyUpdate): ${singleTime.toFixed(2)}ms`);
    console.log(`  Batch (applyUpdates): ${batchTime.toFixed(2)}ms`);
    console.log(`  Speedup: ${speedup.toFixed(2)}x`);

    // Batch should be at least 2x faster for this size
    expect(batchTime).toBeLessThan(singleTime);
  });
});
