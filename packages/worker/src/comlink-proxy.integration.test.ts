/**
 * Comlink Proxy Integration Tests
 *
 * Tests the actual Comlink proxy behavior over MessageChannel:
 * - Function argument serialization/deserialization
 * - Promise resolution and rejection across the boundary
 * - Callback proxying with Comlink.proxy()
 * - Error handling and stack traces
 * - Large payload handling
 * - Concurrent method calls
 *
 * These tests verify that the Comlink infrastructure works correctly
 * for the Worker communication pattern used in production.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { expose, wrap, proxy, releaseProxy, type Remote } from 'comlink';

/**
 * Test service that simulates a Worker-side API.
 * This mimics the pattern used by WorkerCore/WorkerBridge.
 */
class TestService {
  private data = new Map<string, any>();
  private callbacks = new Set<any>();

  // Simple method with no parameters
  async ping(): Promise<string> {
    return 'pong';
  }

  // Method with primitive parameters
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  // Method with object parameter
  async store(key: string, value: any): Promise<void> {
    this.data.set(key, value);
  }

  // Method returning stored data
  async retrieve(key: string): Promise<any> {
    return this.data.get(key);
  }

  // Method that throws an error
  async throwError(message: string): Promise<never> {
    throw new Error(`Test error: ${message}`);
  }

  // Method returning complex nested object
  async getComplexData(): Promise<{
    nested: { deep: { value: number } };
    array: number[];
    date: string;
  }> {
    return {
      nested: { deep: { value: 42 } },
      array: [1, 2, 3, 4, 5],
      date: new Date().toISOString(),
    };
  }

  // Method with callback registration
  registerCallback(cb: any): void {
    this.callbacks.add(cb);
  }

  // Method to trigger all registered callbacks
  async triggerCallbacks(payload: any): Promise<void> {
    for (const cb of this.callbacks) {
      try {
        await cb(payload);
      } catch {
        // Ignore callback errors
      }
    }
  }

  // Method that returns a Promise that resolves after a delay
  async delayedResolve(value: string, delayMs: number): Promise<string> {
    return new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
  }

  // Method that demonstrates Promise rejection
  async delayedReject(message: string, delayMs: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), delayMs),
    );
  }

  // Method with multiple parameters of different types
  async multiParam(
    str: string,
    num: number,
    bool: boolean,
    obj: { key: string },
    arr: number[],
  ): Promise<string> {
    return `${str}-${num}-${bool}-${obj.key}-${arr.join(',')}`;
  }

  // Method returning undefined
  async returnUndefined(): Promise<undefined> {
    return undefined;
  }

  // Method returning null
  async returnNull(): Promise<null> {
    return null;
  }

  // Method that processes large data
  async processLargeData(size: number): Promise<string[]> {
    const result: string[] = [];
    for (let i = 0; i < size; i++) {
      result.push(`item-${i}`);
    }
    return result;
  }

  // Method that echoes back the input (for testing serialization)
  async echo<T>(input: T): Promise<T> {
    return input;
  }
}

