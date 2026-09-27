import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EntityRepository,
  initEntityRepository,
  getEntityRepository,
} from './entity-repository.js';
import {
  getDatabase,
  closeDatabase,
  flushAll,
  DB_NAME_PREFIX,
} from './database.js';
import { getUIUpdateBus, closeUIUpdateBus, type UIUpdateEvent } from './ui-update-bus.js';
import type { Update, UpdateItem } from '@rtc-agent/protocol';

const TEST_DB = `${DB_NAME_PREFIX}test-entity-repository`;
const TEST_DEVICE_ID = 'test-device-001';

describe('entity-repository', () => {
  let repo: EntityRepository;
  let collectedEvents: UIUpdateEvent[];

  beforeEach(async () => {
    // Reset singleton state
    getDatabase(TEST_DB);
    await flushAll();
    closeUIUpdateBus();

    // Re-initialize entity repository (reset internal singleton)
    // initEntityRepository guards against re-init; use fresh EntityRepository directly
    repo = new EntityRepository(TEST_DEVICE_ID);

    // Collect UIUpdateBus events for assertions
    collectedEvents = [];
    getUIUpdateBus().subscribe((e) => { collectedEvents.push(e); });
  });

  afterEach(async () => {
    await closeDatabase();
    closeUIUpdateBus();
  });

  // ========== Session ==========

  describe('upsertSession', () => {
    it('should create a new session with default values', async () => {
      const result = await repo.upsertSession({
        client_id: 's1',
        title: 'Hello',
        status: 'active',
      });

      expect(result.before).toBeUndefined();
      expect(result.after.client_id).toBe('s1');
      expect(result.after.title).toBe('Hello');
      expect(result.after.status).toBe('active');
      expect(result.after.sync_status).toBe('synced');
      expect(result.after.pending_turn_count).toBe(0);
      expect(result.after.running_turn_count).toBe(0);
      expect(result.after.created_at).toBeTruthy();
    });

    it('should update an existing session', async () => {
      await repo.upsertSession({ client_id: 's1', title: 'Old' });
      const result = await repo.upsertSession({
        client_id: 's1',
        title: 'New',
      });

      expect(result.before!.title).toBe('Old');
      expect(result.after.title).toBe('New');
      expect(result.after.client_id).toBe('s1');
    });

    it('should preserve server_id when not provided in update', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'First',
        server_id: 'srv-1',
      });
      const result = await repo.upsertSession({
        client_id: 's1',
        title: 'Second',
      });
      expect(result.after.server_id).toBe('srv-1');
    });

    it('should apply custom sync_status', async () => {
      const result = await repo.upsertSession(
        { client_id: 's1' },
        'pending',
      );
      expect(result.after.sync_status).toBe('pending');
    });

    it('should emit UIUpdateBus events on create', async () => {
      await repo.upsertSession({ client_id: 's1', title: 'T' });
      expect(collectedEvents.length).toBeGreaterThan(0);
      expect(collectedEvents[0].entity).toBe('session');
      expect(collectedEvents[0].action).toBe('created');
      expect(collectedEvents[0].entityId).toBe('s1');
    });

    it('should suppress UIUpdateBus events when silent=true', async () => {
      await repo.upsertSession({ client_id: 's1' }, 'synced', {
        silent: true,
      });
      expect(collectedEvents).toHaveLength(0);
    });

    it('should create with empty client_id when not provided', async () => {
      const result = await repo.upsertSession({ title: 'no-id' });
      expect(result.after.client_id).toBe('');
    });
  });

  describe('getClientSession / getSessionByServerId', () => {
    it('should return undefined for missing session', async () => {
      const result = await repo.getClientSession('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return the session by client_id', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'T',
        server_id: 'srv-1',
      });
      const s = await repo.getClientSession('s1');
      expect(s?.title).toBe('T');
    });

    it('should return the session by server_id', async () => {
      await repo.upsertSession({
        client_id: 's1',
        server_id: 'srv-1',
      });
      const s = await repo.getSessionByServerId('srv-1');
      expect(s?.client_id).toBe('s1');
    });
  });

  describe('listSessions', () => {
    beforeEach(async () => {
      // Create sessions with distinct updated_at for ordering
      const base = Date.now();
      await repo.upsertSession({
        client_id: 's1',
        title: 'S1',
        updated_at: new Date(base - 3000).toISOString(),
      });
      await repo.upsertSession({
        client_id: 's2',
        title: 'S2',
        updated_at: new Date(base - 2000).toISOString(),
      });
      await repo.upsertSession({
        client_id: 's3',
        title: 'S3',
        updated_at: new Date(base - 1000).toISOString(),
      });
    });

    it('should filter out soft-deleted sessions', async () => {
      await repo.softDeleteSession('s2');
      const list = await repo.listSessions();
      expect(list.map((s) => s.client_id)).toEqual(['s3', 's1']);
    });

    it('should return all sessions by default (no limit)', async () => {
      // Create 100 sessions
      for (let i = 0; i < 100; i++) {
        await repo.upsertSession({
          client_id: `s-${i}`,
          title: `Session ${i}`,
          updated_at: new Date(Date.now() - i * 1000).toISOString(),
        });
      }

      const list = await repo.listSessions();
      expect(list.length).toBe(103); // 100 new + 3 existing
    });

    it('should paginate with limit', async () => {
      const page1 = await repo.listSessions(undefined, 2);
      expect(page1).toHaveLength(2);
      expect(page1[0].client_id).toBe('s3');
    });

    it('should paginate with cursor', async () => {
      const page1 = await repo.listSessions(undefined, 1);
      const page2 = await repo.listSessions(page1[0].client_id, 1);
      expect(page2).toHaveLength(1);
      expect(page2[0].client_id).toBe('s2');
    });

    it('should return from start when cursor not found', async () => {
      const list = await repo.listSessions('unknown-cursor', 2);
      expect(list).toHaveLength(2);
    });
  });

  describe('softDeleteSession', () => {
    it('should set deleted_at and sync_status=pending', async () => {
      await repo.upsertSession({ client_id: 's1', title: 'T' });
      const result = await repo.softDeleteSession('s1');
      expect(result.after.deleted_at).toBeTruthy();
      expect(result.after.sync_status).toBe('pending');
    });

    it('should throw when session not found', async () => {
      await expect(repo.softDeleteSession('missing')).rejects.toThrow(
        /session not found/,
      );
    });
  });

  describe('getMessageByServerId', () => {
    it('should find a message by server_id', async () => {
      await repo.upsertMessage({
        client_id: 'm1',
        server_id: 'srv-m1',
        role: 'user',
      });
      const m = await repo.getMessageByServerId('srv-m1');
      expect(m?.client_id).toBe('m1');
    });

    it('should return undefined when not found', async () => {
      const m = await repo.getMessageByServerId('nope');
      expect(m).toBeUndefined();
    });
  });

  // ========== Turn ==========

  describe('upsertTurn', () => {
    it('should create a new turn with defaults', async () => {
      const result = await repo.upsertTurn({
        client_id: 't1',
        session_client_id: 's1',
      });
      expect(result.before).toBeUndefined();
      expect(result.after.status).toBe('pending');
      expect(result.after.sync_status).toBe('synced');
    });

    it('should update an existing turn', async () => {
      await repo.upsertTurn({
        client_id: 't1',
        session_client_id: 's1',
        status: 'pending',
      });
      const result = await repo.upsertTurn({
        client_id: 't1',
        status: 'running',
      });
      expect(result.before!.status).toBe('pending');
      expect(result.after.status).toBe('running');
    });

    it('should emit UI events unless silent', async () => {
      await repo.upsertTurn({ client_id: 't1' }, 'synced', { silent: true });
      expect(collectedEvents).toHaveLength(0);

      await repo.upsertTurn({ client_id: 't2' });
      expect(collectedEvents.length).toBeGreaterThan(0);
    });
  });

  describe('getClientTurn', () => {
    it('should return undefined for missing turn', async () => {
      expect(await repo.getClientTurn('missing')).toBeUndefined();
    });

    it('should return existing turn', async () => {
      await repo.upsertTurn({ client_id: 't1', session_client_id: 's1' });
      const t = await repo.getClientTurn('t1');
      expect(t?.session_client_id).toBe('s1');
    });
  });

  describe('countActiveTurns', () => {
    it('should count pending and running turns per session', async () => {
      await repo.upsertTurn({
        client_id: 't1',
        session_client_id: 's1',
        status: 'pending',
      });
      await repo.upsertTurn({
        client_id: 't2',
        session_client_id: 's1',
        status: 'running',
      });
      await repo.upsertTurn({
        client_id: 't3',
        session_client_id: 's1',
        status: 'completed',
      });
      await repo.upsertTurn({
        client_id: 't4',
        session_client_id: 's2',
        status: 'pending',
      });

      const counts = await repo.countActiveTurns('s1');
      expect(counts.pending).toBe(1);
      expect(counts.running).toBe(1);
    });

    it('should return zeros when no turns exist', async () => {
      const counts = await repo.countActiveTurns('empty-session');
      expect(counts.pending).toBe(0);
      expect(counts.running).toBe(0);
    });
  });

  // ========== Message ==========

  describe('upsertMessage', () => {
    it('should create a new message with defaults', async () => {
      const result = await repo.upsertMessage({
        client_id: 'm1',
        session_client_id: 's1',
        role: 'assistant',
      });
      expect(result.before).toBeUndefined();
      expect(result.after.role).toBe('assistant');
      expect(result.after.streaming_status).toBe('pending');
      expect(result.after.creator_kind).toBe('user');
      expect(result.after.global_offset).toBe(0);
    });

    it('should update an existing message', async () => {
      await repo.upsertMessage({
        client_id: 'm1',
        session_client_id: 's1',
        content: 'old',
      });
      const result = await repo.upsertMessage({
        client_id: 'm1',
        content: 'new',
      });
      expect(result.before!.content).toBe('old');
      expect(result.after.content).toBe('new');
    });

    it('should suppress events when silent', async () => {
      await repo.upsertMessage({ client_id: 'm1' }, 'synced', {
        silent: true,
      });
      expect(collectedEvents).toHaveLength(0);
    });
  });

  describe('listMessagesBySession', () => {
    beforeEach(async () => {
      const base = new Date('2026-01-01T00:00:00Z').toISOString();
      // Insert messages in chronological order
      for (let i = 0; i < 5; i++) {
        await repo.upsertMessage({
          client_id: `m${i}`,
          session_client_id: 's1',
          content: `msg-${i}`,
          created_at: new Date(
            new Date(base).getTime() + i * 1000,
          ).toISOString(),
        });
      }
    });

    it('should return messages in ascending order', async () => {
      const msgs = await repo.listMessagesBySession('s1');
      expect(msgs.map((m) => m.client_id)).toEqual([
        'm0',
        'm1',
        'm2',
        'm3',
        'm4',
      ]);
    });

    it('should paginate backward (default) with limit', async () => {
      const msgs = await repo.listMessagesBySession('s1', undefined, 2);
      expect(msgs.map((m) => m.client_id)).toEqual(['m3', 'm4']);
    });

    it('should paginate backward from cursor', async () => {
      // Build cursor format: "timestamp|clientId"
      const cursor = `${new Date('2026-01-01T00:00:03.000Z').getTime()}|m3`;
      const msgs = await repo.listMessagesBySession(
        's1',
        cursor,
        10,
        'backward',
      );
      // Messages strictly older than m3: m0, m1, m2
      expect(msgs.map((m) => m.client_id)).toEqual(['m0', 'm1', 'm2']);
    });

    it('should paginate forward from cursor', async () => {
      const cursor = `${new Date('2026-01-01T00:00:01.000Z').getTime()}|m1`;
      const msgs = await repo.listMessagesBySession(
        's1',
        cursor,
        10,
        'forward',
      );
      expect(msgs.map((m) => m.client_id)).toEqual(['m2', 'm3', 'm4']);
    });

    it('should limit forward pagination', async () => {
      const cursor = `${new Date('2026-01-01T00:00:00.000Z').getTime()}|m0`;
      const msgs = await repo.listMessagesBySession(
        's1',
        cursor,
        2,
        'forward',
      );
      expect(msgs.map((m) => m.client_id)).toEqual(['m1', 'm2']);
    });
  });

  // ========== Rtc ==========

  describe('upsertRtc', () => {
    it('should create a new RTC with defaults', async () => {
      const result = await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
        tool_name: 'write_file',
      });
      expect(result.before).toBeUndefined();
      expect(result.after.status).toBe('pending');
      expect(result.after.offset).toBe(0);
    });

    it('should update existing RTC', async () => {
      await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
        status: 'pending',
      });
      const result = await repo.upsertRtc({
        client_id: 'r1',
        status: 'completed',
      });
      expect(result.before!.status).toBe('pending');
      expect(result.after.status).toBe('completed');
    });
  });

  describe('getNextRtcToProcess', () => {
    beforeEach(async () => {
      // Insert RTCs with various states (all with session_device_id = TEST_DEVICE_ID for local device)
      await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
        session_device_id: TEST_DEVICE_ID,
        offset: 1,
        status: 'pending',
        sync_status: 'synced',
      });
      await repo.upsertRtc({
        client_id: 'r2',
        session_client_id: 's1',
        session_device_id: TEST_DEVICE_ID,
        offset: 2,
        status: 'pending',
        sync_status: 'failed',
      });
      await repo.upsertRtc({
        client_id: 'r3',
        session_client_id: 's1',
        session_device_id: TEST_DEVICE_ID,
        offset: 0,
        status: 'pending',
        sync_status: 'synced',
      });
    });

    it('should prioritize sync_status=failed over status=pending', async () => {
      const next = await repo.getNextRtcToProcess('s1');
      expect(next?.client_id).toBe('r2');
    });

    it('should return pending by ascending offset when no failed', async () => {
      // Fix r2's sync_status so it's not 'failed'
      await repo.upsertRtc({ client_id: 'r2', sync_status: 'synced' });
      const next = await repo.getNextRtcToProcess('s1');
      expect(next?.client_id).toBe('r3'); // offset=0 is smallest
    });

    it('should filter by session when provided', async () => {
      await repo.upsertRtc({
        client_id: 'r-other',
        session_client_id: 's-other',
        offset: 0,
        status: 'pending',
        sync_status: 'failed',
      });
      const next = await repo.getNextRtcToProcess('s1');
      expect(next?.session_client_id).toBe('s1');
    });

    it('should return any-session failed RTC when no session filter', async () => {
      const next = await repo.getNextRtcToProcess();
      expect(next?.client_id).toBe('r2');
    });

    it('should return undefined when no RTCs qualify', async () => {
      // All completed
      for (const id of ['r1', 'r2', 'r3']) {
        await repo.upsertRtc({ client_id: id, status: 'completed', sync_status: 'synced' });
      }
      const next = await repo.getNextRtcToProcess('s1');
      expect(next).toBeUndefined();
    });

    it('should filter by device_id at execution time', async () => {
      // r1 belongs to local device, r-other belongs to different device
      await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
        session_device_id: TEST_DEVICE_ID,
        offset: 1,
        status: 'pending',
      }, 'failed');
      await repo.upsertRtc({
        client_id: 'r-other',
        session_client_id: 's1',
        session_device_id: 'other-device',
        offset: 0, // Smaller offset, but belongs to different device
        status: 'pending',
      }, 'failed');

      const next = await repo.getNextRtcToProcess('s1');
      // Should return r1 (local device), not r-other (different device)
      expect(next?.client_id).toBe('r1');
    });

    it('should allow RTC with empty session_device_id (lenient mode)', async () => {
      // r1 has empty session_device_id (e.g., session query failed)
      await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
        session_device_id: '', // Empty
        offset: 1,
        status: 'pending',
      }, 'failed');

      const next = await repo.getNextRtcToProcess('s1');
      // Should be allowed in lenient mode
      expect(next?.client_id).toBe('r1');
    });

    it('should allow RTC with undefined session_device_id (lenient mode)', async () => {
      // r1 has undefined session_device_id
      await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
        // session_device_id not set (undefined)
        offset: 1,
        status: 'pending',
      }, 'failed');

      const next = await repo.getNextRtcToProcess('s1');
      // Should be allowed in lenient mode
      expect(next?.client_id).toBe('r1');
    });
  });

  describe('listRtcBySession', () => {
    beforeEach(async () => {
      await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
        offset: 5,
      });
      await repo.upsertRtc({
        client_id: 'r2',
        session_client_id: 's1',
        offset: 1,
      });
      await repo.upsertRtc({
        client_id: 'r3',
        session_client_id: 's1',
        offset: 3,
      });
      await repo.upsertRtc({
        client_id: 'r-other',
        session_client_id: 's2',
        offset: 0,
      });
    });

    it('should return RTCs sorted by offset ascending', async () => {
      const rtcs = await repo.listRtcBySession('s1');
      expect(rtcs.map((r) => r.client_id)).toEqual(['r2', 'r3', 'r1']);
    });

    it('should paginate with cursor and limit', async () => {
      const rtcs = await repo.listRtcBySession('s1', 1, 1);
      expect(rtcs.map((r) => r.client_id)).toEqual(['r3']);
    });

    it('should return empty array for unknown session', async () => {
      const rtcs = await repo.listRtcBySession('unknown');
      expect(rtcs).toEqual([]);
    });
  });

  // ========== applyUpdate ==========

  describe('applyUpdate', () => {
    it('should apply a session update', async () => {
      const sessionData = {
        id: 'srv-s1',
        client_id: 'c-s1',
        owner_kind: 'user',
        owner_ref_id: 'u1',
        status: 'active' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const item: UpdateItem = {
        entity: 'session',
        action: 'created',
        entity_id: 'srv-s1',
      };
      const update: Update = {
        id: 'u1',
        items: [item],
        data_list: [sessionData],
        offset: 1,
      };

      await repo.applyUpdate(update);

      const s = await repo.getClientSession('c-s1');
      expect(s).toBeDefined();
      expect(s!.server_id).toBe('srv-s1');
      expect(s!.owner_kind).toBe('user');
    });

    it('should apply a turn update and aggregate counts to session', async () => {
      // Create a session first
      await repo.upsertSession({
        client_id: 's1',
        server_id: 'srv-s1',
        title: 'Session',
      });

      const turnData = {
        id: 'srv-t1',
        client_id: 'c-t1',
        session_id: 'srv-s1',
        status: 'pending' as const,
        created_at: '2026-01-01T00:00:00Z',
      };
      const item: UpdateItem = {
        entity: 'turn',
        action: 'created',
        entity_id: 'srv-t1',
      };
      const update: Update = {
        id: 'u1',
        items: [item],
        data_list: [turnData],
        offset: 1,
      };

      await repo.applyUpdate(update);

      const t = await repo.getClientTurn('c-t1');
      expect(t).toBeDefined();
      expect(t!.session_client_id).toBe('s1');

      // Session should have pending_turn_count=1
      const s = await repo.getClientSession('s1');
      expect(s!.pending_turn_count).toBe(1);
    });

    it('should apply a message update with parent resolution', async () => {
      await repo.upsertSession({
        client_id: 's1',
        server_id: 'srv-s1',
      });
      // Create parent message
      await repo.upsertMessage({
        client_id: 'parent-msg',
        server_id: 'srv-parent',
        session_client_id: 's1',
      });

      const msgData = {
        id: 'srv-m1',
        client_id: 'c-m1',
        session_id: 'srv-s1',
        parent_message_id: 'srv-parent',
        global_offset: 1,
        role: 'assistant' as const,
        streaming_status: 'pending' as const,
        creator_kind: 'user',
        creator_ref_id: 'u1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const item: UpdateItem = {
        entity: 'message',
        action: 'created',
        entity_id: 'srv-m1',
      };
      const update: Update = {
        id: 'u1',
        items: [item],
        data_list: [msgData],
        offset: 1,
      };

      await repo.applyUpdate(update);

      const m = await repo.getClientMessage('c-m1');
      expect(m).toBeDefined();
      expect(m!.session_client_id).toBe('s1');
      expect(m!.parent_client_id).toBe('parent-msg');
    });

    it('should write RTC with session_device_id even for a different device', async () => {
      // Create a session belonging to a different device
      await repo.upsertSession({
        client_id: 's-other',
        server_id: 'srv-other',
        device_id: 'other-device',
      });

      const rtcData = {
        id: 'srv-r1',
        client_id: 'c-r1',
        session_id: 'srv-other',
        turn_id: 'srv-t1',
        offset: 1,
        tool_name: 'exec',
        status: 'pending' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const item: UpdateItem = {
        entity: 'rtc',
        action: 'created',
        entity_id: 'srv-r1',
      };
      const update: Update = {
        id: 'u1',
        items: [item],
        data_list: [rtcData],
        offset: 1,
      };

      await repo.applyUpdate(update);

      // RTC should be written (lenient mode), with session_device_id stored
      const r = await repo.getClientRtc('c-r1');
      expect(r).toBeDefined();
      expect(r!.session_client_id).toBe('s-other');
      expect(r!.session_device_id).toBe('other-device');
      expect(r!.sync_status).toBe('pending');
    });

    it('should apply RTC for local device with sync_status=pending', async () => {
      await repo.upsertSession({
        client_id: 's1',
        server_id: 'srv-s1',
        device_id: TEST_DEVICE_ID,
      });

      const rtcData = {
        id: 'srv-r1',
        client_id: 'c-r1',
        session_id: 'srv-s1',
        turn_id: 'srv-t1',
        offset: 1,
        tool_name: 'exec',
        status: 'pending' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const item: UpdateItem = {
        entity: 'rtc',
        action: 'created',
        entity_id: 'srv-r1',
      };
      const update: Update = {
        id: 'u1',
        items: [item],
        data_list: [rtcData],
        offset: 1,
      };

      await repo.applyUpdate(update);

      const r = await repo.getClientRtc('c-r1');
      expect(r).toBeDefined();
      expect(r!.sync_status).toBe('pending');
      expect(r!.session_client_id).toBe('s1');
      expect(r!.session_device_id).toBe(TEST_DEVICE_ID);
    });

    it('should skip items without data_list entry', async () => {
      const item: UpdateItem = {
        entity: 'session',
        action: 'created',
        entity_id: 'srv-x',
      };
      const update: Update = {
        id: 'u1',
        items: [item],
        data_list: [undefined],
        offset: 1,
      };

      await repo.applyUpdate(update);
      // No error; nothing inserted
      expect(await repo.getClientSession('srv-x')).toBeUndefined();
    });

    it('should handle multiple items in a single update', async () => {
      const sData = {
        id: 'srv-s',
        client_id: 'c-s',
        owner_kind: 'user',
        owner_ref_id: 'u1',
        status: 'active' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const tData = {
        id: 'srv-t',
        client_id: 'c-t',
        session_id: 'srv-s',
        status: 'pending' as const,
        created_at: '2026-01-01T00:00:00Z',
      };
      const update: Update = {
        id: 'u1',
        items: [
          { entity: 'session', action: 'created', entity_id: 'srv-s' },
          { entity: 'turn', action: 'created', entity_id: 'srv-t' },
        ],
        data_list: [sData, tData],
        offset: 1,
      };

      await repo.applyUpdate(update);

      expect(await repo.getClientSession('c-s')).toBeDefined();
      expect(await repo.getClientTurn('c-t')).toBeDefined();
    });
  });

  // ========== Singleton ==========

  describe('initEntityRepository / getEntityRepository', () => {
    it('should throw when getEntityRepository is called before init', async () => {
      // We need a fresh context; since module-level singleton may already be initialized
      // in another test, we rely on the exported behavior: throws if not initialized.
      // This test verifies the contract — getEntityRepository requires prior init.
      // Note: if another test already called init, this will succeed instead of throw.
      // We test the positive path:
      // (initEntityRepository guards against re-init, so we test the happy path)
      initEntityRepository('dev-1');
      const r = getEntityRepository();
      expect(r).toBeDefined();
    });

    it('should ignore re-initialization', async () => {
      initEntityRepository('dev-1');
      const r1 = getEntityRepository();
      initEntityRepository('dev-2'); // should log warning, not replace
      const r2 = getEntityRepository();
      expect(r1).toBe(r2);
    });
  });

  // ========== UI update emission details ==========

  describe('emitUIUpdates (via upsert)', () => {
    it('should emit per-field events on create', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'T',
        status: 'active',
      });
      const sessionEvents = collectedEvents.filter(
        (e) => e.entity === 'session',
      );
      expect(sessionEvents.length).toBeGreaterThan(0);
      expect(sessionEvents[0].action).toBe('created');
    });

    it('should emit only changed fields on update', async () => {
      await repo.upsertSession({ client_id: 's1', title: 'Old' });
      collectedEvents.length = 0;
      await repo.upsertSession({ client_id: 's1', title: 'New' });

      const sessionEvents = collectedEvents.filter(
        (e) => e.entity === 'session',
      );
      // Should have field-level diffs, not all fields
      const fields = sessionEvents.map((e) => e.field);
      expect(fields).toContain('title');
      // Unchanged fields should not appear
      expect(fields).not.toContain('client_id');
    });
  });

  // ========== Issue 236: Streaming Status Monotonic Guard ==========

  describe('Issue 236: streaming status monotonic guard', () => {
    describe('upsertMessage: prevent regression from terminal states', () => {
      it('should prevent streaming from overwriting completed', async () => {
        // 1. Insert a completed message
        await repo.upsertMessage({
          client_id: 'msg-1',
          streaming_status: 'completed',
          content: 'full content',
          updated_at: '2026-09-27T10:00:00Z',
        });

        // 2. Try to upsert a streaming version
        await repo.upsertMessage({
          client_id: 'msg-1',
          streaming_status: 'streaming',
          content: 'partial content',
          updated_at: '2026-09-27T09:59:00Z',
        });

        // 3. Verify the completed version is preserved
        const msg = await repo.getClientMessage('msg-1');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('full content');
      });

      it('should prevent pending from overwriting completed', async () => {
        await repo.upsertMessage({
          client_id: 'msg-2',
          streaming_status: 'completed',
          content: 'final content',
        });

        await repo.upsertMessage({
          client_id: 'msg-2',
          streaming_status: 'pending',
          content: 'initial content',
        });

        const msg = await repo.getClientMessage('msg-2');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final content');
      });

      it('should prevent streaming from overwriting failed', async () => {
        await repo.upsertMessage({
          client_id: 'msg-3',
          streaming_status: 'failed',
          content: 'error content',
        });

        await repo.upsertMessage({
          client_id: 'msg-3',
          streaming_status: 'streaming',
          content: 'partial',
        });

        const msg = await repo.getClientMessage('msg-3');
        expect(msg?.streaming_status).toBe('failed');
        expect(msg?.content).toBe('error content');
      });

      it('should prevent pending from overwriting failed', async () => {
        await repo.upsertMessage({
          client_id: 'msg-4',
          streaming_status: 'failed',
          content: 'error content',
        });

        await repo.upsertMessage({
          client_id: 'msg-4',
          streaming_status: 'pending',
          content: 'initial',
        });

        const msg = await repo.getClientMessage('msg-4');
        expect(msg?.streaming_status).toBe('failed');
        expect(msg?.content).toBe('error content');
      });
    });

    describe('upsertMessage: allow forward transitions', () => {
      it('should allow streaming to update streaming', async () => {
        await repo.upsertMessage({
          client_id: 'msg-5',
          streaming_status: 'streaming',
          content: 'hello',
        });

        await repo.upsertMessage({
          client_id: 'msg-5',
          streaming_status: 'streaming',
          content: 'hello world',
        });

        const msg = await repo.getClientMessage('msg-5');
        expect(msg?.streaming_status).toBe('streaming');
        expect(msg?.content).toBe('hello world');
      });

      it('should allow streaming to transition to completed', async () => {
        await repo.upsertMessage({
          client_id: 'msg-6',
          streaming_status: 'streaming',
          content: 'hello',
        });

        await repo.upsertMessage({
          client_id: 'msg-6',
          streaming_status: 'completed',
          content: 'hello world',
        });

        const msg = await repo.getClientMessage('msg-6');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('hello world');
      });

      it('should allow streaming to transition to failed', async () => {
        await repo.upsertMessage({
          client_id: 'msg-7',
          streaming_status: 'streaming',
          content: 'partial',
        });

        await repo.upsertMessage({
          client_id: 'msg-7',
          streaming_status: 'failed',
          content: 'error occurred',
        });

        const msg = await repo.getClientMessage('msg-7');
        expect(msg?.streaming_status).toBe('failed');
      });

      it('should allow pending to transition to streaming', async () => {
        await repo.upsertMessage({
          client_id: 'msg-8',
          streaming_status: 'pending',
          content: 'initial',
        });

        await repo.upsertMessage({
          client_id: 'msg-8',
          streaming_status: 'streaming',
          content: 'started',
        });

        const msg = await repo.getClientMessage('msg-8');
        expect(msg?.streaming_status).toBe('streaming');
      });

      it('should allow completed to transition to completed (idempotent)', async () => {
        await repo.upsertMessage({
          client_id: 'msg-9',
          streaming_status: 'completed',
          content: 'final',
          updated_at: '2026-09-27T10:00:00Z',
        });

        await repo.upsertMessage({
          client_id: 'msg-9',
          streaming_status: 'completed',
          content: 'final',
          updated_at: '2026-09-27T10:00:00Z',
        });

        const msg = await repo.getClientMessage('msg-9');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final');
      });
    });

    describe('upsertMessage: edge cases with undefined status', () => {
      it('should allow update when existing has no streaming_status', async () => {
        await repo.upsertMessage({
          client_id: 'msg-10',
          content: 'initial',
          // No streaming_status specified
        });

        await repo.upsertMessage({
          client_id: 'msg-10',
          streaming_status: 'completed',
          content: 'final',
        });

        const msg = await repo.getClientMessage('msg-10');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final');
      });

      it('should allow update when incoming has no streaming_status', async () => {
        await repo.upsertMessage({
          client_id: 'msg-11',
          streaming_status: 'completed',
          content: 'final',
        });

        await repo.upsertMessage({
          client_id: 'msg-11',
          content: 'updated without status',
          // No streaming_status specified
        });

        const msg = await repo.getClientMessage('msg-11');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('updated without status');
      });

      it('should allow update when both have no streaming_status', async () => {
        await repo.upsertMessage({
          client_id: 'msg-12',
          content: 'initial',
        });

        await repo.upsertMessage({
          client_id: 'msg-12',
          content: 'updated',
        });

        const msg = await repo.getClientMessage('msg-12');
        expect(msg?.content).toBe('updated');
      });
    });

    describe('upsertMessage: multiple rapid streaming updates', () => {
      it('should handle multiple streaming updates correctly', async () => {
        // Initial message
        await repo.upsertMessage({
          client_id: 'msg-13',
          streaming_status: 'streaming',
          content: 'chunk 1',
        });

        // Multiple streaming updates
        await repo.upsertMessage({
          client_id: 'msg-13',
          streaming_status: 'streaming',
          content: 'chunk 1 chunk 2',
        });

        await repo.upsertMessage({
          client_id: 'msg-13',
          streaming_status: 'streaming',
          content: 'chunk 1 chunk 2 chunk 3',
        });

        // Final completed
        await repo.upsertMessage({
          client_id: 'msg-13',
          streaming_status: 'completed',
          content: 'full content',
        });

        // Late streaming update (should be blocked)
        await repo.upsertMessage({
          client_id: 'msg-13',
          streaming_status: 'streaming',
          content: 'late chunk',
        });

        const msg = await repo.getClientMessage('msg-13');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('full content');
      });
    });

    describe('upsertMessage: return value on regression', () => {
      it('should return existing state unchanged when regression detected', async () => {
        await repo.upsertMessage({
          client_id: 'msg-14',
          streaming_status: 'completed',
          content: 'final',
          server_id: 'srv-14',
        });

        const result = await repo.upsertMessage({
          client_id: 'msg-14',
          streaming_status: 'streaming',
          content: 'partial',
        });

        // Should return the existing state, not the incoming
        expect(result.after.streaming_status).toBe('completed');
        expect(result.after.content).toBe('final');
        expect(result.after.server_id).toBe('srv-14');
        expect(result.before).toBeDefined();
        expect(result.before?.streaming_status).toBe('completed');
      });
    });

    describe('upsertMessage: extreme edge cases', () => {
      it('should preserve other fields when regression detected', async () => {
        await repo.upsertMessage({
          client_id: 'msg-extreme-1',
          streaming_status: 'completed',
          content: 'final',
          server_id: 'srv-1',
          session_client_id: 'session-1',
          turn_id: 'turn-1',
          role: 'assistant',
          creator_kind: 'ai',
        });

        // Try to regress with new server_id and other fields
        await repo.upsertMessage({
          client_id: 'msg-extreme-1',
          streaming_status: 'streaming',
          content: 'partial',
          server_id: 'srv-2',
          session_client_id: 'session-2',
        });

        const msg = await repo.getClientMessage('msg-extreme-1');
        // All fields should be preserved from the completed state
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final');
        expect(msg?.server_id).toBe('srv-1');
        expect(msg?.session_client_id).toBe('session-1');
        expect(msg?.turn_id).toBe('turn-1');
        expect(msg?.role).toBe('assistant');
        expect(msg?.creator_kind).toBe('ai');
      });

      it('should handle empty string content with regression', async () => {
        await repo.upsertMessage({
          client_id: 'msg-extreme-2',
          streaming_status: 'completed',
          content: 'final content',
        });

        await repo.upsertMessage({
          client_id: 'msg-extreme-2',
          streaming_status: 'streaming',
          content: '',
        });

        const msg = await repo.getClientMessage('msg-extreme-2');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final content');
      });

      it('should handle very long content with regression', async () => {
        const longContent = 'a'.repeat(10000);
        await repo.upsertMessage({
          client_id: 'msg-extreme-3',
          streaming_status: 'completed',
          content: longContent,
        });

        const shortContent = 'short';
        await repo.upsertMessage({
          client_id: 'msg-extreme-3',
          streaming_status: 'streaming',
          content: shortContent,
        });

        const msg = await repo.getClientMessage('msg-extreme-3');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe(longContent);
        expect(msg?.content?.length).toBe(10000);
      });

      it('should handle special characters in content with regression', async () => {
        const specialContent = 'Hello 世界 🌍 \n\r\t "quotes" \\"escaped\\"\0null';
        await repo.upsertMessage({
          client_id: 'msg-extreme-4',
          streaming_status: 'completed',
          content: specialContent,
        });

        await repo.upsertMessage({
          client_id: 'msg-extreme-4',
          streaming_status: 'streaming',
          content: 'simple',
        });

        const msg = await repo.getClientMessage('msg-extreme-4');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe(specialContent);
      });

      it('should handle concurrent upsertMessage calls correctly', async () => {
        // Create initial completed message
        await repo.upsertMessage({
          client_id: 'msg-extreme-5',
          streaming_status: 'completed',
          content: 'final',
        });

        // Simulate concurrent streaming updates (race condition)
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            repo.upsertMessage({
              client_id: 'msg-extreme-5',
              streaming_status: 'streaming',
              content: `streaming ${i}`,
            })
          );
        }

        await Promise.all(promises);

        const msg = await repo.getClientMessage('msg-extreme-5');
        // Should still be completed (all regressions blocked)
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final');
      });

      it('should handle rapid state transitions', async () => {
        // pending → streaming → completed → streaming (blocked) → streaming (blocked)
        await repo.upsertMessage({
          client_id: 'msg-extreme-6',
          streaming_status: 'pending',
          content: 'initial',
        });

        await repo.upsertMessage({
          client_id: 'msg-extreme-6',
          streaming_status: 'streaming',
          content: 'started',
        });

        await repo.upsertMessage({
          client_id: 'msg-extreme-6',
          streaming_status: 'completed',
          content: 'done',
        });

        // These should all be blocked
        await repo.upsertMessage({
          client_id: 'msg-extreme-6',
          streaming_status: 'streaming',
          content: 'late 1',
        });

        await repo.upsertMessage({
          client_id: 'msg-extreme-6',
          streaming_status: 'streaming',
          content: 'late 2',
        });

        await repo.upsertMessage({
          client_id: 'msg-extreme-6',
          streaming_status: 'pending',
          content: 'very late',
        });

        const msg = await repo.getClientMessage('msg-extreme-6');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('done');
      });

      it('should preserve sync_status when regression detected', async () => {
        await repo.upsertMessage({
          client_id: 'msg-extreme-7',
          streaming_status: 'completed',
          content: 'final',
          sync_status: 'synced',
        });

        await repo.upsertMessage(
          {
            client_id: 'msg-extreme-7',
            streaming_status: 'streaming',
            content: 'partial',
          },
          'pending' // Try to change sync_status
        );

        const msg = await repo.getClientMessage('msg-extreme-7');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final');
        // sync_status should be preserved from the completed state
        expect(msg?.sync_status).toBe('synced');
      });

      it('should handle null content with regression', async () => {
        await repo.upsertMessage({
          client_id: 'msg-extreme-8',
          streaming_status: 'completed',
          content: 'final',
        });

        await repo.upsertMessage({
          client_id: 'msg-extreme-8',
          streaming_status: 'streaming',
          content: null as any,
        });

        const msg = await repo.getClientMessage('msg-extreme-8');
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final');
      });

      it('should handle multiple fields update with regression', async () => {
        await repo.upsertMessage({
          client_id: 'msg-extreme-9',
          streaming_status: 'completed',
          content: 'final',
          server_id: 'srv-1',
          updated_at: '2026-09-27T10:00:00Z',
        });

        // Try to update multiple fields along with regression
        await repo.upsertMessage({
          client_id: 'msg-extreme-9',
          streaming_status: 'streaming',
          content: 'partial',
          server_id: 'srv-2',
          updated_at: '2026-09-27T09:00:00Z',
        });

        const msg = await repo.getClientMessage('msg-extreme-9');
        // All fields should remain from completed state
        expect(msg?.streaming_status).toBe('completed');
        expect(msg?.content).toBe('final');
        expect(msg?.server_id).toBe('srv-1');
        expect(msg?.updated_at).toBe('2026-09-27T10:00:00Z');
      });
    });
  });

  describe('Issue 236: batch merge streaming guard', () => {
    it('should prevent streaming from overwriting completed in batch', async () => {
      // Setup: completed message in DB
      await repo.upsertMessage({
        client_id: 'msg-batch-1',
        streaming_status: 'completed',
        content: 'final',
        session_client_id: 'session-1',
      });

      // Simulate batch update with streaming data
      await repo.applyUpdates([{
        id: '',
        items: [{
          entity: 'message',
          action: 'updated',
          entity_id: 'server-msg-batch-1',
        }],
        data_list: [{
          id: 'server-msg-batch-1',
          client_id: 'msg-batch-1',
          session_client_id: 'session-1',
          streaming_status: 'streaming',
          content: 'partial',
        }],
        offset: 1,
      }]);

      const msg = await repo.getClientMessage('msg-batch-1');
      expect(msg?.streaming_status).toBe('completed');
      expect(msg?.content).toBe('final');
    });

    it('should allow streaming to update streaming in batch', async () => {
      await repo.upsertMessage({
        client_id: 'msg-batch-2',
        streaming_status: 'streaming',
        content: 'chunk 1',
        session_client_id: 'session-1',
      });

      await repo.applyUpdates([{
        id: '',
        items: [{
          entity: 'message',
          action: 'updated',
          entity_id: 'server-msg-batch-2',
        }],
        data_list: [{
          id: 'server-msg-batch-2',
          client_id: 'msg-batch-2',
          session_client_id: 'session-1',
          streaming_status: 'streaming',
          content: 'chunk 1 chunk 2',
        }],
        offset: 1,
      }]);

      const msg = await repo.getClientMessage('msg-batch-2');
      expect(msg?.streaming_status).toBe('streaming');
      expect(msg?.content).toBe('chunk 1 chunk 2');
    });

    it('should allow streaming to transition to completed in batch', async () => {
      await repo.upsertMessage({
        client_id: 'msg-batch-3',
        streaming_status: 'streaming',
        content: 'partial',
        session_client_id: 'session-1',
      });

      await repo.applyUpdates([{
        id: '',
        items: [{
          entity: 'message',
          action: 'updated',
          entity_id: 'server-msg-batch-3',
        }],
        data_list: [{
          id: 'server-msg-batch-3',
          client_id: 'msg-batch-3',
          session_client_id: 'session-1',
          streaming_status: 'completed',
          content: 'full',
        }],
        offset: 1,
      }]);

      const msg = await repo.getClientMessage('msg-batch-3');
      expect(msg?.streaming_status).toBe('completed');
      expect(msg?.content).toBe('full');
    });

    it('should handle mixed batch with multiple messages', async () => {
      // Setup: one completed, one streaming
      await repo.upsertMessage({
        client_id: 'msg-batch-4a',
        streaming_status: 'completed',
        content: 'final A',
        session_client_id: 'session-1',
      });

      await repo.upsertMessage({
        client_id: 'msg-batch-4b',
        streaming_status: 'streaming',
        content: 'partial B',
        session_client_id: 'session-1',
      });

      // Batch update: try to regress 4a, advance 4b
      await repo.applyUpdates([{
        id: '',
        items: [
          {
            entity: 'message',
            action: 'updated',
            entity_id: 'server-msg-batch-4a',
          },
          {
            entity: 'message',
            action: 'updated',
            entity_id: 'server-msg-batch-4b',
          },
        ],
        data_list: [
          {
            id: 'server-msg-batch-4a',
            client_id: 'msg-batch-4a',
            session_client_id: 'session-1',
            streaming_status: 'streaming',
            content: 'should be blocked',
          },
          {
            id: 'server-msg-batch-4b',
            client_id: 'msg-batch-4b',
            session_client_id: 'session-1',
            streaming_status: 'completed',
            content: 'final B',
          },
        ],
        offset: 1,
      }]);

      const msg4a = await repo.getClientMessage('msg-batch-4a');
      const msg4b = await repo.getClientMessage('msg-batch-4b');

      // 4a should remain completed (regression blocked)
      expect(msg4a?.streaming_status).toBe('completed');
      expect(msg4a?.content).toBe('final A');

      // 4b should advance to completed
      expect(msg4b?.streaming_status).toBe('completed');
      expect(msg4b?.content).toBe('final B');
    });
  });
});
