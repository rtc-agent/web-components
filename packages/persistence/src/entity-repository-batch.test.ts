import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getDatabase, flushAll, closeDatabase, DB_NAME_PREFIX } from './database.js';
import { EntityRepository } from './entity-repository.js';
import type { Update } from '@rtc-agent/protocol';

const TEST_DB = `${DB_NAME_PREFIX}test-batch`;
const TEST_DEVICE_ID = 'test-device-id';

describe('applyUpdates (batch processing)', () => {
  let repo: EntityRepository;

  beforeEach(async () => {
    // Initialize database
    getDatabase(TEST_DB);
    await flushAll();

    // Create fresh repository
    repo = new EntityRepository(TEST_DEVICE_ID);
  });

  it('should produce identical results to applyUpdate for a single session', async () => {
    const update: Update = {
      id: 'u1',
      items: [{ entity: 'session', action: 'created', entity_id: 'srv-s1' }],
      data_list: [{ id: 'srv-s1', client_id: 'c-s1', title: 'Test', status: 'active' }],
      offset: 1,
    };

    // Single path
    await repo.applyUpdate({ ...update, id: 'u1' });
    const singleResult = await repo.getClientSession('c-s1');

    // Reset DB
    await flushAll();
    repo = new EntityRepository(TEST_DEVICE_ID);

    // Batch path
    await repo.applyUpdates([{ ...update, id: 'u2' }]);
    const batchResult = await repo.getClientSession('c-s1');

    // Compare key fields (ignore timestamps which may differ by milliseconds)
    expect(batchResult!.client_id).toBe(singleResult!.client_id);
    expect(batchResult!.server_id).toBe(singleResult!.server_id);
    expect(batchResult!.title).toBe(singleResult!.title);
    expect(batchResult!.status).toBe(singleResult!.status);
    expect(batchResult!.sync_status).toBe(singleResult!.sync_status);
  });

  it('should handle mixed entity types in a single batch', async () => {
    await repo.applyUpdates([{
      id: 'u1',
      items: [
        { entity: 'session', action: 'created', entity_id: 'srv-s1' },
        { entity: 'turn', action: 'created', entity_id: 'srv-t1' },
        { entity: 'message', action: 'created', entity_id: 'srv-m1' },
      ],
      data_list: [
        { id: 'srv-s1', client_id: 'c-s1', status: 'active' },
        { id: 'srv-t1', client_id: 'c-t1', session_id: 'srv-s1', status: 'pending' },
        { id: 'srv-m1', client_id: 'c-m1', session_id: 'srv-s1', role: 'assistant' },
      ],
      offset: 1,
    }]);

    expect(await repo.getClientSession('c-s1')).toBeDefined();
    expect(await repo.getClientTurn('c-t1')).toBeDefined();
    expect(await repo.getClientMessage('c-m1')).toBeDefined();

    // Session should have pending_turn_count=1
    const s = await repo.getClientSession('c-s1');
    expect(s!.pending_turn_count).toBe(1);
  });

  it('should handle delete without data_list (hard delete)', async () => {
    // Setup: insert a session
    await repo.applyUpdates([{
      id: 'u1',
      items: [{ entity: 'session', action: 'created', entity_id: 'srv-s1' }],
      data_list: [{ id: 'srv-s1', client_id: 'c-s1', status: 'active' }],
      offset: 1,
    }]);
    expect(await repo.getClientSession('c-s1')).toBeDefined();

    // Delete by entity_id (server_id) without data_list
    await repo.applyUpdates([{
      id: 'u2',
      items: [{ entity: 'session', action: 'deleted', entity_id: 'srv-s1' }],
      data_list: [undefined],
      offset: 2,
    }]);

    expect(await repo.getClientSession('c-s1')).toBeUndefined();
  });

  it('should resolve parent_message_id within the same batch', async () => {
    await repo.applyUpdates([{
      id: 'u1',
      items: [
        { entity: 'session', action: 'created', entity_id: 'srv-s1' },
        { entity: 'message', action: 'created', entity_id: 'srv-parent' },
        { entity: 'message', action: 'created', entity_id: 'srv-child' },
      ],
      data_list: [
        { id: 'srv-s1', client_id: 'c-s1', status: 'active' },
        { id: 'srv-parent', client_id: 'c-parent', session_id: 'srv-s1', role: 'user' },
        { id: 'srv-child', client_id: 'c-child', session_id: 'srv-s1',
          parent_message_id: 'srv-parent', role: 'assistant' },
      ],
      offset: 1,
    }]);

    const child = await repo.getClientMessage('c-child');
    expect(child).toBeDefined();
    expect(child!.parent_client_id).toBe('c-parent');
  });

  it('should return early for empty input', async () => {
    await repo.applyUpdates([]);
    await repo.applyUpdates([{ id: 'u1', items: [], data_list: [], offset: 1 }]);
    // No error, no side effects
  });

  it('should set RTC sync_status to pending', async () => {
    await repo.applyUpdates([{
      id: 'u1',
      items: [
        { entity: 'session', action: 'created', entity_id: 'srv-s1' },
        { entity: 'rtc', action: 'created', entity_id: 'srv-r1' },
      ],
      data_list: [
        { id: 'srv-s1', client_id: 'c-s1', status: 'active' },
        { id: 'srv-r1', client_id: 'c-r1', session_id: 'srv-s1', status: 'pending' },
      ],
      offset: 1,
    }]);

    const rtc = await repo.getClientRtc('c-r1');
    expect(rtc).toBeDefined();
    expect(rtc!.sync_status).toBe('pending');
  });

  it('should deduplicate same client_id within a batch (last wins)', async () => {
    await repo.applyUpdates([{
      id: 'u1',
      items: [
        { entity: 'session', action: 'created', entity_id: 's1' },
        { entity: 'session', action: 'updated', entity_id: 's1' },
      ],
      data_list: [
        { id: 's1', client_id: 'c-s1', title: 'First', status: 'active' },
        { id: 's1', client_id: 'c-s1', title: 'Second', status: 'active' },
      ],
      offset: 1,
    }]);

    const session = await repo.getClientSession('c-s1');
    expect(session!.title).toBe('Second'); // Last occurrence wins
  });
});
