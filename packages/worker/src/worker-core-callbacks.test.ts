/**
 * WorkerCore Callback Management Tests
 *
 * Tests for:
 * - registerCallback
 * - unregisterCallback
 * - broadcastUIUpdate
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerCore } from './worker-core.js';

// Mock dependencies
vi.mock('@rtc-agent/persistence', () => ({
  virtualFS: {
    write: vi.fn(),
    writeBatch: vi.fn(),
    remove: vi.fn(),
  },
  getDatabase: vi.fn(),
  initializeVirtualFS: vi.fn(),
}));

vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('WorkerCore - Callback Management', () => {
  let workerCore: WorkerCore;

  beforeEach(() => {
    vi.clearAllMocks();
    workerCore = new WorkerCore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerCallback()', () => {
    it('should add callback to callbacks set', () => {
      const callback = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      workerCore.registerCallback(callback);

      // @ts-expect-error - accessing private field for testing
      expect(workerCore.callbacks.has(callback)).toBe(true);
    });

    it('should increment callbackCount', () => {
      const callback = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      expect(workerCore.callbackCount).toBe(0);
      workerCore.registerCallback(callback);
      expect(workerCore.callbackCount).toBe(1);
    });
  });

  describe('unregisterCallback()', () => {
    it('should remove callback from callbacks set', () => {
      const callback = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      workerCore.registerCallback(callback);
      expect(workerCore.callbackCount).toBe(1);

      workerCore.unregisterCallback(callback);
      // @ts-expect-error - accessing private field for testing
      expect(workerCore.callbacks.has(callback)).toBe(false);
      expect(workerCore.callbackCount).toBe(0);
    });

    it('should handle unregistering non-existent callback gracefully', () => {
      const callback = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      // Should not throw
      expect(() => workerCore.unregisterCallback(callback)).not.toThrow();
    });
  });

  describe('broadcastUIUpdate()', () => {
    it('should call onUIUpdate on all registered callbacks', () => {
      const callback1 = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };
      const callback2 = {
        onUIUpdate: vi.fn(),
        requestToken: vi.fn(),
      };

      workerCore.registerCallback(callback1);
      workerCore.registerCallback(callback2);

      // Access private method for testing
      // @ts-expect-error - accessing private method for testing
      workerCore.broadcastUIUpdate({
        entity: 'test',
        action: 'updated',
        entityId: '1',
        field: 'test',
        oldValue: undefined,
        newValue: 'test',
      });

      expect(callback1.onUIUpdate).toHaveBeenCalled();
      expect(callback2.onUIUpdate).toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', () => {
      const callback = {
        onUIUpdate: vi.fn().mockImplementation(() => {
          throw new Error('Callback error');
        }),
        requestToken: vi.fn(),
      };

      workerCore.registerCallback(callback);

      // Should not throw even if callback throws
      // @ts-expect-error - accessing private method for testing
      expect(() => workerCore.broadcastUIUpdate({
        entity: 'test',
        action: 'updated',
        entityId: '1',
        field: 'test',
        oldValue: undefined,
        newValue: 'test',
      })).not.toThrow();
    });
  });
});
