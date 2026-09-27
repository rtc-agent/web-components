import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RTCAgentClient } from './client.js';
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

    it('should correctly deduplicate updates before processing', async () => {
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

      // Verify deduplication: should only process first occurrence
      expect(mockOnPublications).toHaveBeenCalledTimes(1);
      const events = mockOnPublications.mock.calls[0][0];
      expect(events).toHaveLength(1);
      expect(events[0].offset).toBe(1); // First occurrence

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
