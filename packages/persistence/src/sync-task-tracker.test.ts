import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncTaskTracker } from './sync-task-tracker.js';

describe('SyncTaskTracker', () => {
  let tracker: SyncTaskTracker;

  beforeEach(() => {
    tracker = new SyncTaskTracker();
  });

  describe('track', () => {
    it('should register a task and return immediately', () => {
      const task = Promise.resolve();
      expect(() => tracker.track(task, 'test-task')).not.toThrow();
    });

    it('should increment pendingCount when task is registered', () => {
      expect(tracker.pendingCount).toBe(0);

      const task = new Promise<void>(() => {}); // Never resolves
      tracker.track(task, 'task-1');

      expect(tracker.pendingCount).toBe(1);
    });

    it('should track multiple tasks', () => {
      const task1 = new Promise<void>(() => {});
      const task2 = new Promise<void>(() => {});
      const task3 = new Promise<void>(() => {});

      tracker.track(task1, 'task-1');
      tracker.track(task2, 'task-2');
      tracker.track(task3, 'task-3');

      expect(tracker.pendingCount).toBe(3);
    });

    it('should auto-remove task when completed', async () => {
      let resolveTask: () => void;
      const task = new Promise<void>((resolve) => {
        resolveTask = resolve;
      });

      tracker.track(task, 'auto-remove-task');
      expect(tracker.pendingCount).toBe(1);

      resolveTask!();
      await task;

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(tracker.pendingCount).toBe(0);
    });

    it('should auto-remove task when failed', async () => {
      let rejectTask: (error: Error) => void;
      // Create a task that catches its own error
      const task = new Promise<void>((_, reject) => {
        rejectTask = reject;
      }).catch(() => {
        // Swallow error to prevent unhandled rejection
      });

      tracker.track(task, 'failing-task');
      expect(tracker.pendingCount).toBe(1);

      const error = new Error('Task failed');
      rejectTask!(error);

      // Wait for the promise to settle
      await task;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(tracker.pendingCount).toBe(0);
    });
  });

  describe('drain', () => {
    it('should return completed=true when no tasks are tracked', async () => {
      const result = await tracker.drain();
      expect(result.completed).toBe(true);
      expect(result.remainingTasks).toEqual([]);
    });

    it('should wait for all tasks to complete', async () => {
      const executionOrder: string[] = [];

      const task1 = new Promise<void>((resolve) => {
        setTimeout(() => {
          executionOrder.push('task1');
          resolve();
        }, 10);
      });

      const task2 = new Promise<void>((resolve) => {
        setTimeout(() => {
          executionOrder.push('task2');
          resolve();
        }, 20);
      });

      tracker.track(task1, 'task-1');
      tracker.track(task2, 'task-2');

      const result = await tracker.drain();

      expect(result.completed).toBe(true);
      expect(result.remainingTasks).toEqual([]);
      expect(executionOrder).toEqual(['task1', 'task2']);
    });

    it('should timeout if tasks take too long', async () => {
      vi.useFakeTimers();

      const slowTask = new Promise<void>(() => {
        // Never resolves
      });

      tracker.track(slowTask, 'slow-task');

      const drainPromise = tracker.drain(1000);

      // Fast-forward time
      vi.advanceTimersByTime(1000);

      const result = await drainPromise;

      expect(result.completed).toBe(false);
      expect(result.remainingTasks).toEqual(['slow-task']);

      vi.useRealTimers();
    });

    it('should reject new tasks after drain is called', async () => {
      const task1 = Promise.resolve();
      tracker.track(task1, 'task-1');

      // Start draining
      const drainPromise = tracker.drain();

      // Try to add new task while draining
      const task2 = Promise.resolve();
      tracker.track(task2, 'task-2'); // Should be rejected

      await drainPromise;

      // task2 should not be tracked
      expect(tracker.pendingCount).toBe(0);
    });

    it('should handle mixed completed and timeout tasks', async () => {
      vi.useFakeTimers();

      const fastTask = new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });

      const slowTask = new Promise<void>(() => {
        // Never resolves
      });

      tracker.track(fastTask, 'fast-task');
      tracker.track(slowTask, 'slow-task');

      const drainPromise = tracker.drain(500);

      // Fast-forward past timeout
      vi.advanceTimersByTime(500);

      const result = await drainPromise;

      expect(result.completed).toBe(false);
      expect(result.remainingTasks).toContain('slow-task');

      vi.useRealTimers();
    });

    it('should use default timeout of 5000ms', async () => {
      vi.useFakeTimers();

      const slowTask = new Promise<void>(() => {});
      tracker.track(slowTask, 'slow-task');

      const drainPromise = tracker.drain(); // No timeout specified

      // Should not timeout before 5000ms
      vi.advanceTimersByTime(4999);
      let settled = false;
      drainPromise.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      // Should timeout at 5000ms
      vi.advanceTimersByTime(1);
      const result = await drainPromise;
      expect(result.completed).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('closing state', () => {
    it('should reject new tasks after drain with warning', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Drain to enter closing state
      await tracker.drain();

      // Try to track new task
      const newTask = Promise.resolve();
      tracker.track(newTask, 'rejected-task');

      // Task should not be tracked
      expect(tracker.pendingCount).toBe(0);

      consoleSpy.mockRestore();
    });

    it('should allow new tasks after reset', async () => {
      await tracker.drain();

      // Should reject new tasks
      const task1 = Promise.resolve();
      tracker.track(task1, 'task-1');
      expect(tracker.pendingCount).toBe(0);

      // Reset
      tracker.reset();

      // Should accept new tasks again
      const task2 = new Promise<void>(() => {});
      tracker.track(task2, 'task-2');
      expect(tracker.pendingCount).toBe(1);
    });
  });

  describe('pendingCount', () => {
    it('should return 0 initially', () => {
      expect(tracker.pendingCount).toBe(0);
    });

    it('should reflect the number of pending tasks', () => {
      const task1 = new Promise<void>(() => {});
      const task2 = new Promise<void>(() => {});

      tracker.track(task1, 'task-1');
      expect(tracker.pendingCount).toBe(1);

      tracker.track(task2, 'task-2');
      expect(tracker.pendingCount).toBe(2);
    });

    it('should decrease as tasks complete', async () => {
      let resolveTask1: () => void;
      const task1 = new Promise<void>((resolve) => {
        resolveTask1 = resolve;
      });

      let resolveTask2: () => void;
      const task2 = new Promise<void>((resolve) => {
        resolveTask2 = resolve;
      });

      tracker.track(task1, 'task-1');
      tracker.track(task2, 'task-2');
      expect(tracker.pendingCount).toBe(2);

      resolveTask1!();
      await task1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(tracker.pendingCount).toBe(1);

      resolveTask2!();
      await task2;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(tracker.pendingCount).toBe(0);
    });
  });

  describe('reset', () => {
    it('should allow new tasks after drain', async () => {
      await tracker.drain();

      const task1 = Promise.resolve();
      tracker.track(task1, 'task-1');
      expect(tracker.pendingCount).toBe(0); // Rejected

      tracker.reset();

      const task2 = new Promise<void>(() => {});
      tracker.track(task2, 'task-2');
      expect(tracker.pendingCount).toBe(1); // Accepted
    });

    it('should not affect pending tasks', () => {
      const task = new Promise<void>(() => {});
      tracker.track(task, 'pending-task');

      expect(tracker.pendingCount).toBe(1);

      tracker.reset();

      // Task should still be pending
      expect(tracker.pendingCount).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle task that completes immediately', async () => {
      const immediateTask = Promise.resolve();
      tracker.track(immediateTask, 'immediate-task');

      // Wait for microtask
      await immediateTask;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(tracker.pendingCount).toBe(0);
    });

    it('should handle multiple drains in sequence', async () => {
      const task1 = Promise.resolve();
      tracker.track(task1, 'task-1');

      const result1 = await tracker.drain();
      expect(result1.completed).toBe(true);

      // After drain, tracker is in closing state
      const task2 = Promise.resolve();
      tracker.track(task2, 'task-2');
      expect(tracker.pendingCount).toBe(0); // Rejected

      // Reset and drain again
      tracker.reset();
      const result2 = await tracker.drain();
      expect(result2.completed).toBe(true);
    });

    it('should handle task with label containing special characters', () => {
      const task = new Promise<void>(() => {});
      expect(() =>
        tracker.track(task, 'task-with-special-chars-!@#$%^&*()'),
      ).not.toThrow();
    });
  });
});
