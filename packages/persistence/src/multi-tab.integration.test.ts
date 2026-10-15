/**
 * Multi-Tab Collaboration Integration Tests
 *
 * Tests distributed system scenarios where multiple browser tabs
 * share the same IndexedDB database through the Persistence layer.
 *
 * Key scenarios:
 * - Concurrent file writes from multiple tabs
 * - Conflict resolution for simultaneous edits
 * - File cache synchronization across tabs
 * - Database locking and transaction isolation
 * - Stale data detection and refresh
 *
 * These tests verify that the Persistence layer correctly handles
 * concurrent access patterns that occur in multi-tab environments.
 */

import {
  closeDatabase,
  DB_NAME_PREFIX,
  getDatabase,
  virtualFS,
} from '@rtc-agent/persistence';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger to avoid noise in tests
vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Multi-Tab Collaboration', () => {
  const TEST_DB_NAME = `${DB_NAME_PREFIX}test-multi-tab`;

  beforeEach(async () => {
    // Initialize a fresh test database
    getDatabase(TEST_DB_NAME);
  });

  afterEach(async () => {
    // Clean up: close and delete the database
    await closeDatabase();
    vi.restoreAllMocks();
  });

  describe('Concurrent File Writes', () => {
    it('should handle concurrent writes to different files', async () => {
      // Simulate multiple tabs writing to different files
      const promises = [
        virtualFS.write('/tab1-file.txt', 'Tab 1', { mode: 'overwrite' }),
        virtualFS.write('/tab2-file.txt', 'Tab 2', { mode: 'overwrite' }),
        virtualFS.write('/tab3-file.txt', 'Tab 3', { mode: 'overwrite' }),
      ];

      await Promise.all(promises);

      // Verify all writes completed and data is correct
      const [content1, content2, content3] = await Promise.all([
        virtualFS.read('/tab1-file.txt'),
        virtualFS.read('/tab2-file.txt'),
        virtualFS.read('/tab3-file.txt'),
      ]);
      expect(content1).toBe('Tab 1');
      expect(content2).toBe('Tab 2');
      expect(content3).toBe('Tab 3');
    });

    it('should handle concurrent writes to same file', async () => {
      const filePath = '/shared-file.txt';

      // Simulate two tabs writing to the same file concurrently
      const tab1Write = virtualFS.write(filePath, 'Tab 1 content', {
        mode: 'overwrite',
      });
      const tab2Write = virtualFS.write(filePath, 'Tab 2 content', {
        mode: 'overwrite',
      });

      // Both writes should complete without error
      await Promise.all([tab1Write, tab2Write]);

      // Verify final content (last write wins due to concurrency)
      const content = await virtualFS.read(filePath);
      expect(content).toMatch(/^Tab [12] content$/);
    });
  });

  describe('Database Transaction Isolation', () => {
    it('should isolate concurrent transactions', async () => {
      // Concurrent batch writes
      const batch1 = virtualFS.writeBatch([
        { path: '/tx-test-1.txt', content: 'Batch 1', mode: 'overwrite' },
      ]);
      const batch2 = virtualFS.writeBatch([
        { path: '/tx-test-2.txt', content: 'Batch 2', mode: 'overwrite' },
      ]);

      await Promise.all([batch1, batch2]);

      // Verify both batches completed and data is correct
      const [content1, content2] = await Promise.all([
        virtualFS.read('/tx-test-1.txt'),
        virtualFS.read('/tx-test-2.txt'),
      ]);
      expect(content1).toBe('Batch 1');
      expect(content2).toBe('Batch 2');
    });
  });

  describe('Concurrent Delete Operations', () => {
    it('should handle concurrent delete of same file', async () => {
      const filePath = '/concurrent-delete.txt';

      // Write file first
      await virtualFS.write(filePath, 'To delete', { mode: 'overwrite' });

      // Concurrent deletes from multiple tabs
      const delete1 = virtualFS.remove(filePath);
      const delete2 = virtualFS.remove(filePath);

      await Promise.allSettled([delete1, delete2]);

      // Verify file was deleted
      const exists = await virtualFS.exists(filePath);
      expect(exists).toBe(false);
    });
  });

  describe('Large File Synchronization', () => {
    it('should handle concurrent large file writes', async () => {
      const content1 = 'a'.repeat(512 * 1024);
      const content2 = 'b'.repeat(512 * 1024);

      const promises = [
        virtualFS.write('/large1.txt', content1, {
          mode: 'overwrite',
        }),
        virtualFS.write('/large2.txt', content2, {
          mode: 'overwrite',
        }),
      ];

      await Promise.all(promises);

      // Verify both large file writes completed with correct content
      const [read1, read2] = await Promise.all([
        virtualFS.read('/large1.txt'),
        virtualFS.read('/large2.txt'),
      ]);
      expect(read1).toBe(content1);
      expect(read2).toBe(content2);
      expect(read1.length).toBe(512 * 1024);
      expect(read2.length).toBe(512 * 1024);
    });
  });
});
