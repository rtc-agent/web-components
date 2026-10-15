import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  DB_NAME_PREFIX,
  flushAll,
  getDatabase,
} from './database';
import { EntityRepository } from './entity-repository';
import { closeUIUpdateBus } from './ui-update-bus';

const TEST_DB = `${DB_NAME_PREFIX}test-entity-repository-pagination`;
const TEST_DEVICE_ID = 'test-device-pagination';

// Helper to create session with all required fields
const createTestSession = (
  overrides: Partial<Parameters<EntityRepository['upsertSession']>[0]> = {},
) => ({
  owner_kind: 'user',
  owner_ref_id: 'test-user',
  status: 'active' as const,
  sync_status: 'synced' as const,
  pending_turn_count: 0,
  running_turn_count: 0,
  ...overrides,
});

describe('EntityRepository - listSessions cursor pagination', () => {
  let repo: EntityRepository;

  beforeEach(async () => {
    // Reset singleton state
    getDatabase(TEST_DB);
    await flushAll(true);
    closeUIUpdateBus();

    // Create fresh repository
    repo = new EntityRepository(TEST_DEVICE_ID);
  });

  afterEach(async () => {
    await closeDatabase();
    closeUIUpdateBus();
  });

  describe('listSessions() cursor pagination verification', () => {
    it('should not return soft-deleted sessions', async () => {
      // Create multiple sessions
      await repo.upsertSession(
        createTestSession({
          client_id: 's1',
          title: 'Session 1',
          updated_at: new Date(Date.now() - 3000).toISOString(),
        }),
      );
      await repo.upsertSession(
        createTestSession({
          client_id: 's2',
          title: 'Session 2',
          updated_at: new Date(Date.now() - 2000).toISOString(),
        }),
      );
      await repo.upsertSession(
        createTestSession({
          client_id: 's3',
          title: 'Session 3',
          updated_at: new Date(Date.now() - 1000).toISOString(),
        }),
      );

      // Soft delete middle session
      await repo.softDeleteSession('s2');

      // List all sessions
      const sessions = await repo.listSessions();

      // Should only return non-deleted sessions
      expect(sessions).toHaveLength(2);
      const clientIds = sessions.map((s) => s.client_id);
      expect(clientIds).toContain('s1');
      expect(clientIds).toContain('s3');
      expect(clientIds).not.toContain('s2');
    });

    it('should correctly implement cursor pagination', async () => {
      // Create 10 sessions with distinct timestamps
      const baseTime = Date.now();
      for (let i = 0; i < 10; i++) {
        await repo.upsertSession(
          createTestSession({
            client_id: `session-${i}`,
            title: `Session ${i}`,
            updated_at: new Date(baseTime - i * 1000).toISOString(),
          }),
        );
      }

      // Get first page (3 items)
      const page1 = await repo.listSessions(undefined, 3);
      expect(page1).toHaveLength(3);
      expect(page1[0].client_id).toBe('session-0'); // Most recent
      expect(page1[1].client_id).toBe('session-1');
      expect(page1[2].client_id).toBe('session-2');

      // Get second page using cursor
      const page2 = await repo.listSessions(page1[2].client_id, 3);
      expect(page2).toHaveLength(3);
      expect(page2[0].client_id).toBe('session-3');
      expect(page2[1].client_id).toBe('session-4');
      expect(page2[2].client_id).toBe('session-5');

      // Get third page
      const page3 = await repo.listSessions(page2[2].client_id, 3);
      expect(page3).toHaveLength(3);
      expect(page3[0].client_id).toBe('session-6');
      expect(page3[1].client_id).toBe('session-7');
      expect(page3[2].client_id).toBe('session-8');
    });

    it('should return sessions ordered by updated_at descending', async () => {
      // Create sessions with different timestamps
      const baseTime = new Date('2026-01-01T00:00:00Z').getTime();

      await repo.upsertSession(
        createTestSession({
          client_id: 'old',
          title: 'Old Session',
          updated_at: new Date(baseTime - 2000).toISOString(),
        }),
      );

      await repo.upsertSession(
        createTestSession({
          client_id: 'newest',
          title: 'Newest Session',
          updated_at: new Date(baseTime).toISOString(),
        }),
      );

      await repo.upsertSession(
        createTestSession({
          client_id: 'middle',
          title: 'Middle Session',
          updated_at: new Date(baseTime - 1000).toISOString(),
        }),
      );

      const sessions = await repo.listSessions();

      // Verify order: newest to oldest
      expect(sessions[0].client_id).toBe('newest');
      expect(sessions[1].client_id).toBe('middle');
      expect(sessions[2].client_id).toBe('old');
    });

    it('should handle empty result set', async () => {
      const sessions = await repo.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should handle cursor not found gracefully', async () => {
      // Create some sessions
      await repo.upsertSession(
        createTestSession({
          client_id: 's1',
          title: 'Session 1',
          updated_at: new Date(Date.now() - 1000).toISOString(),
        }),
      );
      await repo.upsertSession(
        createTestSession({
          client_id: 's2',
          title: 'Session 2',
          updated_at: new Date().toISOString(),
        }),
      );

      // Use non-existent cursor
      const sessions = await repo.listSessions('non-existent-cursor', 10);

      // Should return from the beginning when cursor not found
      expect(sessions).toHaveLength(2);
      expect(sessions[0].client_id).toBe('s2'); // Most recent first
    });

    it('should respect limit parameter', async () => {
      // Create 20 sessions
      for (let i = 0; i < 20; i++) {
        await repo.upsertSession({
          client_id: `s${i}`,
          title: `Session ${i}`,
          updated_at: new Date(Date.now() - i * 100).toISOString(),
        });
      }

      const limit5 = await repo.listSessions(undefined, 5);
      expect(limit5).toHaveLength(5);

      const limit10 = await repo.listSessions(undefined, 10);
      expect(limit10).toHaveLength(10);

      const limit100 = await repo.listSessions(undefined, 100);
      expect(limit100).toHaveLength(20); // All sessions
    });

    it('should handle pagination with deleted sessions in between', async () => {
      // Create 5 sessions
      const baseTime = Date.now();
      for (let i = 0; i < 5; i++) {
        await repo.upsertSession({
          client_id: `s${i}`,
          title: `Session ${i}`,
          updated_at: new Date(baseTime - i * 1000).toISOString(),
        });
      }

      // Delete sessions at indices 1 and 3
      await repo.softDeleteSession('s1');
      await repo.softDeleteSession('s3');

      // Paginate through remaining sessions
      const page1 = await repo.listSessions(undefined, 2);
      expect(page1).toHaveLength(2);
      expect(page1[0].client_id).toBe('s0');
      expect(page1[1].client_id).toBe('s2'); // s1 is deleted

      const page2 = await repo.listSessions(page1[1].client_id, 2);
      expect(page2).toHaveLength(1); // Only s4 remains (s3 is deleted)
      expect(page2[0].client_id).toBe('s4');
    });

    it('should handle single item pagination', async () => {
      // Create 3 sessions
      await repo.upsertSession(
        createTestSession({
          client_id: 's1',
          title: 'Session 1',
          updated_at: new Date(Date.now() - 2000).toISOString(),
        }),
      );
      await repo.upsertSession(
        createTestSession({
          client_id: 's2',
          title: 'Session 2',
          updated_at: new Date(Date.now() - 1000).toISOString(),
        }),
      );
      await repo.upsertSession(
        createTestSession({
          client_id: 's3',
          title: 'Session 3',
          updated_at: new Date().toISOString(),
        }),
      );

      // Paginate one at a time
      const page1 = await repo.listSessions(undefined, 1);
      expect(page1).toHaveLength(1);
      expect(page1[0].client_id).toBe('s3');

      const page2 = await repo.listSessions(page1[0].client_id, 1);
      expect(page2).toHaveLength(1);
      expect(page2[0].client_id).toBe('s2');

      const page3 = await repo.listSessions(page2[0].client_id, 1);
      expect(page3).toHaveLength(1);
      expect(page3[0].client_id).toBe('s1');

      const page4 = await repo.listSessions(page3[0].client_id, 1);
      expect(page4).toHaveLength(0); // No more sessions
    });

    it('should handle sessions with same updated_at', async () => {
      // Create sessions with identical timestamps
      const sameTime = new Date().toISOString();

      await repo.upsertSession(
        createTestSession({
          client_id: 's1',
          title: 'Session 1',
          updated_at: sameTime,
        }),
      );
      await repo.upsertSession(
        createTestSession({
          client_id: 's2',
          title: 'Session 2',
          updated_at: sameTime,
        }),
      );
      await repo.upsertSession(
        createTestSession({
          client_id: 's3',
          title: 'Session 3',
          updated_at: sameTime,
        }),
      );

      const sessions = await repo.listSessions();

      // All sessions should be returned
      expect(sessions).toHaveLength(3);

      // All should have the same updated_at
      sessions.forEach((s) => {
        expect(s.updated_at).toBe(sameTime);
      });
    });

    it('should return all sessions when limit is very large', async () => {
      // Create 50 sessions
      for (let i = 0; i < 50; i++) {
        await repo.upsertSession({
          client_id: `s${i}`,
          title: `Session ${i}`,
          updated_at: new Date(Date.now() - i * 10).toISOString(),
        });
      }

      const sessions = await repo.listSessions(undefined, 10000);
      expect(sessions).toHaveLength(50);
    });

    it('should handle pagination after updating session timestamps', async () => {
      // Create initial sessions
      await repo.upsertSession(
        createTestSession({
          client_id: 's1',
          title: 'Session 1',
          updated_at: new Date(Date.now() - 2000).toISOString(),
        }),
      );
      await repo.upsertSession(
        createTestSession({
          client_id: 's2',
          title: 'Session 2',
          updated_at: new Date(Date.now() - 1000).toISOString(),
        }),
      );

      // Update s1 to be most recent
      await repo.upsertSession(
        createTestSession({
          client_id: 's1',
          title: 'Session 1 Updated',
          updated_at: new Date().toISOString(),
        }),
      );

      const sessions = await repo.listSessions();

      // s1 should now be first (most recent)
      expect(sessions[0].client_id).toBe('s1');
      expect(sessions[1].client_id).toBe('s2');
    });

    it('should maintain cursor position across multiple paginations', async () => {
      // Create 15 sessions
      for (let i = 0; i < 15; i++) {
        await repo.upsertSession({
          client_id: `session-${i}`,
          title: `Session ${i}`,
          updated_at: new Date(Date.now() - i * 100).toISOString(),
        });
      }

      // Paginate through all sessions with page size 4
      const allSessions: string[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < 4; page++) {
        const sessions = await repo.listSessions(cursor, 4);
        allSessions.push(...sessions.map((s) => s.client_id));
        cursor = sessions[sessions.length - 1]?.client_id;

        if (sessions.length < 4) break;
      }

      // Should have retrieved all 15 sessions
      expect(allSessions).toHaveLength(15);

      // Verify no duplicates
      const uniqueSessions = new Set(allSessions);
      expect(uniqueSessions.size).toBe(15);
    });
  });
});
