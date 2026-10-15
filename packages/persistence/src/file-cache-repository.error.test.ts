import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  DB_NAME_PREFIX,
  flushAll,
  getDatabase,
} from './database';
import { FileCacheRepository } from './file-cache-repository';

const TEST_DB = `${DB_NAME_PREFIX}test-file-cache-error`;

describe('FileCacheRepository - updateSyncStatus error handling', () => {
  let repo: FileCacheRepository;

  beforeEach(async () => {
    await closeDatabase();
    getDatabase(TEST_DB);
    await flushAll(true);
    repo = new FileCacheRepository();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  describe('updateSyncStatus() error handling verification', () => {
    it('should throw error when entry does not exist', async () => {
      const nonExistentMd5 = 'nonexistent123456789012345678';
      const ext = 'txt';

      await expect(
        repo.updateSyncStatus(nonExistentMd5, ext, 'syncing'),
      ).rejects.toThrow(/File cache entry not found/);
    });

    it('should include md5 and ext in error message when entry not found', async () => {
      const md5 = 'abc123456789012345678901234567';
      const ext = 'png';

      try {
        await repo.updateSyncStatus(md5, ext, 'synced');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const errorMessage = (err as Error).message;

        // Verify error message contains file identifier
        expect(errorMessage).toContain(md5);
        expect(errorMessage).toContain(ext);

        // Verify error message format: "md5.ext"
        expect(errorMessage).toMatch(/abc123456789012345678901234567\.png/);

        // Verify error message is descriptive
        expect(errorMessage).toMatch(/file cache entry not found/i);
      }
    });

    it('should update sync status successfully when entry exists', async () => {
      const md5 = 'test123456789012345678901234';
      const ext = 'jpg';
      const blob = new Blob(['test content'], { type: 'image/jpeg' });

      // Create entry first
      await repo.put(md5, ext, blob, 'image/jpeg');

      // Update sync status - should not throw
      await expect(
        repo.updateSyncStatus(md5, ext, 'syncing'),
      ).resolves.toBeUndefined();

      // Verify the status was updated
      const cached = await repo.get(md5, ext);
      expect(cached).not.toBeNull();
      expect(cached?.syncStatus).toBe('syncing');
    });

    it('should update to different sync statuses correctly', async () => {
      const md5 = 'status12345678901234567890123';
      const ext = 'pdf';
      const blob = new Blob(['test'], { type: 'application/pdf' });

      await repo.put(md5, ext, blob, 'application/pdf');

      // Test all valid status transitions
      const statuses: Array<'pending' | 'syncing' | 'synced' | 'failed'> = [
        'pending',
        'syncing',
        'synced',
        'failed',
      ];

      for (const status of statuses) {
        await repo.updateSyncStatus(md5, ext, status);
        const cached = await repo.get(md5, ext);
        expect(cached?.syncStatus).toBe(status);
      }
    });

    it('should set errorMessage when status is failed', async () => {
      const md5 = 'error123456789012345678901234';
      const ext = 'txt';
      const blob = new Blob(['test'], { type: 'text/plain' });

      await repo.put(md5, ext, blob, 'text/plain');

      const errorMessage = 'Network timeout';
      await repo.updateSyncStatus(md5, ext, 'failed', errorMessage);

      const cached = await repo.get(md5, ext);
      expect(cached?.syncStatus).toBe('failed');
      expect(cached?.errorMessage).toBe(errorMessage);
    });

    it('should increment retryCount when status is failed', async () => {
      const md5 = 'retry123456789012345678901234';
      const ext = 'txt';
      const blob = new Blob(['test'], { type: 'text/plain' });

      await repo.put(md5, ext, blob, 'text/plain');

      // Initial retry count should be 0
      let cached = await repo.get(md5, ext);
      expect(cached?.retryCount).toBe(0);

      // Fail once
      await repo.updateSyncStatus(md5, ext, 'failed', 'Error 1');
      cached = await repo.get(md5, ext);
      expect(cached?.retryCount).toBe(1);

      // Fail again
      await repo.updateSyncStatus(md5, ext, 'failed', 'Error 2');
      cached = await repo.get(md5, ext);
      expect(cached?.retryCount).toBe(2);
    });

    it('should set syncedAt when status is synced', async () => {
      const md5 = 'synced1234567890123456789012';
      const ext = 'txt';
      const blob = new Blob(['test'], { type: 'text/plain' });

      await repo.put(md5, ext, blob, 'text/plain');

      // syncedAt should be undefined initially
      let cached = await repo.get(md5, ext);
      expect(cached?.syncedAt).toBeUndefined();

      // Update to synced
      const beforeSync = Date.now();
      await repo.updateSyncStatus(md5, ext, 'synced');
      const afterSync = Date.now();

      cached = await repo.get(md5, ext);
      expect(cached?.syncedAt).toBeDefined();
      expect(cached?.syncedAt).toBeGreaterThanOrEqual(beforeSync);
      expect(cached?.syncedAt).toBeLessThanOrEqual(afterSync);
    });

    it('should clear errorMessage when status changes to synced', async () => {
      const md5 = 'clear123456789012345678901234';
      const ext = 'txt';
      const blob = new Blob(['test'], { type: 'text/plain' });

      await repo.put(md5, ext, blob, 'text/plain');

      // Set to failed with error
      await repo.updateSyncStatus(md5, ext, 'failed', 'Some error');
      let cached = await repo.get(md5, ext);
      expect(cached?.errorMessage).toBe('Some error');

      // Change to synced - should clear error
      await repo.updateSyncStatus(md5, ext, 'synced');
      cached = await repo.get(md5, ext);
      expect(cached?.errorMessage).toBeUndefined();
    });

    it('should handle concurrent updateSyncStatus() calls without race conditions', async () => {
      const md5 = 'concurrent123456789012345678';
      const ext = 'txt';
      const blob = new Blob(['test'], { type: 'text/plain' });

      await repo.put(md5, ext, blob, 'text/plain');

      // Launch multiple concurrent updates
      const promises = [];
      const statuses: Array<'pending' | 'syncing' | 'synced'> = [
        'pending',
        'syncing',
        'synced',
      ];

      for (const status of statuses) {
        promises.push(repo.updateSyncStatus(md5, ext, status));
      }

      // Wait for all updates to complete
      await Promise.all(promises);

      // Final status should be the last one in the sequence
      const cached = await repo.get(md5, ext);
      // Due to promise chaining, the last update should win
      expect(cached?.syncStatus).toBe('synced');
    });

    it('should use atomic modify() to prevent race conditions', async () => {
      const md5 = 'atomic1234567890123456789012';
      const ext = 'txt';
      const blob = new Blob(['test'], { type: 'text/plain' });

      await repo.put(md5, ext, blob, 'text/plain');

      // Rapidly update status multiple times
      const updatePromises = [];
      for (let i = 0; i < 10; i++) {
        updatePromises.push(
          repo.updateSyncStatus(md5, ext, i % 2 === 0 ? 'syncing' : 'pending'),
        );
      }

      await Promise.all(updatePromises);

      // Should not throw and should have a valid final state
      const cached = await repo.get(md5, ext);
      expect(cached?.syncStatus).toMatch(/^(syncing|pending)$/);
    });

    it('should handle different file extensions separately', async () => {
      const md5 = 'same123456789012345678901234';
      const blob = new Blob(['test'], { type: 'text/plain' });

      // Create entries with same md5 but different extensions
      await repo.put(md5, 'txt', blob, 'text/plain');
      await repo.put(md5, 'pdf', blob, 'application/pdf');

      // Update status for txt only
      await repo.updateSyncStatus(md5, 'txt', 'syncing');

      // Verify txt is updated
      const txtCached = await repo.get(md5, 'txt');
      expect(txtCached?.syncStatus).toBe('syncing');

      // Verify pdf is unchanged
      const pdfCached = await repo.get(md5, 'pdf');
      expect(pdfCached?.syncStatus).toBe('synced');
    });

    it('should throw error with complete md5.ext identifier', async () => {
      const md5 = 'xyz12345678901234567890123456';
      const ext = 'jpeg';

      try {
        await repo.updateSyncStatus(md5, ext, 'syncing');
        expect.fail('Should have thrown an error');
      } catch (err) {
        const errorMessage = (err as Error).message;
        // Error message should contain the full identifier
        expect(errorMessage).toContain(`${md5}.${ext}`);
      }
    });
  });
});
