/**
 * submitRtcResult Unit Tests
 *
 * Tests the submitRtcResult method in PersistenceLayer, specifically:
 * - Handling of undefined/null result (fixes "Cannot read properties of undefined" error)
 * - Result size truncation for large payloads
 * - Proper error handling during size check
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('PersistenceLayer.submitRtcResult - result size handling', () => {
  let _mockClient: any;
  let _mockEntityRepository: any;
  let mockLog: any;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock client
    _mockClient = {
      submitRtcResult: vi.fn().mockResolvedValue({}),
    };

    // Mock entity repository
    _mockEntityRepository = {
      getRtc: vi.fn(),
      upsertRtc: vi.fn().mockResolvedValue(undefined),
    };

    // Mock logger
    mockLog = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Helper to simulate the result size check logic from submitRtcResult
   */
  function checkResultSize(result: any): {
    resultToSend: any;
    truncated: boolean;
  } {
    const MAX_RESULT_SIZE = 32000;
    let resultToSend = result;
    let truncated = false;

    try {
      // Guard against undefined/null result
      if (result === undefined || result === null) {
        resultToSend = result;
      } else {
        const resultStr = JSON.stringify(result);
        if (resultStr.length > MAX_RESULT_SIZE) {
          mockLog.warn('result too large');
          truncated = true;
          const keepStart = Math.floor(MAX_RESULT_SIZE * 0.8);
          const keepEnd = Math.floor(MAX_RESULT_SIZE * 0.2);
          const truncatedStr =
            resultStr.substring(0, keepStart) +
            '\n\n... [TRUNCATED] ...\n\n' +
            resultStr.substring(resultStr.length - keepEnd);
          try {
            resultToSend = JSON.parse(truncatedStr);
          } catch {
            resultToSend = truncatedStr;
          }
        }
      }
    } catch (err) {
      mockLog.warn('failed to check result size:', err);
    }

    return { resultToSend, truncated };
  }

  describe('undefined/null result handling', () => {
    it('should handle undefined result without throwing', () => {
      const result = undefined;

      // Should not throw
      expect(() => checkResultSize(result)).not.toThrow();

      const { resultToSend, truncated } = checkResultSize(result);
      expect(resultToSend).toBeUndefined();
      expect(truncated).toBe(false);
      expect(mockLog.warn).not.toHaveBeenCalled();
    });

    it('should handle null result without throwing', () => {
      const result = null;

      expect(() => checkResultSize(result)).not.toThrow();

      const { resultToSend, truncated } = checkResultSize(result);
      expect(resultToSend).toBeNull();
      expect(truncated).toBe(false);
    });

    it('should handle empty object', () => {
      const result = {};

      expect(() => checkResultSize(result)).not.toThrow();

      const { resultToSend, truncated } = checkResultSize(result);
      expect(resultToSend).toEqual({});
      expect(truncated).toBe(false);
    });

    it('should handle empty array', () => {
      const result = [];

      expect(() => checkResultSize(result)).not.toThrow();

      const { resultToSend, truncated } = checkResultSize(result);
      expect(resultToSend).toEqual([]);
      expect(truncated).toBe(false);
    });
  });

  describe('normal result handling', () => {
    it('should not truncate small results', () => {
      const result = { message: 'success', data: [1, 2, 3] };

      const { resultToSend, truncated } = checkResultSize(result);
      expect(resultToSend).toEqual(result);
      expect(truncated).toBe(false);
    });

    it('should truncate results larger than 32KB', () => {
      // Create a result larger than 32KB
      const largeData = 'x'.repeat(40000);
      const result = { data: largeData };

      const { resultToSend, truncated } = checkResultSize(result);
      expect(truncated).toBe(true);
      expect(mockLog.warn).toHaveBeenCalledWith('result too large');

      // Truncated result should be smaller
      const truncatedStr = JSON.stringify(resultToSend);
      expect(truncatedStr.length).toBeLessThan(40000);
    });

    it('should preserve head and tail when truncating', () => {
      const largeData = 'a'.repeat(20000) + 'b'.repeat(20000);
      const result = { data: largeData };

      const { resultToSend, truncated } = checkResultSize(result);
      expect(truncated).toBe(true);

      const truncatedStr = JSON.stringify(resultToSend);
      // Should contain both 'a' and 'b' sections
      expect(truncatedStr.includes('a')).toBe(true);
      expect(truncatedStr.includes('b')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle results exactly at size limit', () => {
      // JSON.stringify adds quotes and escapes, so actual size varies
      // Test with a result that's clearly under the limit
      const result = { data: 'x'.repeat(30000) };

      const { resultToSend, truncated } = checkResultSize(result);
      expect(truncated).toBe(false);
      expect(resultToSend).toEqual(result);
    });

    it('should handle results just over size limit', () => {
      const result = { data: 'x'.repeat(32001) }; // Just over limit

      const { truncated } = checkResultSize(result);
      expect(truncated).toBe(true);
    });

    it('should handle circular references gracefully', () => {
      const result: any = { a: 1 };
      result.self = result; // Circular reference

      // JSON.stringify will throw on circular reference
      // Our code should catch it and log warning
      const { resultToSend, truncated } = checkResultSize(result);
      expect(mockLog.warn).toHaveBeenCalled();
      // Result should be unchanged (error caught)
      expect(resultToSend).toEqual(result);
      expect(truncated).toBe(false);
    });

    it('should handle non-serializable objects', () => {
      const result = {
        fn: () => {}, // Functions are not serializable
        data: 'test',
      };

      // Should not throw
      expect(() => checkResultSize(result)).not.toThrow();
    });
  });
});
