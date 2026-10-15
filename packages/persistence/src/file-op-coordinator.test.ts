import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSyncStatus } from './file-cache-repository.js';
import { FileOpCoordinator } from './file-op-coordinator.js';

describe('FileOpCoordinator', () => {
  let coordinator: FileOpCoordinator;

  beforeEach(() => {
    coordinator = new FileOpCoordinator();
  });

  describe('onStatusChange', () => {
    it('should register a listener and return dispose function', () => {
      const listener = vi.fn();
      const dispose = coordinator.onStatusChange(listener);

      expect(typeof dispose).toBe('function');
    });

    it('should support multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      coordinator.onStatusChange(listener1);
      coordinator.onStatusChange(listener2);
      coordinator.onStatusChange(listener3);

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
    });

    it('should not duplicate same listener function when added multiple times', () => {
      const listener = vi.fn();

      coordinator.onStatusChange(listener);
      coordinator.onStatusChange(listener);

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');

      // Set deduplicates, so listener should only be called once
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyStatusChange', () => {
    it('should broadcast status change to all listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      coordinator.onStatusChange(listener1);
      coordinator.onStatusChange(listener2);

      coordinator.notifyStatusChange('abc123', 'pdf', 'uploading');

      expect(listener1).toHaveBeenCalledWith(
        'abc123',
        'pdf',
        'uploading',
        undefined,
      );
      expect(listener2).toHaveBeenCalledWith(
        'abc123',
        'pdf',
        'uploading',
        undefined,
      );
    });

    it('should pass errorMessage when provided', () => {
      const listener = vi.fn();
      coordinator.onStatusChange(listener);

      coordinator.notifyStatusChange(
        'md5-error',
        'doc',
        'failed',
        'Network error',
      );

      expect(listener).toHaveBeenCalledWith(
        'md5-error',
        'doc',
        'failed',
        'Network error',
      );
    });

    it('should not throw when no listeners are registered', () => {
      expect(() =>
        coordinator.notifyStatusChange('md5-1', 'txt', 'synced'),
      ).not.toThrow();
    });

    it('should handle various FileSyncStatus values', () => {
      const listener = vi.fn();
      coordinator.onStatusChange(listener);

      const statuses: FileSyncStatus[] = [
        'pending',
        'uploading',
        'synced',
        'failed',
      ];

      for (const status of statuses) {
        coordinator.notifyStatusChange('md5-1', 'txt', status);
      }

      expect(listener).toHaveBeenCalledTimes(4);
      expect(listener).toHaveBeenNthCalledWith(
        1,
        'md5-1',
        'txt',
        'pending',
        undefined,
      );
      expect(listener).toHaveBeenNthCalledWith(
        2,
        'md5-1',
        'txt',
        'uploading',
        undefined,
      );
      expect(listener).toHaveBeenNthCalledWith(
        3,
        'md5-1',
        'txt',
        'synced',
        undefined,
      );
      expect(listener).toHaveBeenNthCalledWith(
        4,
        'md5-1',
        'txt',
        'failed',
        undefined,
      );
    });
  });

  describe('listener removal', () => {
    it('should remove listener when dispose is called', () => {
      const listener = vi.fn();
      const dispose = coordinator.onStatusChange(listener);

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');
      expect(listener).toHaveBeenCalledTimes(1);

      dispose();

      coordinator.notifyStatusChange('md5-2', 'txt', 'synced');
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should only remove the specific listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const dispose1 = coordinator.onStatusChange(listener1);
      coordinator.onStatusChange(listener2);

      dispose1();

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple dispose calls gracefully', () => {
      const listener = vi.fn();
      const dispose = coordinator.onStatusChange(listener);

      dispose();
      dispose(); // Second call should not throw

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should not affect other listeners when one is removed', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      const dispose1 = coordinator.onStatusChange(listener1);
      coordinator.onStatusChange(listener2);
      coordinator.onStatusChange(listener3);

      dispose1();

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearAllListeners', () => {
    it('should remove all registered listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      coordinator.onStatusChange(listener1);
      coordinator.onStatusChange(listener2);
      coordinator.onStatusChange(listener3);

      coordinator.clearAllListeners();

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(listener3).not.toHaveBeenCalled();
    });

    it('should allow adding new listeners after clearing', () => {
      const listener1 = vi.fn();
      coordinator.onStatusChange(listener1);

      coordinator.clearAllListeners();

      const listener2 = vi.fn();
      coordinator.onStatusChange(listener2);

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should not throw when called with no listeners', () => {
      expect(() => coordinator.clearAllListeners()).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should catch and log errors from listeners', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const badListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      coordinator.onStatusChange(badListener);
      coordinator.onStatusChange(goodListener);

      // Should not throw
      expect(() =>
        coordinator.notifyStatusChange('md5-1', 'txt', 'synced'),
      ).not.toThrow();

      // Both listeners should have been called
      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should continue broadcasting even if one listener throws', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const listener1 = vi.fn(() => {
        throw new Error('Error 1');
      });
      const listener2 = vi.fn();
      const listener3 = vi.fn(() => {
        throw new Error('Error 2');
      });
      const listener4 = vi.fn();

      coordinator.onStatusChange(listener1);
      coordinator.onStatusChange(listener2);
      coordinator.onStatusChange(listener3);
      coordinator.onStatusChange(listener4);

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');

      // All listeners should have been called
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(listener3).toHaveBeenCalled();
      expect(listener4).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('transitionAndNotify', () => {
    it('should call repo.transitionSyncStatus with correct parameters', async () => {
      const mockRepo = {
        transitionSyncStatus: vi.fn().mockResolvedValue(true),
      };

      const result = await coordinator.transitionAndNotify(
        mockRepo as any,
        'md5-123',
        'pdf',
        'pending',
        'uploading',
      );

      expect(result).toBe(true);
      expect(mockRepo.transitionSyncStatus).toHaveBeenCalledWith(
        'md5-123',
        'pdf',
        'pending',
        'uploading',
        undefined,
      );
    });

    it('should notify listeners when transition succeeds', async () => {
      const mockRepo = {
        transitionSyncStatus: vi.fn().mockResolvedValue(true),
      };
      const listener = vi.fn();
      coordinator.onStatusChange(listener);

      await coordinator.transitionAndNotify(
        mockRepo as any,
        'md5-456',
        'doc',
        'pending',
        'synced',
      );

      expect(listener).toHaveBeenCalledWith(
        'md5-456',
        'doc',
        'synced',
        undefined,
      );
    });

    it('should not notify listeners when transition fails', async () => {
      const mockRepo = {
        transitionSyncStatus: vi.fn().mockResolvedValue(false),
      };
      const listener = vi.fn();
      coordinator.onStatusChange(listener);

      const result = await coordinator.transitionAndNotify(
        mockRepo as any,
        'md5-789',
        'txt',
        'synced',
        'uploading',
      );

      expect(result).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should pass errorMessage metadata to listeners', async () => {
      const mockRepo = {
        transitionSyncStatus: vi.fn().mockResolvedValue(true),
      };
      const listener = vi.fn();
      coordinator.onStatusChange(listener);

      await coordinator.transitionAndNotify(
        mockRepo as any,
        'md5-error',
        'pdf',
        'uploading',
        'failed',
        { errorMessage: 'Upload failed' },
      );

      expect(listener).toHaveBeenCalledWith(
        'md5-error',
        'pdf',
        'failed',
        'Upload failed',
      );
    });

    it('should handle array of from states', async () => {
      const mockRepo = {
        transitionSyncStatus: vi.fn().mockResolvedValue(true),
      };
      const listener = vi.fn();
      coordinator.onStatusChange(listener);

      await coordinator.transitionAndNotify(
        mockRepo as any,
        'md5-multi',
        'txt',
        ['pending', 'uploading'],
        'synced',
      );

      expect(mockRepo.transitionSyncStatus).toHaveBeenCalledWith(
        'md5-multi',
        'txt',
        ['pending', 'uploading'],
        'synced',
        undefined,
      );

      expect(listener).toHaveBeenCalledWith(
        'md5-multi',
        'txt',
        'synced',
        undefined,
      );
    });

    it('should pass syncedAt metadata to repo', async () => {
      const mockRepo = {
        transitionSyncStatus: vi.fn().mockResolvedValue(true),
      };

      const syncedAt = Date.now();
      await coordinator.transitionAndNotify(
        mockRepo as any,
        'md5-time',
        'pdf',
        'uploading',
        'synced',
        { syncedAt },
      );

      expect(mockRepo.transitionSyncStatus).toHaveBeenCalledWith(
        'md5-time',
        'pdf',
        'uploading',
        'synced',
        { syncedAt },
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid successive notifications', () => {
      const listener = vi.fn();
      coordinator.onStatusChange(listener);

      for (let i = 0; i < 100; i++) {
        coordinator.notifyStatusChange(`md5-${i}`, 'txt', 'synced');
      }

      expect(listener).toHaveBeenCalledTimes(100);
    });

    it('should handle listener that modifies its own state', () => {
      const state: string[] = [];
      const listener = vi.fn((md5: string) => {
        state.push(md5);
      });

      coordinator.onStatusChange(listener);

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');
      coordinator.notifyStatusChange('md5-2', 'txt', 'synced');
      coordinator.notifyStatusChange('md5-3', 'txt', 'synced');

      expect(state).toEqual(['md5-1', 'md5-2', 'md5-3']);
    });

    it('should maintain listener order', () => {
      const callOrder: number[] = [];

      const listener1 = vi.fn(() => callOrder.push(1));
      const listener2 = vi.fn(() => callOrder.push(2));
      const listener3 = vi.fn(() => callOrder.push(3));

      coordinator.onStatusChange(listener1);
      coordinator.onStatusChange(listener2);
      coordinator.onStatusChange(listener3);

      coordinator.notifyStatusChange('md5-1', 'txt', 'synced');

      // Set iteration order is insertion order in modern JS
      expect(callOrder).toEqual([1, 2, 3]);
    });
  });
});
