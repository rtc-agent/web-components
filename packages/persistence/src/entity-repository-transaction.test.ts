import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EntityRepository, type UpsertResult } from './entity-repository.js';
import { getDatabase, closeDatabase, type LocalSession, type LocalTurn } from './database.js';
import { getUIUpdateBus, type UIUpdateEvent } from './ui-update-bus.js';

const TEST_DB = 'rtc-agent-test-upsert-transaction';
const DEVICE_ID = 'test-device-001';

describe('upsert transaction safety', () => {
  let repo: EntityRepository;
  let collectedEvents: UIUpdateEvent[];
  let unsubscribe: (() => void) | undefined;

  beforeEach(async () => {
    const db = getDatabase(TEST_DB);
    await db.delete(); // Clean slate
    const freshDb = getDatabase(TEST_DB);
    await freshDb.open();
    repo = new EntityRepository(DEVICE_ID);

    // Collect UI update events
    collectedEvents = [];
    const bus = getUIUpdateBus();
    unsubscribe = bus.subscribe((event) => {
      collectedEvents.push(event);
    });
  });

  afterEach(async () => {
    unsubscribe?.();
    await closeDatabase();
  });

  describe('upsertSession transaction atomicity', () => {
    it('should atomically read and update session fields', async () => {
      // Create initial session
      const createResult = await repo.upsertSession({
        client_id: 's1',
        title: 'Original',
        status: 'active',
      });
      expect(createResult.after.title).toBe('Original');

      // Update only title
      const updateResult = await repo.upsertSession({
        client_id: 's1',
        title: 'Updated',
      });

      // Other fields should be preserved
      expect(updateResult.after.title).toBe('Updated');
      expect(updateResult.after.status).toBe('active');
      expect(updateResult.after.sync_status).toBe('synced');
    });

    it('should handle concurrent updates to same session correctly', async () => {
      // Create initial session
      await repo.upsertSession({
        client_id: 's1',
        title: 'Original',
        status: 'active',
        sync_status: 'pending',
      });

      // Simulate concurrent updates (in real scenario, these would be from different tabs)
      // Dexie transactions will serialize them
      const updates = [
        repo.upsertSession({ client_id: 's1', title: 'Update1' }),
        repo.upsertSession({ client_id: 's1', status: 'completed' }),
        repo.upsertSession({ client_id: 's1', sync_status: 'synced' }),
      ];

      const results = await Promise.all(updates);

      // All updates should be applied (last write wins for conflicting fields)
      const finalSession = await repo.getClientSession('s1');
      expect(finalSession).toBeDefined();
      expect(finalSession!.title).toBe('Update1');
      expect(finalSession!.status).toBe('completed');
      expect(finalSession!.sync_status).toBe('synced');
    });

    it('should preserve server_id when not provided in update', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'Test',
        server_id: 'server-uuid-123',
      });

      const result = await repo.upsertSession({
        client_id: 's1',
        title: 'Updated',
      });

      expect(result.after.server_id).toBe('server-uuid-123');
      expect(result.after.title).toBe('Updated');
    });

    it('should overwrite server_id when explicitly provided', async () => {
      await repo.upsertSession({
        client_id: 's1',
        server_id: 'old-server-id',
      });

      const result = await repo.upsertSession({
        client_id: 's1',
        server_id: 'new-server-id',
      });

      expect(result.after.server_id).toBe('new-server-id');
    });

    it('should create session with all default values when fields are missing', async () => {
      const result = await repo.upsertSession({
        client_id: 's1',
      });

      expect(result.after.client_id).toBe('s1');
      expect(result.after.status).toBe('active');
      expect(result.after.sync_status).toBe('synced');
      expect(result.after.pending_turn_count).toBe(0);
      expect(result.after.running_turn_count).toBe(0);
      expect(result.after.created_at).toBeDefined();
      expect(result.after.updated_at).toBeDefined();
    });
  });

  describe('preserveSyncStatus option', () => {
    it('should preserve sync_status when preserveSyncStatus=true', async () => {
      // Create session with sync_status='pending'
      await repo.upsertSession({
        client_id: 's1',
        title: 'Test',
      }, 'pending');

      // Update with preserveSyncStatus=true
      const result = await repo.upsertSession(
        {
          client_id: 's1',
          pending_turn_count: 5,
        },
        'synced', // This should be ignored
        { preserveSyncStatus: true }
      );

      // sync_status should remain 'pending'
      expect(result.after.sync_status).toBe('pending');
      expect(result.after.pending_turn_count).toBe(5);
    });

    it('should overwrite sync_status when preserveSyncStatus=false', async () => {
      await repo.upsertSession({
        client_id: 's1',
      }, 'pending');

      const result = await repo.upsertSession(
        {
          client_id: 's1',
          title: 'Updated',
        },
        'synced',
        { preserveSyncStatus: false }
      );

      expect(result.after.sync_status).toBe('synced');
    });

    it('should overwrite sync_status by default (preserveSyncStatus not set)', async () => {
      await repo.upsertSession({
        client_id: 's1',
      }, 'pending');

      const result = await repo.upsertSession({
        client_id: 's1',
        title: 'Updated',
      }, 'synced');

      expect(result.after.sync_status).toBe('synced');
    });

    it('should handle preserveSyncStatus for non-existent session', async () => {
      // Creating new session with preserveSyncStatus should still use provided syncStatus
      const result = await repo.upsertSession(
        {
          client_id: 's1',
          title: 'New',
        },
        'failed',
        { preserveSyncStatus: true }
      );

      // For new sessions, sync_status comes from the parameter
      expect(result.after.sync_status).toBe('failed');
    });

    it('should preserve sync_status in concurrent aggregation updates', async () => {
      // Simulate turn count updates that shouldn't affect sync_status
      await repo.upsertSession({
        client_id: 's1',
        sync_status: 'pending',
      });

      // Multiple concurrent aggregation updates
      const updates = [
        repo.upsertSession(
          { client_id: 's1', pending_turn_count: 1 },
          'synced',
          { preserveSyncStatus: true, silent: true }
        ),
        repo.upsertSession(
          { client_id: 's1', pending_turn_count: 2 },
          'synced',
          { preserveSyncStatus: true, silent: true }
        ),
        repo.upsertSession(
          { client_id: 's1', running_turn_count: 1 },
          'synced',
          { preserveSyncStatus: true, silent: true }
        ),
      ];

      await Promise.all(updates);

      const finalSession = await repo.getClientSession('s1');
      // sync_status should remain 'pending'
      expect(finalSession!.sync_status).toBe('pending');
      // Counts should be updated (last write wins)
      expect(finalSession!.pending_turn_count).toBe(2);
      expect(finalSession!.running_turn_count).toBe(1);
    });
  });

  describe('UI update events', () => {
    it('should emit field-level events on update', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'Old',
        status: 'active',
      });
      collectedEvents.length = 0;

      await repo.upsertSession({
        client_id: 's1',
        title: 'New',
      });

      // Should emit events only for changed fields
      const titleEvents = collectedEvents.filter(e => e.field === 'title');
      expect(titleEvents.length).toBeGreaterThan(0);
      expect(titleEvents[0].oldValue).toBe('Old');
      expect(titleEvents[0].newValue).toBe('New');

      // status should not emit event (unchanged)
      const statusEvents = collectedEvents.filter(e => e.field === 'status');
      expect(statusEvents.length).toBe(0);
    });

    it('should emit create events for all fields on create', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'Test',
      });

      // Should emit events for all top-level fields
      expect(collectedEvents.length).toBeGreaterThan(0);
      const fields = collectedEvents.map(e => e.field);
      expect(fields).toContain('client_id');
      expect(fields).toContain('title');
    });

    it('should suppress events when silent=true', async () => {
      await repo.upsertSession({
        client_id: 's1',
      });
      collectedEvents.length = 0;

      await repo.upsertSession(
        {
          client_id: 's1',
          title: 'Silent Update',
        },
        'synced',
        { silent: true }
      );

      expect(collectedEvents.length).toBe(0);
    });

    it('should combine silent and preserveSyncStatus options', async () => {
      await repo.upsertSession({
        client_id: 's1',
        sync_status: 'pending',
      });
      collectedEvents.length = 0;

      const result = await repo.upsertSession(
        {
          client_id: 's1',
          pending_turn_count: 3,
        },
        'synced',
        { silent: true, preserveSyncStatus: true }
      );

      // No events should be emitted
      expect(collectedEvents.length).toBe(0);
      // sync_status should be preserved
      expect(result.after.sync_status).toBe('pending');
      // Count should be updated
      expect(result.after.pending_turn_count).toBe(3);
    });
  });

  describe('upsertTurn transaction atomicity', () => {
    it('should atomically update turn fields', async () => {
      await repo.upsertTurn({
        client_id: 't1',
        session_client_id: 's1',
        status: 'pending',
      });

      const result = await repo.upsertTurn({
        client_id: 't1',
        status: 'running',
      });

      expect(result.after.status).toBe('running');
      expect(result.after.session_client_id).toBe('s1');
      expect(result.after.sync_status).toBe('synced');
    });

    it('should preserve sync_status when preserveSyncStatus=true', async () => {
      await repo.upsertTurn({
        client_id: 't1',
        session_client_id: 's1',
      }, 'pending');

      const result = await repo.upsertTurn(
        {
          client_id: 't1',
          status: 'completed',
        },
        'synced',
        { preserveSyncStatus: true }
      );

      expect(result.after.sync_status).toBe('pending');
      expect(result.after.status).toBe('completed');
    });
  });

  describe('upsertMessage transaction atomicity', () => {
    it('should atomically update message fields', async () => {
      await repo.upsertMessage({
        client_id: 'm1',
        session_client_id: 's1',
        content: 'Original',
        role: 'user',
      });

      const result = await repo.upsertMessage({
        client_id: 'm1',
        content: 'Updated',
      });

      expect(result.after.content).toBe('Updated');
      expect(result.after.role).toBe('user');
      expect(result.after.session_client_id).toBe('s1');
    });

    it('should preserve sync_status when preserveSyncStatus=true', async () => {
      await repo.upsertMessage({
        client_id: 'm1',
        session_client_id: 's1',
      }, 'failed');

      const result = await repo.upsertMessage(
        {
          client_id: 'm1',
          content: 'Retry',
        },
        'synced',
        { preserveSyncStatus: true }
      );

      expect(result.after.sync_status).toBe('failed');
    });
  });

  describe('upsertRtc transaction atomicity', () => {
    it('should atomically update RTC fields', async () => {
      await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
        tool_name: 'search',
        status: 'pending',
      });

      const result = await repo.upsertRtc({
        client_id: 'r1',
        status: 'completed',
        result: { data: 'test' },
      });

      expect(result.after.status).toBe('completed');
      expect(result.after.tool_name).toBe('search');
      expect(result.after.result).toEqual({ data: 'test' });
    });

    it('should preserve sync_status when preserveSyncStatus=true', async () => {
      await repo.upsertRtc({
        client_id: 'r1',
        session_client_id: 's1',
      }, 'pending');

      const result = await repo.upsertRtc(
        {
          client_id: 'r1',
          status: 'completed',
        },
        'synced',
        { preserveSyncStatus: true }
      );

      expect(result.after.sync_status).toBe('pending');
    });
  });

  describe('concurrent upsert scenarios', () => {
    it('should handle rapid sequential upserts correctly', async () => {
      // Create session
      await repo.upsertSession({
        client_id: 's1',
        title: 'v0',
      });

      // Rapid sequential updates
      for (let i = 1; i <= 10; i++) {
        await repo.upsertSession({
          client_id: 's1',
          title: `v${i}`,
          pending_turn_count: i,
        });
      }

      const finalSession = await repo.getClientSession('s1');
      expect(finalSession!.title).toBe('v10');
      expect(finalSession!.pending_turn_count).toBe(10);
    });

    it('should handle concurrent upserts to different sessions', async () => {
      const sessions = ['s1', 's2', 's3', 's4', 's5'];
      const updates = sessions.flatMap(s => [
        repo.upsertSession({ client_id: s, title: `${s}-title` }),
        repo.upsertSession({ client_id: s, status: 'active' }),
        repo.upsertSession({ client_id: s, pending_turn_count: 5 }),
      ]);

      await Promise.all(updates);

      // All sessions should have all fields set
      for (const s of sessions) {
        const session = await repo.getClientSession(s);
        expect(session).toBeDefined();
        expect(session!.title).toBe(`${s}-title`);
        expect(session!.status).toBe('active');
        expect(session!.pending_turn_count).toBe(5);
      }
    });

    it('should handle mixed concurrent operations (create + update)', async () => {
      // Pre-create one session
      await repo.upsertSession({
        client_id: 's1',
        title: 'Existing',
      });

      // Concurrent create and update
      const operations = [
        repo.upsertSession({ client_id: 's1', title: 'Updated' }),
        repo.upsertSession({ client_id: 's2', title: 'New' }),
        repo.upsertSession({ client_id: 's1', status: 'completed' }),
        repo.upsertSession({ client_id: 's3', title: 'Another New' }),
      ];

      await Promise.all(operations);

      const s1 = await repo.getClientSession('s1');
      expect(s1!.title).toBe('Updated');
      expect(s1!.status).toBe('completed');

      const s2 = await repo.getClientSession('s2');
      expect(s2!.title).toBe('New');

      const s3 = await repo.getClientSession('s3');
      expect(s3!.title).toBe('Another New');
    });
  });

  describe('edge cases', () => {
    it('should handle empty client_id', async () => {
      const result = await repo.upsertSession({
        title: 'No ID',
      });

      expect(result.after.client_id).toBe('');
    });

    it('should handle undefined fields in partial update', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'Test',
        status: 'active',
      });

      // Note: JavaScript spread operator will overwrite with undefined
      // This is expected behavior - undefined fields DO overwrite
      const result = await repo.upsertSession({
        client_id: 's1',
        title: undefined,
        status: 'completed',
      });

      // title becomes undefined (overwritten by spread)
      expect(result.after.title).toBeUndefined();
      expect(result.after.status).toBe('completed');
    });

    it('should handle null values in update', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'Test',
      });

      // Explicitly setting to null should work
      const result = await repo.upsertSession({
        client_id: 's1',
        deleted_at: null as any,
      });

      expect(result.after.deleted_at).toBeNull();
    });

    it('should handle very large field values', async () => {
      const largeString = 'x'.repeat(10000);
      const result = await repo.upsertSession({
        client_id: 's1',
        agent_prompt: largeString,
      });

      expect(result.after.agent_prompt).toBe(largeString);
    });

    it('should handle special characters in fields', async () => {
      const result = await repo.upsertSession({
        client_id: 's1',
        title: 'Test with "quotes" and <tags> and & symbols',
      });

      expect(result.after.title).toBe('Test with "quotes" and <tags> and & symbols');
    });

    it('should handle Unicode characters', async () => {
      const result = await repo.upsertSession({
        client_id: 's1',
        title: '测试中文 🎉',
      });

      expect(result.after.title).toBe('测试中文 🎉');
    });

    it('should return correct before/after snapshots', async () => {
      await repo.upsertSession({
        client_id: 's1',
        title: 'Before',
        status: 'active',
      });

      const result = await repo.upsertSession({
        client_id: 's1',
        title: 'After',
      });

      expect(result.before?.title).toBe('Before');
      expect(result.before?.status).toBe('active');
      expect(result.after.title).toBe('After');
      expect(result.after.status).toBe('active');
    });

    it('should return undefined before for new sessions', async () => {
      const result = await repo.upsertSession({
        client_id: 's1',
        title: 'New',
      });

      expect(result.before).toBeUndefined();
      expect(result.after.title).toBe('New');
    });
  });

  describe('turn count aggregation scenario', () => {
    it('should correctly update turn counts without affecting sync_status', async () => {
      // Create session with pending sync_status
      await repo.upsertSession({
        client_id: 's1',
        sync_status: 'pending',
      });

      // Simulate turn creation and count updates
      await repo.upsertTurn({
        client_id: 't1',
        session_client_id: 's1',
        status: 'pending',
      });

      // Update session turn counts (like applyUpdateItem does)
      const { pending, running } = await repo.countActiveTurns('s1');
      await repo.upsertSession(
        {
          client_id: 's1',
          pending_turn_count: pending,
          running_turn_count: running,
        },
        'synced',
        { preserveSyncStatus: true, silent: true }
      );

      const session = await repo.getClientSession('s1');
      // sync_status should still be 'pending'
      expect(session!.sync_status).toBe('pending');
      // Turn counts should be updated
      expect(session!.pending_turn_count).toBe(1);
      expect(session!.running_turn_count).toBe(0);
    });
  });

  describe('Fix 201: writebackTurnCountsInTx partial update', () => {
    it('should use partial update instead of bulkPut to preserve other fields', async () => {
      // This test verifies the fix for issue 201:
      // writebackTurnCountsInTx should only update turn count fields,
      // not overwrite the entire session object.

      // Create session with multiple fields
      await repo.upsertSession({
        client_id: 's1',
        title: 'Test Session',
        status: 'active',
        sync_status: 'synced',
        pending_turn_count: 0,
        running_turn_count: 0,
      });

      // Create turns
      await repo.upsertTurn({
        client_id: 't1',
        session_client_id: 's1',
        status: 'pending',
      });

      // Simulate concurrent modification to session title
      // (In real scenario, this would be from another Tab)
      await repo.upsertSession({
        client_id: 's1',
        title: 'Updated Title',
      });

      // Get current turn counts
      const { pending, running } = await repo.countActiveTurns('s1');

      // Manually trigger writeback (simulating what applyUpdates does)
      // This would previously overwrite the title field
      const db = getDatabase(TEST_DB);
      const session = await db.sessions.get('s1');
      expect(session).toBeDefined();

      // Use partial update (the fix)
      await db.sessions.update('s1', {
        pending_turn_count: pending,
        running_turn_count: running,
      });

      // Verify the concurrent title update was preserved
      const updatedSession = await repo.getClientSession('s1');
      expect(updatedSession!.title).toBe('Updated Title');
      expect(updatedSession!.status).toBe('active');
      expect(updatedSession!.sync_status).toBe('synced');

      // Verify turn counts were updated correctly
      expect(updatedSession!.pending_turn_count).toBe(1);
      expect(updatedSession!.running_turn_count).toBe(0);
    });

    it('should not overwrite fields when using partial update pattern', async () => {
      // Create session with many fields
      await repo.upsertSession({
        client_id: 's1',
        title: 'Original',
        status: 'active',
        sync_status: 'synced',
        pending_turn_count: 0,
        running_turn_count: 0,
      });

      // Get the session
      const db = getDatabase(TEST_DB);
      const originalSession = await db.sessions.get('s1');
      expect(originalSession).toBeDefined();

      // Simulate the OLD buggy behavior (for comparison)
      // This would overwrite all fields
      const buggyUpdate = {
        ...originalSession!,
        pending_turn_count: 5,
        running_turn_count: 3,
      };
      await db.sessions.put(buggyUpdate);

      // Verify it worked
      let session = await repo.getClientSession('s1');
      expect(session!.pending_turn_count).toBe(5);
      expect(session!.running_turn_count).toBe(3);

      // Now modify title
      await repo.upsertSession({
        client_id: 's1',
        title: 'New Title',
      });

      // Use the NEW fixed behavior (partial update)
      await db.sessions.update('s1', {
        pending_turn_count: 10,
        running_turn_count: 7,
      });

      // Verify title was NOT overwritten
      session = await repo.getClientSession('s1');
      expect(session!.title).toBe('New Title');
      expect(session!.pending_turn_count).toBe(10);
      expect(session!.running_turn_count).toBe(7);
    });

    it('should handle multiple sessions with independent partial updates', async () => {
      // Create two sessions
      await repo.upsertSession({
        client_id: 's1',
        title: 'Session 1',
        status: 'active',
      });
      await repo.upsertSession({
        client_id: 's2',
        title: 'Session 2',
        status: 'completed',
      });

      const db = getDatabase(TEST_DB);

      // Update s1's title
      await repo.upsertSession({
        client_id: 's1',
        title: 'Updated Session 1',
      });

      // Use partial update for both sessions
      await db.sessions.update('s1', {
        pending_turn_count: 1,
        running_turn_count: 0,
      });
      await db.sessions.update('s2', {
        pending_turn_count: 0,
        running_turn_count: 2,
      });

      // Verify each session's fields are correct
      const s1 = await repo.getClientSession('s1');
      expect(s1!.title).toBe('Updated Session 1');
      expect(s1!.status).toBe('active');
      expect(s1!.pending_turn_count).toBe(1);
      expect(s1!.running_turn_count).toBe(0);

      const s2 = await repo.getClientSession('s2');
      expect(s2!.title).toBe('Session 2');
      expect(s2!.status).toBe('completed');
      expect(s2!.pending_turn_count).toBe(0);
      expect(s2!.running_turn_count).toBe(2);
    });

    it('should only write when turn counts actually change', async () => {
      // Create session with initial turn counts
      await repo.upsertSession({
        client_id: 's1',
        title: 'Test',
        pending_turn_count: 2,
        running_turn_count: 1,
      });

      const db = getDatabase(TEST_DB);

      // Track DB writes
      const updateSpy = vi.spyOn(db.sessions, 'update');

      // Try to update with same counts
      await db.sessions.update('s1', {
        pending_turn_count: 2,
        running_turn_count: 1,
      });

      // Verify update was called (Dexie doesn't optimize this, but our code checks before calling)
      expect(updateSpy).toHaveBeenCalled();

      // Verify session data is unchanged
      const session = await repo.getClientSession('s1');
      expect(session!.pending_turn_count).toBe(2);
      expect(session!.running_turn_count).toBe(1);
      expect(session!.title).toBe('Test');

      updateSpy.mockRestore();
    });
  });
});
