import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RTCAgentClient, GapFillTimeoutError } from './client.js';
import type { RTCAgentClientOptions } from './types.js';
import type { Update } from '@rtc-agent/protocol';

/**
 * Test suite for Issue #234: applyUpdates 事务失败后 offset 已推进 - 数据丢失
 *
 * Tests the critical fix in flushGapFillBuffer that ensures offset is only
 * advanced AFTER all data is successfully persisted, preventing data loss
 * when applyUpdates fails.
 */
describe('Issue #234: flushGapFillBuffer offset advancement', () => {
  let client: RTCAgentClient;
  let mockOptions: RTCAgentClientOptions;
  let mockUpdateOffset: ReturnType<typeof vi.fn>;
  let mockOnPublications: ReturnType<typeof vi.fn>;
  let mockOnPublication: ReturnType<typeof vi.fn>;
  let mockSuspendUIUpdates: ReturnType<typeof vi.fn>;
  let mockResumeUIUpdates: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks
    mockUpdateOffset = vi.fn().mockResolvedValue(undefined);
    mockOnPublications = vi.fn().mockResolvedValue(undefined);
    mockOnPublication = vi.fn().mockResolvedValue(undefined);
    mockSuspendUIUpdates = vi.fn();
    mockResumeUIUpdates = vi.fn();

    // Create mock options
    mockOptions = {
      endpoint: 'wss://test.example.com/connection',
      getToken: () => 'test-token',
      userId: 'test-user-id',
      getLastOffset: vi.fn().mockResolvedValue({ offset: 0, epoch: 'test-epoch' }),
      updateOffset: mockUpdateOffset,
      onPublications: mockOnPublications,
      onPublication: mockOnPublication,
      suspendUIUpdates: mockSuspendUIUpdates,
      resumeUIUpdates: mockResumeUIUpdates,
    };

    // Create client instance
    client = new RTCAgentClient(mockOptions);
  });

  // Helper to create test updates
  const createUpdate = (offset: number, entityId: string = 'test-entity'): Update => ({
    id: `update-${offset}`,
    items: [
      {
        entity: 'session',
        entity_id: entityId,
        action: 'updated',
      },
    ],
    data_list: [
      {
        id: entityId,
        client_id: entityId,
        name: `Session ${offset}`,
        status: 'active',
      },
    ],
    offset,
  });

  // Access private method for testing
  const flushGapFillBuffer = (
    channel: string,
    buffer: Update[],
    gapOffsets: number[],
    epoch: string
  ) => {
    // @ts-expect-error - accessing private method for testing
    return client.flushGapFillBuffer(channel, buffer, gapOffsets, epoch);
  };

  describe('Scenario 1: Success with both gap placeholders and real updates', () => {
    it('should advance offset to max(gapOffsets, buffer offsets) after successful applyUpdates', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      // Create buffer with updates for offsets 1, 2, 4-10
      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(2, 'session-2'),
        createUpdate(4, 'session-4'),
        createUpdate(5, 'session-5'),
        createUpdate(6, 'session-6'),
        createUpdate(7, 'session-7'),
        createUpdate(8, 'session-8'),
        createUpdate(9, 'session-9'),
        createUpdate(10, 'session-10'),
      ];

      // Gap placeholder at offset 3
      const gapOffsets = [3];

      // Execute
      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Verify onPublications was called with all updates
      expect(mockOnPublications).toHaveBeenCalledTimes(1);
      const events = mockOnPublications.mock.calls[0][0];
      expect(events).toHaveLength(9);
      expect(events.map((e: any) => e.offset)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10]);

      // Verify offset was advanced to max(3, 10) = 10
      expect(mockUpdateOffset).toHaveBeenCalledTimes(1);
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 10, epoch);

      // Verify UI updates were suspended and resumed
      expect(mockSuspendUIUpdates).toHaveBeenCalledTimes(1);
      expect(mockResumeUIUpdates).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple gap placeholders correctly', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      // Buffer with updates at offsets 1, 5, 10
      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(5, 'session-5'),
        createUpdate(10, 'session-10'),
      ];

      // Gap placeholders at offsets 2, 3, 4, 6, 7, 8, 9
      const gapOffsets = [2, 3, 4, 6, 7, 8, 9];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Offset should advance to max(9, 10) = 10
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 10, epoch);
    });
  });

  describe('Scenario 2: Failure with both gap placeholders and real updates', () => {
    it('should NOT advance offset if applyUpdates fails (CRITICAL FIX)', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      // Buffer with updates for offsets 1, 2, 4-10
      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(2, 'session-2'),
        createUpdate(4, 'session-4'),
      ];

      // Gap placeholder at offset 3
      const gapOffsets = [3];

      // Simulate transaction failure
      mockOnPublications.mockRejectedValueOnce(new Error('IndexedDB transaction failed'));

      // Execute and expect error
      await expect(flushGapFillBuffer(channel, buffer, gapOffsets, epoch)).rejects.toThrow(
        'IndexedDB transaction failed'
      );

      // CRITICAL: offset should NOT be advanced
      expect(mockUpdateOffset).not.toHaveBeenCalled();

      // Verify UI updates were still resumed (finally block)
      expect(mockResumeUIUpdates).toHaveBeenCalledTimes(1);
    });

    it('should allow retry from the same offset after failure', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(2, 'session-2'),
      ];
      const gapOffsets = [3];

      // First attempt: fails
      mockOnPublications.mockRejectedValueOnce(new Error('Transaction failed'));
      await expect(flushGapFillBuffer(channel, buffer, gapOffsets, epoch)).rejects.toThrow();
      expect(mockUpdateOffset).not.toHaveBeenCalled();

      // Second attempt: succeeds
      mockOnPublications.mockResolvedValueOnce(undefined);
      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Offset should now be advanced to max(3, 2) = 3
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 3, epoch);
    });

    it('should handle fallback path (onPublication) failure correctly', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      // Disable onPublications to force fallback path
      mockOptions.onPublications = undefined;
      client = new RTCAgentClient(mockOptions);

      const buffer: Update[] = [createUpdate(1, 'session-1')];
      const gapOffsets = [2];

      // Simulate failure in fallback path
      mockOnPublication.mockRejectedValueOnce(new Error('Fallback failed'));

      await expect(flushGapFillBuffer(channel, buffer, gapOffsets, epoch)).rejects.toThrow(
        'Fallback failed'
      );

      // Offset should NOT be advanced
      expect(mockUpdateOffset).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 3: Only gap placeholders (no real updates)', () => {
    it('should advance offset for gap-only buffer', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [];
      const gapOffsets = [3, 5, 7];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Should advance to max gap offset
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 7, epoch);

      // Should NOT call onPublications (no data to process)
      expect(mockOnPublications).not.toHaveBeenCalled();

      // Should NOT suspend/resume UI updates (no data processing)
      expect(mockSuspendUIUpdates).not.toHaveBeenCalled();
      expect(mockResumeUIUpdates).not.toHaveBeenCalled();
    });

    it('should handle single gap placeholder', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [];
      const gapOffsets = [5];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 5, epoch);
    });
  });

  describe('Scenario 4: Only real updates (no gap placeholders)', () => {
    it('should advance offset to max buffer offset when no gap placeholders', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(2, 'session-2'),
        createUpdate(3, 'session-3'),
      ];
      const gapOffsets: number[] = [];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Should advance to max buffer offset
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 3, epoch);
    });

    it('should handle non-contiguous offsets correctly', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(5, 'session-5'),
        createUpdate(10, 'session-10'),
      ];
      const gapOffsets: number[] = [];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Should advance to max buffer offset (10)
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 10, epoch);
    });
  });

  describe('Scenario 5: Empty buffer and no gap placeholders', () => {
    it('should do nothing when both buffer and gapOffsets are empty', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [];
      const gapOffsets: number[] = [];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Should NOT advance offset
      expect(mockUpdateOffset).not.toHaveBeenCalled();

      // Should NOT call any callbacks
      expect(mockOnPublications).not.toHaveBeenCalled();
      expect(mockOnPublication).not.toHaveBeenCalled();
      expect(mockSuspendUIUpdates).not.toHaveBeenCalled();
      expect(mockResumeUIUpdates).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 6: Edge cases', () => {
    it('should handle zero offset correctly', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [createUpdate(0, 'session-0')];
      const gapOffsets: number[] = [];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 0, epoch);
    });

    it('should handle large number of updates efficiently', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      // Create 1000 updates
      const buffer: Update[] = Array.from({ length: 1000 }, (_, i) =>
        createUpdate(i + 1, `session-${i + 1}`)
      );
      const gapOffsets: number[] = [];

      const startTime = performance.now();
      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);
      const elapsed = performance.now() - startTime;

      // Should complete in reasonable time (< 5 seconds)
      expect(elapsed).toBeLessThan(5000);

      // Should advance to max offset (1000)
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 1000, epoch);
    });

    it('should handle large number of gap offsets efficiently', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [createUpdate(1001, 'session-1001')];
      // Create 1000 gap offsets
      const gapOffsets: number[] = Array.from({ length: 1000 }, (_, i) => i + 1);

      const startTime = performance.now();
      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);
      const elapsed = performance.now() - startTime;

      expect(elapsed).toBeLessThan(5000);
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 1001, epoch);
    });

    it('should correctly deduplicate updates before processing (keep first and last)', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      // Create duplicate updates (same entity_id, different offsets)
      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(2, 'session-1'), // Duplicate entity
        createUpdate(3, 'session-1'), // Duplicate entity
      ];
      const gapOffsets: number[] = [];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Verify deduplication: should keep first (offset=1) and last (offset=3)
      expect(mockOnPublications).toHaveBeenCalledTimes(1);
      const events = mockOnPublications.mock.calls[0][0];
      expect(events).toHaveLength(2);
      expect(events[0].offset).toBe(1); // First occurrence (creation)
      expect(events[1].offset).toBe(3); // Last occurrence (final state)

      // Offset should still advance to max (3)
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 3, epoch);
    });
  });

  describe('Scenario 7: UI update suspension', () => {
    it('should always resume UI updates even if processing fails', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [createUpdate(1, 'session-1')];
      const gapOffsets: number[] = [];

      mockOnPublications.mockRejectedValueOnce(new Error('Processing failed'));

      await expect(flushGapFillBuffer(channel, buffer, gapOffsets, epoch)).rejects.toThrow();

      // UI updates should be resumed even on failure
      expect(mockSuspendUIUpdates).toHaveBeenCalledTimes(1);
      expect(mockResumeUIUpdates).toHaveBeenCalledTimes(1);
    });

    it('should not suspend UI updates when buffer is empty', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [];
      const gapOffsets: number[] = [1, 2, 3];

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Should not suspend/resume when no data processing
      expect(mockSuspendUIUpdates).not.toHaveBeenCalled();
      expect(mockResumeUIUpdates).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 8: Integration with offset continuity', () => {
    it('should maintain strict +1 offset continuity on success', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      // Simulate a gap fill scenario: current offset is 0, filling gaps 1-10
      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(2, 'session-2'),
        createUpdate(4, 'session-4'),
        createUpdate(5, 'session-5'),
      ];
      const gapOffsets = [3]; // Gap at offset 3

      await flushGapFillBuffer(channel, buffer, gapOffsets, epoch);

      // Offset should advance to 5, maintaining continuity
      expect(mockUpdateOffset).toHaveBeenCalledWith(channel, 5, epoch);
    });

    it('should not break continuity on failure (allows retry)', async () => {
      const channel = 'topic:u=test-user-id';
      const epoch = 'test-epoch';

      const buffer: Update[] = [
        createUpdate(1, 'session-1'),
        createUpdate(2, 'session-2'),
      ];
      const gapOffsets = [3];

      // Simulate failure
      mockOnPublications.mockRejectedValueOnce(new Error('Transaction failed'));

      await expect(flushGapFillBuffer(channel, buffer, gapOffsets, epoch)).rejects.toThrow();

      // Offset should remain at 0 (or whatever it was before)
      expect(mockUpdateOffset).not.toHaveBeenCalled();

      // This allows the retry to fetch from offset 1 again, maintaining continuity
    });
  });
});

