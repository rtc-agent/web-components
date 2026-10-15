import { beforeEach, describe, expect, it } from 'vitest';
import { LifecycleClosedError, LifecycleGuard } from './lifecycle-guard.js';

describe('LifecycleGuard', () => {
  let guard: LifecycleGuard;

  beforeEach(() => {
    guard = new LifecycleGuard('test-resource');
  });

  describe('LifecycleClosedError', () => {
    it('should have correct name and message', () => {
      const error = new LifecycleClosedError('test-db');
      expect(error.name).toBe('LifecycleClosedError');
      expect(error.message).toBe(
        'LifecycleGuard: test-db is closed, operation rejected',
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(LifecycleClosedError);
    });

    it('should be catchable as Error', () => {
      try {
        throw new LifecycleClosedError('resource');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(LifecycleClosedError);
        expect((err as LifecycleClosedError).name).toBe('LifecycleClosedError');
      }
    });
  });

  describe('assertActive', () => {
    it('should not throw before close()', () => {
      expect(() => guard.assertActive()).not.toThrow();
    });

    it('should throw LifecycleClosedError after close()', () => {
      guard.close();
      expect(() => guard.assertActive()).toThrow(LifecycleClosedError);
    });

    it('should throw with correct resource name in message', () => {
      guard.close();
      try {
        guard.assertActive();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LifecycleClosedError);
        expect((err as LifecycleClosedError).message).toContain(
          'test-resource',
        );
      }
    });
  });

  describe('isClosed', () => {
    it('should return false initially', () => {
      expect(guard.isClosed).toBe(false);
    });

    it('should return true after close()', () => {
      guard.close();
      expect(guard.isClosed).toBe(true);
    });
  });

  describe('close', () => {
    it('should allow multiple close() calls without throwing', () => {
      expect(() => {
        guard.close();
        guard.close();
        guard.close();
      }).not.toThrow();
    });

    it('should set isClosed to true', () => {
      guard.close();
      expect(guard.isClosed).toBe(true);
    });
  });

  describe('run', () => {
    it('should execute operation when active', async () => {
      const result = await guard.run(async () => 42);
      expect(result).toBe(42);
    });

    it('should return undefined when closed and no fallback provided', async () => {
      guard.close();
      const result = await guard.run(async () => 42);
      expect(result).toBeUndefined();
    });

    it('should return fallback when closed', async () => {
      guard.close();
      const result = await guard.run(async () => 42, 'fallback');
      expect(result).toBe('fallback');
    });

    it('should re-throw non-lifecycle errors', async () => {
      const error = new Error('Non-lifecycle error');
      await expect(
        guard.run(async () => {
          throw error;
        }),
      ).rejects.toThrow('Non-lifecycle error');
    });

    it('should return fallback when LifecycleClosedError occurs', async () => {
      guard.close();
      const result = await guard.run(async () => {
        throw new Error('Should not reach here');
      }, 'fallback-value');
      expect(result).toBe('fallback-value');
    });

    it('should handle async operations correctly', async () => {
      const asyncOp = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async-result';
      };

      const result = await guard.run(asyncOp);
      expect(result).toBe('async-result');
    });

    it('should handle typed operations', async () => {
      interface TestResult {
        value: number;
        label: string;
      }

      const result = await guard.run<TestResult>(async () => ({
        value: 123,
        label: 'test',
      }));

      expect(result).toEqual({ value: 123, label: 'test' });
    });
  });

  describe('multiple instances', () => {
    it('should maintain independent state', () => {
      const guard1 = new LifecycleGuard('resource-1');
      const guard2 = new LifecycleGuard('resource-2');

      guard1.close();

      expect(guard1.isClosed).toBe(true);
      expect(guard2.isClosed).toBe(false);
    });

    it('should throw with correct resource name per instance', () => {
      const guard1 = new LifecycleGuard('db-connection');
      const guard2 = new LifecycleGuard('file-handle');

      guard1.close();
      guard2.close();

      try {
        guard1.assertActive();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LifecycleClosedError);
        expect((err as LifecycleClosedError).message).toContain(
          'db-connection',
        );
      }

      try {
        guard2.assertActive();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LifecycleClosedError);
        expect((err as LifecycleClosedError).message).toContain('file-handle');
      }
    });
  });
});
