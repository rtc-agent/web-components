import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PersistenceLayer } from './index.js';
import type { PersistenceConfig } from './index.js';
import { getDatabase, closeDatabase } from './database.js';
import { getFileCacheRepository, initFileCacheRepository } from './file-cache-repository.js';

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
    it('should track active sync tasks via _syncTaskTracker', async () => {
      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;

      // Wait for initial recovery task to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(0);

      // Create a mock sync task
      const task = new Promise<void>(resolve => setTimeout(resolve, 100));

      // Track the task
      tracker.track(task, 'test-task');

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(1);

      await task;
      // Wait for finally to execute
      await new Promise(resolve => setTimeout(resolve, 10));

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(0);
    });

    it('should remove task after completion', async () => {
      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;

      // Wait for initial recovery task to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      const task = Promise.resolve();

      tracker.track(task, 'test-task');

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(1);

      await task;
      await new Promise(resolve => setTimeout(resolve, 10));

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(0);
    });

    it('should remove task after failure', async () => {
      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;

      // Wait for initial recovery task to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create a task that will fail
      let rejectTask: (err: Error) => void;
      const task = new Promise<void>((_, reject) => {
        rejectTask = reject;
      }).catch(() => {
        // Silently catch to prevent unhandled rejection
      });

      tracker.track(task, 'test-task');

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(1);

      // Reject the task
      rejectTask!(new Error('Sync failed'));

      // Wait for the task to fail and be removed
      await task;
      await new Promise(resolve => setTimeout(resolve, 10));

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(0);
    });

    it('should track multiple concurrent tasks', async () => {
      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;

      // Wait for initial recovery task to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      const task1 = new Promise<void>(resolve => setTimeout(resolve, 50));
      const task2 = new Promise<void>(resolve => setTimeout(resolve, 100));
      const task3 = new Promise<void>(resolve => setTimeout(resolve, 150));

      tracker.track(task1, 'task1');
      tracker.track(task2, 'task2');
      tracker.track(task3, 'task3');

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(3);

      await Promise.all([task1, task2, task3]);
      await new Promise(resolve => setTimeout(resolve, 10));

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(0);
    });
  });

  describe('close()', () => {
    it('should set _closing flag', async () => {
      // @ts-expect-error - accessing private field for testing
      expect(persistence._closing).toBe(false);

      await persistence.close();

      // @ts-expect-error - accessing private field for testing
      expect(persistence._closing).toBe(true);
    });

    it('should wait for active sync tasks before closing', async () => {
      let taskCompleted = false;
      const task = new Promise<void>(resolve => {
        setTimeout(() => {
          taskCompleted = true;
          resolve();
        }, 100);
      });

      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;
      tracker.track(task, 'test-task');

      // Start close (should wait for task)
      const closePromise = persistence.close();

      // Task should not be completed yet
      await new Promise(resolve => setTimeout(resolve, 50));
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

      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;
      tracker.track(neverEndingTask, 'never-ending-task');

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

      const task1 = new Promise<void>(resolve => {
        setTimeout(() => {
          task1Completed.value = true;
          resolve();
        }, 50);
      });

      const task2 = new Promise<void>(resolve => {
        setTimeout(() => {
          task2Completed.value = true;
          resolve();
        }, 150);
      });

      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;
      tracker.track(task1, 'task1');
      tracker.track(task2, 'task2');

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
      const sendMessagePromise = new Promise<any>(resolve => {
        resolveSendMessage = () => resolve({
          message_id: 'msg-1',
          session_id: 'session-1',
        });
      });
      vi.spyOn(mockClient, 'sendMessage').mockReturnValue(sendMessagePromise);

      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;

      // Wait for initial recovery task to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(0);

      // Call sendMessage
      const promise = persistence.sendMessage({
        content: { type: 'text', data: 'test message' },
        messageClientId: 'msg-client-1',
        sessionClientId: 'session-1',
      });

      // Wait a bit for the sync task to be created
      await new Promise(resolve => setTimeout(resolve, 50));

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(1);

      // Resolve the mocked sendMessage
      resolveSendMessage!();

      await promise;

      // Wait for sync task to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(0);
    });

    it('should skip sync task when _closing is true', async () => {
      // @ts-expect-error - accessing private field for testing
      persistence._closing = true;

      // Mock client.sendMessage
      const mockClient = persistence.getClient();
      const sendMessageSpy = vi.spyOn(mockClient, 'sendMessage').mockResolvedValue({
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

      // @ts-expect-error - accessing private field for testing
      const tracker = persistence._syncTaskTracker;
      // @ts-expect-error - accessing private field for testing
      expect(tracker._tasks.size).toBe(0);
    });
  });
});