/**
 * Test suite for Fix 24: waitForGapFill timeout throws GapFillTimeoutError
 *
 * Tests the fix that ensures waitForGapFill throws an explicit error on timeout
 * instead of silently returning, and that disconnect() properly aborts active waits.
 */
describe('Fix 24: waitForGapFill timeout and disconnect cleanup', () => {
  let client: RTCAgentClient;
  let mockOptions: RTCAgentClientOptions;
  let mockGetLastOffset: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockGetLastOffset = vi.fn();

    mockOptions = {
      endpoint: 'wss://test.example.com/connection',
      getToken: () => 'test-token',
      userId: 'test-user-id',
      getLastOffset: mockGetLastOffset,
    };

    client = new RTCAgentClient(mockOptions);
  });

  afterEach(() => {
    vi.useRealTimers();
    client.disconnect();
  });

  // Access private method for testing
  const waitForGapFill = (channel: string, targetOffset: number) => {
    // @ts-expect-error - accessing private method for testing
    return client.waitForGapFill(channel, targetOffset);
  };

  describe('GapFillTimeoutError', () => {
    it('should throw GapFillTimeoutError when timeout occurs', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      // Mock getLastOffset to always return offset less than target
      mockGetLastOffset.mockResolvedValue({ offset: 50, epoch: 'test-epoch' });

      // Mock gapFillTasks to keep gap fill "running"
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);

      // Catch the rejection immediately to avoid unhandled rejection
      const resultPromise = promise.catch(err => err);

      // Advance time past the 30 second timeout
      await vi.advanceTimersByTimeAsync(31000);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(GapFillTimeoutError);
    });

    it('should include correct channel, targetOffset, and elapsedMs in error', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      mockGetLastOffset.mockResolvedValue({ offset: 50, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);

      // Catch the rejection immediately
      const resultPromise = promise.catch(err => err);

      await vi.advanceTimersByTimeAsync(31000);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(GapFillTimeoutError);
      const gapFillError = error as GapFillTimeoutError;
      expect(gapFillError.channel).toBe(channel);
      expect(gapFillError.targetOffset).toBe(targetOffset);
      expect(gapFillError.elapsedMs).toBeGreaterThanOrEqual(30000);
      expect(gapFillError.message).toContain(channel);
      expect(gapFillError.message).toContain(targetOffset.toString());
    });

    it('should return successfully when gap fill catches up before timeout', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      // Mock offset that catches up after 5 seconds
      let callCount = 0;
      mockGetLastOffset.mockImplementation(async () => {
        callCount++;
        if (callCount < 50) {
          return { offset: 50, epoch: 'test-epoch' };
        }
        return { offset: 100, epoch: 'test-epoch' };
      });

      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);

      // Advance time to allow polling
      await vi.advanceTimersByTimeAsync(5000);

      await expect(promise).resolves.toBeUndefined();
    });

    it('should return successfully when gap fill task completes', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      mockGetLastOffset.mockResolvedValue({ offset: 50, epoch: 'test-epoch' });

      // Start with gap fill task running
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);

      // Advance time a bit, then remove the task (simulating completion)
      await vi.advanceTimersByTimeAsync(500);
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.delete(channel);

      // Flush promises and await
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('disconnect() cleanup', () => {
    it('should abort active gap fill waits on disconnect', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      mockGetLastOffset.mockResolvedValue({ offset: 50, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);
      const resultPromise = promise.catch(err => err);

      // Disconnect should abort the wait
      client.disconnect();

      // Flush promises
      await vi.runAllTimersAsync();
      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/aborted/i);
    });

    it('should clear all gap fill abort controllers on disconnect', async () => {
      const channel1 = 'topic:u=test-user-id';
      const channel2 = 'topic:u=other-user-id';

      mockGetLastOffset.mockResolvedValue({ offset: 50, epoch: 'test-epoch' });

      // Start two gap fill waits
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel1, { targetOffset: 100, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel2, { targetOffset: 200, epoch: 'test-epoch' });

      const promise1 = waitForGapFill(channel1, 100);
      const promise2 = waitForGapFill(channel2, 200);

      // Catch rejections immediately
      const result1 = promise1.catch(err => err);
      const result2 = promise2.catch(err => err);

      // @ts-expect-error - accessing private field for testing
      expect(client._gapFillAbortControllers.size).toBe(2);

      client.disconnect();

      // Flush promises
      await vi.runAllTimersAsync();

      // @ts-expect-error - accessing private field for testing
      expect(client._gapFillAbortControllers.size).toBe(0);
      await expect(result1).resolves.toBeTruthy();
      await expect(result2).resolves.toBeTruthy();
    });

    it('should allow new gap fill waits after disconnect and reconnect', async () => {
      const channel = 'topic:u=test-user-id';

      // First disconnect
      client.disconnect();

      // Simulate reconnect by creating a new client
      const newClient = new RTCAgentClient(mockOptions);

      // @ts-expect-error - accessing private field for testing
      newClient.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });
      mockGetLastOffset.mockResolvedValue({ offset: 100, epoch: 'test-epoch' });

      // @ts-expect-error - accessing private method for testing
      const promise = newClient.waitForGapFill(channel, 100);

      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).resolves.toBeUndefined();

      newClient.disconnect();
    });
  });

  describe('Edge cases', () => {
    it('should handle timeout exactly at MAX_WAIT_MS boundary', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      mockGetLastOffset.mockResolvedValue({ offset: 50, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);
      const resultPromise = promise.catch(err => err);

      // Advance to exactly 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      const error = await resultPromise;
      // Should still throw (not return silently)
      expect(error).toBeInstanceOf(GapFillTimeoutError);
    });

    it('should clean up abort controller after successful completion', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      mockGetLastOffset.mockResolvedValue({ offset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);
      await vi.advanceTimersByTimeAsync(100);

      await promise;

      // @ts-expect-error - accessing private field for testing
      expect(client._gapFillAbortControllers.has(channel)).toBe(false);
    });

    it('should clean up abort controller after timeout', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      mockGetLastOffset.mockResolvedValue({ offset: 50, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);
      const resultPromise = promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(31000);
      await resultPromise;

      // @ts-expect-error - accessing private field for testing
      expect(client._gapFillAbortControllers.has(channel)).toBe(false);
    });

    it('should clean up abort controller after abort', async () => {
      const channel = 'topic:u=test-user-id';
      const targetOffset = 100;

      mockGetLastOffset.mockResolvedValue({ offset: 50, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });

      const promise = waitForGapFill(channel, targetOffset);
      const resultPromise = promise.catch(() => {});

      client.disconnect();

      // Flush promises
      await vi.runAllTimersAsync();
      await resultPromise;

      // @ts-expect-error - accessing private field for testing
      expect(client._gapFillAbortControllers.has(channel)).toBe(false);
    });
  });
});

