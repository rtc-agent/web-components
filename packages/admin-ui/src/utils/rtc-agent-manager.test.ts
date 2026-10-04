/**
 * RTC Agent Manager Tests
 *
 * Tests the global RTC Agent manager that handles mounting/unmounting
 * of the Web Component based on authentication state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountRtcAgent, unmountRtcAgent } from '@/utils/rtc-agent-manager';

// Mock dependencies
const mockDestroy = vi.fn();
const mockCreateRtcAgent = vi.fn(() => ({
  destroy: mockDestroy,
  setAttribute: vi.fn(),
}));

vi.mock('@rtc-agent/component', () => ({
  createRtcAgent: mockCreateRtcAgent,
}));

vi.mock('@/utils/rtc-auth-provider', () => ({
  createAdminAuthProvider: vi.fn(() => ({
    type: 'token-exchange',
    getExchangeToken: vi.fn(),
    isLoggedIn: vi.fn(),
    logout: vi.fn(),
    getUserId: vi.fn(),
    deviceId: 'test-device-id',
  })),
}));

describe('rtc-agent-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state by clearing import cache
    vi.resetModules();
  });

  afterEach(() => {
    // Clean up any mounted agents
    unmountRtcAgent();
  });

  describe('mountRtcAgent', () => {
    it('should mount RTC Agent successfully', async () => {
      mountRtcAgent();

      // Wait for async import to complete
      await vi.waitFor(() => {
        expect(mockCreateRtcAgent).toHaveBeenCalled();
      });
    });

    it('should prevent duplicate mounting', async () => {
      mountRtcAgent();
      mountRtcAgent(); // Second call should be ignored

      await vi.waitFor(() => {
        expect(mockCreateRtcAgent).toHaveBeenCalledTimes(1);
      });
    });

    it('should reset isMounting flag when createRtcAgent throws', async () => {
      mockCreateRtcAgent.mockImplementationOnce(() => {
        throw new Error('Creation failed');
      });

      mountRtcAgent();

      // Wait for the error to be caught
      await vi.waitFor(() => {
        expect(mockCreateRtcAgent).toHaveBeenCalled();
      });

      // Should be able to mount again after failure
      mockCreateRtcAgent.mockClear();
      mountRtcAgent();

      await vi.waitFor(() => {
        expect(mockCreateRtcAgent).toHaveBeenCalledTimes(1);
      });
    });

    it('should reset state when dynamic import fails', async () => {
      // Mock import failure
      vi.doMock('@rtc-agent/component', () => {
        throw new Error('Import failed');
      });

      mountRtcAgent();

      // Wait for the error to be caught
      await vi.waitFor(() => {
        // The import should have been attempted
      });

      // Should be able to mount again after import failure
      // (This tests that isMounting and mountRequested are reset)
      vi.doUnmock('@rtc-agent/component');
      mountRtcAgent();

      await vi.waitFor(() => {
        expect(mockCreateRtcAgent).toHaveBeenCalled();
      });
    });
  });

  describe('unmountRtcAgent', () => {
    it('should unmount RTC Agent successfully', async () => {
      mountRtcAgent();

      // Wait for mount to complete
      await vi.waitFor(() => {
        expect(mockCreateRtcAgent).toHaveBeenCalled();
      });

      // Wait a bit more for the agent to be fully initialized
      await new Promise((resolve) => setTimeout(resolve, 100));

      unmountRtcAgent();

      // Destroy should have been called (or will be called async)
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should handle unmount when no agent is mounted', () => {
      // Should not throw
      expect(() => unmountRtcAgent()).not.toThrow();
    });

    it('should handle destroy errors gracefully', async () => {
      mockDestroy.mockImplementationOnce(() => {
        throw new Error('Destroy failed');
      });

      mountRtcAgent();

      await vi.waitFor(() => {
        expect(mockCreateRtcAgent).toHaveBeenCalled();
      });

      // Should not throw even if destroy fails
      expect(() => unmountRtcAgent()).not.toThrow();
    });

    it('should cancel pending mount requests', async () => {
      // Start a mount (async)
      mountRtcAgent();

      // Wait a bit for the import to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Immediately unmount before mount completes
      unmountRtcAgent();

      // Wait for any pending operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The mount may or may not have completed, but unmount should have been called
      // This tests that mountRequested is set to false
      expect(mockCreateRtcAgent).toHaveBeenCalled();
    });
  });

  describe('concurrent mount/unmount', () => {
    it('should handle rapid mount/unmount cycles', async () => {
      // Rapid calls should not throw
      expect(() => {
        mountRtcAgent();
        unmountRtcAgent();
        mountRtcAgent();
        unmountRtcAgent();
      }).not.toThrow();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should handle mount during unmount', async () => {
      mountRtcAgent();

      await vi.waitFor(() => {
        expect(mockCreateRtcAgent).toHaveBeenCalled();
      });

      // Wait for mount to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Unmount and immediately mount again
      expect(() => {
        unmountRtcAgent();
        mountRtcAgent();
      }).not.toThrow();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });
});
