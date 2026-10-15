import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase } from './database.js';
import { initFileCacheRepository } from './file-cache-repository.js';
import type { PersistenceConfig } from './index.js';
import { PersistenceLayer } from './index.js';

/**
 * Wait for a condition to be true with timeout.
 * Replaces fixed-time waits (e.g., setTimeout(50)) with polling.
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum wait time in milliseconds (default: 1000)
 * @param interval - Polling interval in milliseconds (default: 10)
 * @param message - Error message if timeout
 */
async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 1000,
  interval = 10,
  message = 'Timeout waiting for condition',
): Promise<void> {
  const start = Date.now();
  while (true) {
    const result = await condition();
    if (result) {
      return;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`${message} (timeout: ${timeout}ms)`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Wait for all sync tasks to complete.
 * Convenience wrapper around waitForCondition for PersistenceLayer.
 *
 * @param persistence - PersistenceLayer instance
 * @param timeout - Maximum wait time in milliseconds (default: 1000)
 */
async function waitForSyncTasks(
  persistence: PersistenceLayer,
  timeout = 1000,
): Promise<void> {
  await waitForCondition(
    () => persistence.pendingSyncTaskCount === 0,
    timeout,
    10,
    'Timeout waiting for sync tasks to complete',
  );
}

describe('Fix 26: PersistenceLayer graceful shutdown', () => {
  const DB_NAME = 'rtc-agent-test-persistence-layer';
  let persistence: PersistenceLayer;
  let config: PersistenceConfig;

  beforeEach(() => {
    // Initialize database
    getDatabase(DB_NAME);

    // Reset lifecycle guard (singleton may have been closed by previous test)
    initFileCacheRepository().resetLifecycleGuard();

    config = {
      client: {
        endpoint: 'wss://test.example.com/connection',
        getToken: () => 'test-token',
        userId: 'test-user-id',
      },
      databaseName: DB_NAME,
      deviceId: 'test-device-id',
      userId: 'test-user-id',
      serverURL: 'http://localhost:8888',
    };

    persistence = new PersistenceLayer(config);
  });

  afterEach(async () => {
    await persistence.close();
    await closeDatabase();
  });

  describe('SyncTaskTracker', () => {
    it('should track active sync tasks via SyncTaskTracker', async () => {
      // Wait for initial recovery task to complete using polling
      await waitForSyncTasks(persistence);

      // Use public API to verify initial state
      expect(persistence.pendingSyncTaskCount).toBe(0);

      // Create a mock sync task
      const task = new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Track the task via public method
      persistence.trackSyncTask(task, 'test-task');

      // Verify task is being tracked
      expect(persistence.pendingSyncTaskCount).toBe(1);

      await task;
      // Wait for finally to execute using polling
      await waitForSyncTasks(persistence);

      // Verify task was removed after completion
      expect(persistence.pendingSyncTaskCount).toBe(0);
    });

    it('should remove task after completion', async () => {
      // Wait for initial recovery task to complete using polling
      await waitForSyncTasks(persistence);

      const task = Promise.resolve();

      persistence.trackSyncTask(task, 'test-task');

      expect(persistence.pendingSyncTaskCount).toBe(1);

      await task;
      await waitForSyncTasks(persistence);

      expect(persistence.pendingSyncTaskCount).toBe(0);
    });

    it('should remove task after failure', async () => {
      // Wait for initial recovery task to complete using polling
      await waitForSyncTasks(persistence);

      // Create a task that will fail
      let rejectTask: (err: Error) => void;
      const task = new Promise<void>((_, reject) => {
        rejectTask = reject;
      }).catch(() => {
        // Silently catch to prevent unhandled rejection
      });

      persistence.trackSyncTask(task, 'test-task');

      expect(persistence.pendingSyncTaskCount).toBe(1);

      // Reject the task
      rejectTask?.(new Error('Sync failed'));

      // Wait for the task to fail and be removed using polling
      await waitForSyncTasks(persistence);

      expect(persistence.pendingSyncTaskCount).toBe(0);
    });

    it('should track multiple concurrent tasks', async () => {
      // Wait for initial recovery task to complete using polling
      await waitForSyncTasks(persistence);

      const task1 = new Promise<void>((resolve) => setTimeout(resolve, 50));
      const task2 = new Promise<void>((resolve) => setTimeout(resolve, 100));
      const task3 = new Promise<void>((resolve) => setTimeout(resolve, 150));

      persistence.trackSyncTask(task1, 'task1');
      persistence.trackSyncTask(task2, 'task2');
      persistence.trackSyncTask(task3, 'task3');

      expect(persistence.pendingSyncTaskCount).toBe(3);

      await Promise.all([task1, task2, task3]);
      await waitForSyncTasks(persistence);

      expect(persistence.pendingSyncTaskCount).toBe(0);
    });
  });

  describe('close()', () => {
    it('should set closing flag', async () => {
      expect(persistence.isClosing).toBe(false);

      await persistence.close();

      expect(persistence.isClosing).toBe(true);
    });

    it('should wait for active sync tasks before closing', async () => {
      let taskCompleted = false;
      const task = new Promise<void>((resolve) => {
        setTimeout(() => {
          taskCompleted = true;
          resolve();
        }, 100);
      });

      persistence.trackSyncTask(task, 'test-task');

      // Start close (should wait for task)
      const closePromise = persistence.close();

      // Task should not be completed yet
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(taskCompleted).toBe(false);

      // Wait for close to complete
      await closePromise;

      // Task should be completed
      expect(taskCompleted).toBe(true);
    });

    it('should timeout after 5 seconds if tasks do not complete', async () => {
      // Create a task that never completes
      const neverEndingTask = new Promise<void>(() => {
        // Never resolves
      });

      persistence.trackSyncTask(neverEndingTask, 'never-ending-task');

      const startTime = Date.now();
      await persistence.close();
      const elapsed = Date.now() - startTime;

      // Should timeout after ~5 seconds
      expect(elapsed).toBeGreaterThanOrEqual(4900);
      expect(elapsed).toBeLessThan(6000);
    });

    it('should close immediately if no active tasks', async () => {
      const startTime = Date.now();
      await persistence.close();
      const elapsed = Date.now() - startTime;

      // Should close almost immediately
      expect(elapsed).toBeLessThan(100);
    });

    it('should handle multiple active tasks with mixed completion times', async () => {
      const task1Completed = { value: false };
      const task2Completed = { value: false };

      const task1 = new Promise<void>((resolve) => {
        setTimeout(() => {
          task1Completed.value = true;
          resolve();
        }, 50);
      });

      const task2 = new Promise<void>((resolve) => {
        setTimeout(() => {
          task2Completed.value = true;
          resolve();
        }, 150);
      });

      persistence.trackSyncTask(task1, 'task1');
      persistence.trackSyncTask(task2, 'task2');

      await persistence.close();

      expect(task1Completed.value).toBe(true);
      expect(task2Completed.value).toBe(true);
    });
  });

  describe('sendMessage sync task tracking', () => {
    it('should track sync task when sendMessage is called', async () => {
      // Mock client.sendMessage to delay so we can catch the task
      const mockClient = persistence.getClient();
      let resolveSendMessage: () => void;
      const sendMessagePromise = new Promise<any>((resolve) => {
        resolveSendMessage = () =>
          resolve({
            message_id: 'msg-1',
            session_id: 'session-1',
          });
      });
      vi.spyOn(mockClient, 'sendMessage').mockReturnValue(sendMessagePromise);

      // Wait for initial recovery task to complete using polling
      await waitForSyncTasks(persistence);

      expect(persistence.pendingSyncTaskCount).toBe(0);

      // Call sendMessage
      const promise = persistence.sendMessage({
        content: { type: 'text', data: 'test message' },
        messageClientId: 'msg-client-1',
        sessionClientId: 'session-1',
      });

      // Wait a bit for the sync task to be created
      await waitForCondition(
        () => persistence.pendingSyncTaskCount > 0,
        500,
        10,
        'Timeout waiting for sync task to be created',
      );

      expect(persistence.pendingSyncTaskCount).toBe(1);

      // Resolve the mocked sendMessage
      resolveSendMessage?.();

      await promise;

      // Wait for sync task to complete using polling
      await waitForSyncTasks(persistence);

      expect(persistence.pendingSyncTaskCount).toBe(0);
    });

    it('should skip sync task when closing is true', async () => {
      // Set closing state via public method
      persistence.setClosingForTest(true);

      // Mock client.sendMessage
      const mockClient = persistence.getClient();
      const sendMessageSpy = vi
        .spyOn(mockClient, 'sendMessage')
        .mockResolvedValue({
          message_id: 'msg-1',
          session_id: 'session-1',
        } as any);

      await persistence.sendMessage({
        content: { type: 'text', data: 'test message' },
        messageClientId: 'msg-client-1',
        sessionClientId: 'session-1',
      });

      // sendMessage should not be called when closing
      expect(sendMessageSpy).not.toHaveBeenCalled();

      // No sync task should be tracked
      expect(persistence.pendingSyncTaskCount).toBe(0);
    });
  });
});