/**
 * Test suite for Fix 25: disconnect() clears all timers and async state
 *
 * Tests that disconnect() properly cleans up all async state including
 * gapFillTasks, processing flags, and other collections to prevent
 * zombie timers and stale state after reconnect.
 */
describe('Fix 25: disconnect() comprehensive cleanup', () => {
  let client: RTCAgentClient;
  let mockOptions: RTCAgentClientOptions;

  beforeEach(() => {
    mockOptions = {
      endpoint: 'wss://test.example.com/connection',
      getToken: () => 'test-token',
      userId: 'test-user-id',
      getLastOffset: vi.fn().mockResolvedValue({ offset: 0, epoch: 'test-epoch' }),
    };

    client = new RTCAgentClient(mockOptions);
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('gapFillTasks cleanup', () => {
    it('should clear gapFillTasks on disconnect', () => {
      const channel = 'topic:u=test-user-id';

      // Add some gap fill tasks
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private field for testing
      expect(client.gapFillTasks.size).toBe(1);

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.gapFillTasks.size).toBe(0);
    });

    it('should clear multiple gap fill tasks on disconnect', () => {
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set('channel1', { targetOffset: 100, epoch: 'epoch1' });
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set('channel2', { targetOffset: 200, epoch: 'epoch2' });
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set('channel3', { targetOffset: 300, epoch: 'epoch3' });

      // @ts-expect-error - accessing private field for testing
      expect(client.gapFillTasks.size).toBe(3);

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.gapFillTasks.size).toBe(0);
    });
  });

  describe('processing flags reset', () => {
    it('should reset isGapFillProcessing flag on disconnect', () => {
      // @ts-expect-error - accessing private field for testing
      client.isGapFillProcessing = true;

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.isGapFillProcessing).toBe(false);
    });

    it('should reset isUpdateProcessing flag on disconnect', () => {
      // @ts-expect-error - accessing private field for testing
      client.isUpdateProcessing = true;

      client.disconnect();

      // @ts-expect-error - accessing private field for testing
      expect(client.isUpdateProcessing).toBe(false);
    });

    it('should reset both processing flags on disconnect', () => {
      // @ts-expect-error - accessing private fields for testing
      client.isGapFillProcessing = true;
      // @ts-expect-error - accessing private fields for testing
      client.isUpdateProcessing = true;

      client.disconnect();

      // @ts-expect-error - accessing private fields for testing
      expect(client.isGapFillProcessing).toBe(false);
      // @ts-expect-error - accessing private fields for testing
      expect(client.isUpdateProcessing).toBe(false);
    });
  });

  describe('comprehensive cleanup verification', () => {
    it('should clean up all async state in one disconnect call', () => {
      const channel = 'topic:u=test-user-id';

      // Set up various async state
      // @ts-expect-error - accessing private fields for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private fields for testing
      client.isGapFillProcessing = true;
      // @ts-expect-error - accessing private fields for testing
      client.isUpdateProcessing = true;
      // @ts-expect-error - accessing private fields for testing
      client.pendingUpdates.push({ id: '1', items: [], data_list: [], offset: 1 });
      // @ts-expect-error - accessing private fields for testing
      client.lastOffsetCache.set(channel, 50);

      client.disconnect();

      // Verify all state is cleaned up
      // @ts-expect-error - accessing private fields for testing
      expect(client.gapFillTasks.size).toBe(0);
      // @ts-expect-error - accessing private fields for testing
      expect(client.isGapFillProcessing).toBe(false);
      // @ts-expect-error - accessing private fields for testing
      expect(client.isUpdateProcessing).toBe(false);
      // @ts-expect-error - accessing private fields for testing
      expect(client.pendingUpdates.length).toBe(0);
      // @ts-expect-error - accessing private fields for testing
      expect(client.lastOffsetCache.size).toBe(0);
      // @ts-expect-error - accessing private fields for testing
      expect(client._gapFillAbortControllers.size).toBe(0);
      // @ts-expect-error - accessing private fields for testing
      expect(client.subscriptions.size).toBe(0);
    });

    it('should allow clean reconnect after disconnect with async state', () => {
      const channel = 'topic:u=test-user-id';

      // Simulate active async operations
      // @ts-expect-error - accessing private fields for testing
      client.gapFillTasks.set(channel, { targetOffset: 100, epoch: 'test-epoch' });
      // @ts-expect-error - accessing private fields for testing
      client.isGapFillProcessing = true;
      // @ts-expect-error - accessing private fields for testing
      client.isUpdateProcessing = true;

      client.disconnect();

      // Create new client to simulate reconnect
      const newClient = new RTCAgentClient(mockOptions);

      // New client should have clean state
      // @ts-expect-error - accessing private fields for testing
      expect(newClient.gapFillTasks.size).toBe(0);
      // @ts-expect-error - accessing private fields for testing
      expect(newClient.isGapFillProcessing).toBe(false);
      // @ts-expect-error - accessing private fields for testing
      expect(newClient.isUpdateProcessing).toBe(false);

      newClient.disconnect();
    });
  });

  describe('Edge cases', () => {
    it('should handle disconnect when no async state exists', () => {
      // Should not throw
      expect(() => client.disconnect()).not.toThrow();
    });

    it('should handle multiple consecutive disconnect calls', () => {
      // @ts-expect-error - accessing private field for testing
      client.gapFillTasks.set('channel', { targetOffset: 100, epoch: 'epoch' });

      client.disconnect();
      client.disconnect(); // Second disconnect should be safe

      // @ts-expect-error - accessing private field for testing
      expect(client.gapFillTasks.size).toBe(0);
    });
  });
});