describe('Comlink Proxy Integration', () => {
  let channel: MessageChannel;
  let wrappedService: Remote<TestService>;

  beforeEach(() => {
    channel = new MessageChannel();
    const service = new TestService();
    expose(service, channel.port1);
    wrappedService = wrap<TestService>(channel.port2);
  });

  afterEach(() => {
    wrappedService[releaseProxy]();
    channel.port1.close();
    channel.port2.close();
  });

  describe('Basic Method Invocation', () => {
    it('should proxy simple method calls', async () => {
      const result = await wrappedService.ping();
      expect(result).toBe('pong');
    });

    it('should proxy methods with primitive parameters', async () => {
      const result = await wrappedService.add(10, 20);
      expect(result).toBe(30);
    });

    it('should proxy methods with multiple parameter types', async () => {
      const result = await wrappedService.multiParam(
        'test',
        42,
        true,
        { key: 'value' },
        [1, 2, 3],
      );
      expect(result).toBe('test-42-true-value-1,2,3');
    });
  });

  describe('Data Serialization', () => {
    it('should serialize and deserialize objects', async () => {
      const testData = {
        name: 'test',
        count: 42,
        active: true,
        tags: ['a', 'b', 'c'],
      };

      await wrappedService.store('test-key', testData);
      const retrieved = await wrappedService.retrieve('test-key');

      expect(retrieved).toEqual(testData);
    });

    it('should serialize nested objects', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };

      await wrappedService.store('nested', nested);
      const retrieved = await wrappedService.retrieve('nested');

      expect(retrieved.level1.level2.level3.value).toBe('deep');
    });

    it('should serialize arrays', async () => {
      const arr = [1, 'two', { three: 3 }, [4, 5]];

      await wrappedService.store('array', arr);
      const retrieved = await wrappedService.retrieve('array');

      expect(retrieved).toEqual(arr);
    });

    it('should handle undefined values', async () => {
      const result = await wrappedService.returnUndefined();
      expect(result).toBeUndefined();
    });

    it('should handle null values', async () => {
      const result = await wrappedService.returnNull();
      expect(result).toBeNull();
    });

    it('should echo back complex structures', async () => {
      const complex = {
        string: 'hello',
        number: 3.14,
        boolean: false,
        null: null,
        array: [1, 2, 3],
        nested: { a: { b: { c: 'd' } } },
      };

      const result = await wrappedService.echo(complex);
      expect(result).toEqual(complex);
    });
  });

  describe('Promise Handling', () => {
    it('should resolve promises correctly', async () => {
      const result = await wrappedService.delayedResolve('success', 10);
      expect(result).toBe('success');
    });

    it('should reject promises correctly', async () => {
      await expect(
        wrappedService.delayedReject('failure', 10),
      ).rejects.toThrow('failure');
    });

    it('should handle concurrent promise resolution', async () => {
      const promises = [
        wrappedService.delayedResolve('first', 30),
        wrappedService.delayedResolve('second', 20),
        wrappedService.delayedResolve('third', 10),
      ];

      const results = await Promise.all(promises);
      expect(results).toEqual(['first', 'second', 'third']);
    });

    it('should handle promise.race correctly', async () => {
      const result = await Promise.race([
        wrappedService.delayedResolve('fast', 10),
        wrappedService.delayedResolve('slow', 100),
      ]);

      expect(result).toBe('fast');
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors with correct message', async () => {
      await expect(wrappedService.throwError('test message')).rejects.toThrow(
        'Test error: test message',
      );
    });

    it('should allow error catching and recovery', async () => {
      try {
        await wrappedService.throwError('expected error');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('expected error');
      }

      // Should still work after error
      const result = await wrappedService.ping();
      expect(result).toBe('pong');
    });
  });

  describe('Callback Proxying', () => {
    it('should invoke proxied callbacks', async () => {
      let callbackInvoked = false;
      let receivedPayload: any = null;

      const proxiedCallback = proxy((payload: any) => {
        callbackInvoked = true;
        receivedPayload = payload;
      });

      wrappedService.registerCallback(proxiedCallback);

      // Wait for registration
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Trigger callbacks
      await wrappedService.triggerCallbacks({ message: 'hello', count: 42 });

      // Wait for callback invocation
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callbackInvoked).toBe(true);
      expect(receivedPayload).toEqual({ message: 'hello', count: 42 });
    });

    it('should support multiple proxied callbacks', async () => {
      const calls: any[] = [];

      const callback1 = proxy((payload: any) => {
        calls.push({ id: 1, payload });
      });

      const callback2 = proxy((payload: any) => {
        calls.push({ id: 2, payload });
      });

      wrappedService.registerCallback(callback1);
      wrappedService.registerCallback(callback2);

      await new Promise((resolve) => setTimeout(resolve, 10));

      await wrappedService.triggerCallbacks({ test: 'data' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(calls).toHaveLength(2);
      expect(calls[0].id).toBe(1);
      expect(calls[1].id).toBe(2);
    });

    it('should handle async proxied callbacks', async () => {
      let result: string | null = null;

      const asyncCallback = proxy(async (payload: any) => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 5));
        result = `processed: ${payload.value}`;
      });

      wrappedService.registerCallback(asyncCallback);

      await new Promise((resolve) => setTimeout(resolve, 10));

      await wrappedService.triggerCallbacks({ value: 'test' });

      // Wait for async callback to complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(result).toBe('processed: test');
    });
  });

  describe('Large Data Handling', () => {
    it('should handle large arrays', async () => {
      const result = await wrappedService.processLargeData(1000);
      expect(result).toHaveLength(1000);
      expect(result[999]).toBe('item-999');
    });

    it('should handle large objects', async () => {
      const largeObj: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        largeObj[`key-${i}`] = i;
      }

      await wrappedService.store('large', largeObj);
      const retrieved = await wrappedService.retrieve('large');

      expect(Object.keys(retrieved)).toHaveLength(1000);
      expect(retrieved['key-500']).toBe(500);
    });
  });

  describe('Complex Return Types', () => {
    it('should return complex nested objects', async () => {
      const result = await wrappedService.getComplexData();

      expect(result.nested.deep.value).toBe(42);
      expect(result.array).toEqual([1, 2, 3, 4, 5]);
      expect(typeof result.date).toBe('string');
    });
  });

  describe('Bidirectional Communication Pattern', () => {
    it('should support request-response pattern', async () => {
      // Store some data
      await wrappedService.store('user', {
        id: 1,
        name: 'Alice',
        preferences: { theme: 'dark' },
      });

      // Retrieve and verify
      const user = await wrappedService.retrieve('user');
      expect(user.id).toBe(1);
      expect(user.name).toBe('Alice');
      expect(user.preferences.theme).toBe('dark');
    });

    it('should support event-driven pattern with callbacks', async () => {
      const events: any[] = [];

      const eventHandler = proxy((event: any) => {
        events.push(event);
      });

      wrappedService.registerCallback(eventHandler);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Trigger multiple events
      await wrappedService.triggerCallbacks({ type: 'event1', data: 'a' });
      await wrappedService.triggerCallbacks({ type: 'event2', data: 'b' });
      await wrappedService.triggerCallbacks({ type: 'event3', data: 'c' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('event1');
      expect(events[1].type).toBe('event2');
      expect(events[2].type).toBe('event3');
    });
  });
});