/**
 * Test suite for deduplicateUpdates: keep first and last offset updates
 *
 * Bug fix: Previously only kept the smallest offset update, causing entity state
 * to be stuck at an old value (e.g., turn stuck at "running" instead of "completed").
 *
 * Fix: Keep both the first (smallest offset) and last (largest offset) updates for
 * each entity. This ensures:
 * - First update: creation/initialization operations are executed (prerequisite)
 * - Last update: final state is correct
 * - Middle updates: discarded to reduce IndexedDB writes
 */
describe('deduplicateUpdates: keep first and last offset', () => {
  let client: RTCAgentClient;
  let mockOptions: RTCAgentClientOptions;

  beforeEach(() => {
    mockOptions = {
      endpoint: 'wss://test.example.com/connection',
      getToken: () => 'test-token',
      userId: 'test-user-id',
      getLastOffset: vi.fn().mockResolvedValue({ offset: 0, epoch: 'test-epoch' }),
    };

    client = new RTCAgentClient(mockOptions);
  });

  afterEach(() => {
    client.disconnect();
  });

  // Access private method for testing
  const deduplicateUpdates = (updates: Update[]): Update[] => {
    // @ts-expect-error - accessing private method for testing
    return client.deduplicateUpdates(updates);
  };

  // Helper to create test updates with custom entity, action, and data
  const createTestUpdate = (
    offset: number,
    entity: 'session' | 'message' | 'turn' | 'rtc' | 'file',
    entityId: string,
    action: 'created' | 'updated' | 'deleted',
    data: Record<string, unknown>
  ): Update => ({
    id: `update-${offset}`,
    items: [{ entity, entity_id: entityId, action }],
    data_list: [{ ...data, id: entityId, entity_id: entityId }],
    offset,
  });

  // ==================== Basic Scenarios ====================

  describe('Basic scenarios', () => {
    it('should return empty array for empty input', () => {
      const result = deduplicateUpdates([]);
      expect(result).toEqual([]);
    });

    it('should return single update unchanged', () => {
      const updates: Update[] = [
        createTestUpdate(1, 'session', 'session-1', 'created', { status: 'active' }),
      ];

      const result = deduplicateUpdates(updates);

      expect(result).toHaveLength(1);
      expect(result[0].offset).toBe(1);
      expect(result[0].items[0].entity).toBe('session');
      expect(result[0].items[0].entity_id).toBe('session-1');
    });

    it('should keep both first and last for two updates of same entity', () => {
      const updates: Update[] = [
        createTestUpdate(1, 'session', 'session-1', 'created', { status: 'pending' }),
        createTestUpdate(2, 'session', 'session-1', 'updated', { status: 'active' }),
      ];

      const result = deduplicateUpdates(updates);

      expect(result).toHaveLength(2);
      expect(result[0].offset).toBe(1);
      expect(result[1].offset).toBe(2);
    });

    it('should keep first and last for 5 updates of same entity', () => {
      const updates: Update[] = [
        createTestUpdate(1, 'turn', 'turn-1', 'created', { status: 'running' }),
        createTestUpdate(2, 'turn', 'turn-1', 'updated', { status: 'processing' }),
        createTestUpdate(3, 'turn', 'turn-1', 'updated', { status: 'almost_done' }),
        createTestUpdate(4, 'turn', 'turn-1', 'updated', { status: 'finishing' }),
        createTestUpdate(5, 'turn', 'turn-1', 'updated', { status: 'completed' }),
      ];

      const result = deduplicateUpdates(updates);

      // Should keep offset=1 (first/created) and offset=5 (last/completed)
      expect(result).toHaveLength(2);
      expect(result[0].offset).toBe(1);
      expect(result[0].items[0].action).toBe('created');
      expect((result[0].data_list![0] as Record<string, unknown>).status).toBe('running');
      expect(result[1].offset).toBe(5);
      expect(result[1].items[0].action).toBe('updated');
      expect((result[1].data_list![0] as Record<string, unknown>).status).toBe('completed');
    });
  });

  // ==================== Multi-Entity Scenarios ====================

  describe('Multi-entity scenarios', () => {
    it('should handle multiple entities each with multiple updates', () => {
      const updates: Update[] = [
        // Entity A: 3 updates
        createTestUpdate(1, 'session', 'session-A', 'created', { status: 'pending' }),
        createTestUpdate(3, 'session', 'session-A', 'updated', { status: 'active' }),
        createTestUpdate(5, 'session', 'session-A', 'updated', { status: 'completed' }),
        // Entity B: 2 updates
        createTestUpdate(2, 'turn', 'turn-B', 'created', { status: 'running' }),
        createTestUpdate(4, 'turn', 'turn-B', 'updated', { status: 'completed' }),
      ];

      const result = deduplicateUpdates(updates);

      // Should keep: A(1,5), B(2,4) = 4 updates total
      expect(result).toHaveLength(4);

      // Should be sorted by offset
      expect(result[0].offset).toBe(1);
      expect(result[0].items[0].entity_id).toBe('session-A');
      expect(result[1].offset).toBe(2);
      expect(result[1].items[0].entity_id).toBe('turn-B');
      expect(result[2].offset).toBe(4);
      expect(result[2].items[0].entity_id).toBe('turn-B');
      expect(result[3].offset).toBe(5);
      expect(result[3].items[0].entity_id).toBe('session-A');
    });

    it('should handle entities with single update each', () => {
      const updates: Update[] = [
        createTestUpdate(1, 'session', 'session-1', 'created', { status: 'active' }),
        createTestUpdate(2, 'turn', 'turn-1', 'created', { status: 'running' }),
        createTestUpdate(3, 'message', 'msg-1', 'created', { content: 'hello' }),
      ];

      const result = deduplicateUpdates(updates);

      // Each entity has only 1 update, so all are kept
      expect(result).toHaveLength(3);
      expect(result.map(u => u.offset)).toEqual([1, 2, 3]);
    });

    it('should handle mixed: some entities with single update, some with multiple', () => {
      const updates: Update[] = [
        createTestUpdate(1, 'session', 'session-1', 'created', { status: 'pending' }),
        createTestUpdate(2, 'turn', 'turn-1', 'created', { status: 'running' }),
        createTestUpdate(3, 'session', 'session-1', 'updated', { status: 'active' }),
        createTestUpdate(4, 'turn', 'turn-1', 'updated', { status: 'completed' }),
        createTestUpdate(5, 'message', 'msg-1', 'created', { content: 'hello' }),
        createTestUpdate(6, 'session', 'session-1', 'updated', { status: 'completed' }),
      ];

      const result = deduplicateUpdates(updates);

      // session-1: keep 1 and 6
      // turn-1: keep 2 and 4
      // msg-1: keep 5 (only one)
      expect(result).toHaveLength(5);
      expect(result.map(u => u.offset)).toEqual([1, 2, 4, 5, 6]);
    });
  });

  // ==================== Complex Scenarios ====================

  describe('Complex scenarios', () => {
    it('should handle Update with multiple items', () => {
      const update: Update = {
        id: 'multi-item-update',
        items: [
          { entity: 'session', entity_id: 'session-1', action: 'updated' },
          { entity: 'turn', entity_id: 'turn-1', action: 'updated' },
        ],
        data_list: [
          { id: 'session-1', status: 'active' },
          { id: 'turn-1', status: 'running' },
        ],
        offset: 1,
      };

      const result = deduplicateUpdates([update]);

      // Should split into separate updates for each item
      expect(result).toHaveLength(2);
      expect(result[0].items[0].entity).toBe('session');
      expect(result[1].items[0].entity).toBe('turn');
    });

    it('should handle multiple Updates with multiple items and deduplication', () => {
      const updates: Update[] = [
        {
          id: 'update-1',
          items: [
            { entity: 'session', entity_id: 'session-1', action: 'created' },
            { entity: 'turn', entity_id: 'turn-1', action: 'created' },
          ],
          data_list: [
            { id: 'session-1', status: 'pending' },
            { id: 'turn-1', status: 'running' },
          ],
          offset: 1,
        },
        {
          id: 'update-2',
          items: [
            { entity: 'session', entity_id: 'session-1', action: 'updated' },
            { entity: 'turn', entity_id: 'turn-1', action: 'updated' },
          ],
          data_list: [
            { id: 'session-1', status: 'active' },
            { id: 'turn-1', status: 'completed' },
          ],
          offset: 2,
        },
      ];

      const result = deduplicateUpdates(updates);

      // session-1: first at offset=1, last at offset=2
      // turn-1: first at offset=1, last at offset=2
      expect(result).toHaveLength(4);
      // Sorted by offset
      expect(result[0].offset).toBe(1);
      expect(result[1].offset).toBe(1);
      expect(result[2].offset).toBe(2);
      expect(result[3].offset).toBe(2);
    });

    it('should skip items with missing data_list entry', () => {
      const updates: Update[] = [
        {
          id: 'update-1',
          items: [
            { entity: 'session', entity_id: 'session-1', action: 'created' },
            { entity: 'turn', entity_id: 'turn-1', action: 'created' },
          ],
          data_list: [
            { id: 'session-1', status: 'active' },
            // Missing data for turn-1
          ],
          offset: 1,
        },
      ];

      const result = deduplicateUpdates(updates);

      // Should only keep session-1 (turn-1 has no data)
      expect(result).toHaveLength(1);
      expect(result[0].items[0].entity).toBe('session');
    });

    it('should handle empty data_list', () => {
      const updates: Update[] = [
        {
          id: 'update-1',
          items: [{ entity: 'session', entity_id: 'session-1', action: 'created' }],
          data_list: [],
          offset: 1,
        },
      ];

      const result = deduplicateUpdates(updates);

      expect(result).toHaveLength(0);
    });
  });

  // ==================== Edge Cases ====================

  describe('Edge cases', () => {
    it('should handle non-contiguous offsets', () => {
      const updates: Update[] = [
        createTestUpdate(10, 'session', 'session-1', 'created', { status: 'pending' }),
        createTestUpdate(50, 'session', 'session-1', 'updated', { status: 'active' }),
        createTestUpdate(100, 'session', 'session-1', 'updated', { status: 'completed' }),
      ];

      const result = deduplicateUpdates(updates);

      expect(result).toHaveLength(2);
      expect(result[0].offset).toBe(10);
      expect(result[1].offset).toBe(100);
    });

    it('should handle updates arriving out of order', () => {
      const updates: Update[] = [
        createTestUpdate(5, 'session', 'session-1', 'updated', { status: 'active' }),
        createTestUpdate(1, 'session', 'session-1', 'created', { status: 'pending' }),
        createTestUpdate(3, 'session', 'session-1', 'updated', { status: 'processing' }),
      ];

      const result = deduplicateUpdates(updates);

      // Should still keep first (offset=1) and last (offset=5)
      expect(result).toHaveLength(2);
      expect(result[0].offset).toBe(1);
      expect(result[1].offset).toBe(5);
    });

    it('should handle all updates with same offset (same entity)', () => {
      // This is an edge case: same entity, same offset (shouldn't happen in practice)
      const updates: Update[] = [
        createTestUpdate(1, 'session', 'session-1', 'created', { status: 'pending' }),
        createTestUpdate(1, 'session', 'session-1', 'updated', { status: 'active' }),
      ];

      const result = deduplicateUpdates(updates);

      // Since offsets are equal, first and last are the same → only 1 result
      expect(result).toHaveLength(1);
      expect(result[0].offset).toBe(1);
    });

    it('should handle large number of updates for same entity efficiently', () => {
      // 100 updates for the same entity
      const updates: Update[] = Array.from({ length: 100 }, (_, i) =>
        createTestUpdate(i + 1, 'session', 'session-1', i === 0 ? 'created' : 'updated', {
          status: i === 0 ? 'pending' : i === 99 ? 'completed' : 'processing',
          updateNumber: i + 1,
        })
      );

      const startTime = performance.now();
      const result = deduplicateUpdates(updates);
      const elapsed = performance.now() - startTime;

      // Should keep only first (offset=1) and last (offset=100)
      expect(result).toHaveLength(2);
      expect(result[0].offset).toBe(1);
      expect((result[0].data_list![0] as Record<string, unknown>).status).toBe('pending');
      expect(result[1].offset).toBe(100);
      expect((result[1].data_list![0] as Record<string, unknown>).status).toBe('completed');

      // Should be efficient (< 100ms)
      expect(elapsed).toBeLessThan(100);
    });

    it('should handle different entity types with same entity_id', () => {
      // Different entity types should be treated as different entities
      const updates: Update[] = [
        createTestUpdate(1, 'session', 'id-1', 'created', { type: 'session' }),
        createTestUpdate(2, 'turn', 'id-1', 'created', { type: 'turn' }),
        createTestUpdate(3, 'session', 'id-1', 'updated', { type: 'session-updated' }),
        createTestUpdate(4, 'turn', 'id-1', 'updated', { type: 'turn-updated' }),
      ];

      const result = deduplicateUpdates(updates);

      // session:id-1 and turn:id-1 are different entities
      expect(result).toHaveLength(4);
      expect(result.map(u => u.offset)).toEqual([1, 2, 3, 4]);
    });

    it('should preserve data integrity for first and last updates', () => {
      const updates: Update[] = [
        createTestUpdate(1, 'turn', 'turn-1', 'created', {
          status: 'running',
          message_count: 0,
          started_at: '2024-01-01T00:00:00Z',
        }),
        createTestUpdate(2, 'turn', 'turn-1', 'updated', {
          status: 'processing',
          message_count: 5,
        }),
        createTestUpdate(3, 'turn', 'turn-1', 'updated', {
          status: 'completed',
          message_count: 10,
          completed_at: '2024-01-01T00:01:00Z',
        }),
      ];

      const result = deduplicateUpdates(updates);

      expect(result).toHaveLength(2);

      // First update should have creation data
      const firstData = result[0].data_list![0] as Record<string, unknown>;
      expect(firstData.status).toBe('running');
      expect(firstData.message_count).toBe(0);
      expect(firstData.started_at).toBe('2024-01-01T00:00:00Z');

      // Last update should have final state
      const lastData = result[1].data_list![0] as Record<string, unknown>;
      expect(lastData.status).toBe('completed');
      expect(lastData.message_count).toBe(10);
      expect(lastData.completed_at).toBe('2024-01-01T00:01:00Z');
    });
  });

  // ==================== Turn Stuck Bug Scenario ====================

  describe('Bug fix: turn stuck at running state', () => {
    it('should correctly handle turn lifecycle: running → completed', () => {
      // Simulates the exact bug scenario: turn goes from running to completed
      // but gap fill was only keeping the first update (running)
      const updates: Update[] = [
        createTestUpdate(100, 'turn', 'turn-abc', 'created', { status: 'running' }),
        createTestUpdate(101, 'turn', 'turn-abc', 'updated', { status: 'running' }),
        createTestUpdate(102, 'turn', 'turn-abc', 'updated', { status: 'running' }),
        createTestUpdate(103, 'turn', 'turn-abc', 'updated', { status: 'completed' }),
      ];

      const result = deduplicateUpdates(updates);

      expect(result).toHaveLength(2);

      // First: turn created with running status
      expect(result[0].offset).toBe(100);
      expect((result[0].data_list![0] as Record<string, unknown>).status).toBe('running');

      // Last: turn updated to completed status
      expect(result[1].offset).toBe(103);
      expect((result[1].data_list![0] as Record<string, unknown>).status).toBe('completed');
    });

    it('should correctly handle message lifecycle: pending → sent → delivered', () => {
      const updates: Update[] = [
        createTestUpdate(1, 'message', 'msg-1', 'created', { streaming_status: 'pending' }),
        createTestUpdate(2, 'message', 'msg-1', 'updated', { streaming_status: 'streaming' }),
        createTestUpdate(3, 'message', 'msg-1', 'updated', { streaming_status: 'streaming' }),
        createTestUpdate(4, 'message', 'msg-1', 'updated', { streaming_status: 'completed' }),
        createTestUpdate(5, 'message', 'msg-1', 'updated', { streaming_status: 'completed' }),
      ];

      const result = deduplicateUpdates(updates);

      expect(result).toHaveLength(2);
      expect(result[0].offset).toBe(1);
      expect((result[0].data_list![0] as Record<string, unknown>).streaming_status).toBe('pending');
      expect(result[1].offset).toBe(5);
      expect((result[1].data_list![0] as Record<string, unknown>).streaming_status).toBe('completed');
    });

    it('should handle concurrent entities with different lifecycles', () => {
      // Multiple entities going through state changes simultaneously
      const updates: Update[] = [
        createTestUpdate(1, 'session', 'session-1', 'created', { status: 'active' }),
        createTestUpdate(2, 'turn', 'turn-1', 'created', { status: 'running' }),
        createTestUpdate(3, 'message', 'msg-1', 'created', { streaming_status: 'pending' }),
        createTestUpdate(4, 'turn', 'turn-1', 'updated', { status: 'running' }),
        createTestUpdate(5, 'message', 'msg-1', 'updated', { streaming_status: 'streaming' }),
        createTestUpdate(6, 'turn', 'turn-1', 'updated', { status: 'completed' }),
        createTestUpdate(7, 'message', 'msg-1', 'updated', { streaming_status: 'completed' }),
        createTestUpdate(8, 'session', 'session-1', 'updated', { status: 'active' }),
      ];

      const result = deduplicateUpdates(updates);

      // session-1: 1, 8
      // turn-1: 2, 6
      // msg-1: 3, 7
      expect(result).toHaveLength(6);

      const offsets = result.map(u => u.offset);
      expect(offsets).toEqual([1, 2, 3, 6, 7, 8]);

      // Verify final states
      const turnLast = result.find(u => u.offset === 6);
      expect((turnLast!.data_list![0] as Record<string, unknown>).status).toBe('completed');

      const msgLast = result.find(u => u.offset === 7);
      expect((msgLast!.data_list![0] as Record<string, unknown>).streaming_status).toBe('completed');
    });
  });
});
