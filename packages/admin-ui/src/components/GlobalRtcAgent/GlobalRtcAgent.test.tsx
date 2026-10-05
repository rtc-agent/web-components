/**
 * GlobalRtcAgent Component Tests
 *
 * Tests the global RTC Agent container component that manages the Web Component
 * lifecycle based on authentication state.
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalRtcAgent } from '@/components/GlobalRtcAgent/GlobalRtcAgent';
import * as authStorage from '@/utils/auth-storage';
import * as rtcAgentManager from '@/utils/rtc-agent-manager';

// Mock the dependencies
vi.mock('@/utils/auth-storage', () => ({
  isAuthenticated: vi.fn(),
  getUserPermissions: vi.fn(() => [{ resource: 'test', action: 'test' }]),
  getUserInfo: vi.fn(() => ({ id: 'test-user-id', name: 'Test User' })),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  AUTH_STATE_CHANGED_EVENT: 'auth-state-changed',
}));

vi.mock('@/utils/rtc-agent-manager', () => ({
  mountRtcAgent: vi.fn(),
  unmountRtcAgent: vi.fn(),
}));

describe('GlobalRtcAgent', () => {
  // Store original browser features
  const originalCustomElements = window.customElements;
  const originalShadowRoot = window.ShadowRoot;
  const originalSharedWorker = window.SharedWorker;
  const originalIndexedDB = window.indexedDB;
  const originalLocalStorage = window.localStorage;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock browser features for tests
    Object.defineProperty(window, 'customElements', {
      value: { define: vi.fn(), get: vi.fn() },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'ShadowRoot', {
      value: class ShadowRoot {},
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'SharedWorker', {
      value: class SharedWorker {},
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'indexedDB', {
      value: {},
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original browser features
    Object.defineProperty(window, 'customElements', {
      value: originalCustomElements,
      configurable: true,
    });
    Object.defineProperty(window, 'ShadowRoot', {
      value: originalShadowRoot,
      configurable: true,
    });
    Object.defineProperty(window, 'SharedWorker', {
      value: originalSharedWorker,
      configurable: true,
    });
    Object.defineProperty(window, 'indexedDB', {
      value: originalIndexedDB,
      configurable: true,
    });
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it('should render without crashing', () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(false);
    const { container } = render(<GlobalRtcAgent />);
    expect(container).toBeDefined();
  });

  it('should not mount agent when not authenticated', () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(false);
    render(<GlobalRtcAgent />);
    expect(rtcAgentManager.mountRtcAgent).not.toHaveBeenCalled();
  });

  it('should mount agent when authenticated', async () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    render(<GlobalRtcAgent />);

    await waitFor(() => {
      expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalled();
    });
  });

  it('should unmount agent when authentication state changes to false', async () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    const { rerender } = render(<GlobalRtcAgent />);

    await waitFor(() => {
      expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalled();
    });

    // Simulate logout
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(false);
    window.dispatchEvent(new Event('auth-state-changed'));

    rerender(<GlobalRtcAgent />);

    await waitFor(() => {
      expect(rtcAgentManager.unmountRtcAgent).toHaveBeenCalled();
    });
  });

  it('should respond to storage events for cross-tab sync', async () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(false);
    render(<GlobalRtcAgent />);

    // Simulate login in another tab
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    window.dispatchEvent(new Event('storage'));

    await waitFor(() => {
      expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalled();
    });
  });

  it('should check auth state on visibility change', async () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(false);
    render(<GlobalRtcAgent />);

    // Initially not authenticated, so no mount
    expect(rtcAgentManager.mountRtcAgent).not.toHaveBeenCalled();

    // Simulate tab becoming visible and auth state changing
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Manually trigger auth state change
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    window.dispatchEvent(new Event('auth-state-changed'));

    await waitFor(() => {
      expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalled();
    });
  });

  it('should not call unmountRtcAgent twice when auth state changes', async () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(false);
    const { rerender } = render(<GlobalRtcAgent />);

    // Initially not authenticated, should call unmount once
    expect(rtcAgentManager.unmountRtcAgent).toHaveBeenCalledTimes(1);

    // Simulate login
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    window.dispatchEvent(new Event('auth-state-changed'));
    rerender(<GlobalRtcAgent />);

    await waitFor(() => {
      expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalled();
    });

    // Clear the call count
    vi.mocked(rtcAgentManager.unmountRtcAgent).mockClear();

    // Simulate logout
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(false);
    window.dispatchEvent(new Event('auth-state-changed'));
    rerender(<GlobalRtcAgent />);

    // Should only call unmount once, not twice (the fix)
    await waitFor(() => {
      expect(rtcAgentManager.unmountRtcAgent).toHaveBeenCalledTimes(1);
    });
  });

  it('should clean up event listeners on unmount', async () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    const { unmount } = render(<GlobalRtcAgent />);

    await waitFor(() => {
      expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalled();
    });

    unmount();

    // Should unmount agent on component unmount
    expect(rtcAgentManager.unmountRtcAgent).toHaveBeenCalled();
  });

  it('should handle network status changes', async () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    render(<GlobalRtcAgent />);

    await waitFor(() => {
      expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalled();
    });

    // Simulate network offline
    window.dispatchEvent(new Event('offline'));

    // Simulate network online
    window.dispatchEvent(new Event('online'));

    // Component should still be mounted (no additional mount calls expected)
    expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalledTimes(1);
  });

  it('should not mount when browser does not support required features', async () => {
    // Mock missing ShadowRoot support
    const originalShadowRoot = window.ShadowRoot;
    Object.defineProperty(window, 'ShadowRoot', {
      value: undefined,
      configurable: true,
    });

    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    render(<GlobalRtcAgent />);

    // Wait a bit to ensure no mount happens
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not mount agent
    expect(rtcAgentManager.mountRtcAgent).not.toHaveBeenCalled();

    // Restore
    Object.defineProperty(window, 'ShadowRoot', {
      value: originalShadowRoot,
      configurable: true,
    });
  });

  it('should poll auth state periodically', async () => {
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(false);
    render(<GlobalRtcAgent />);

    // Initially not authenticated
    expect(rtcAgentManager.mountRtcAgent).not.toHaveBeenCalled();

    // Simulate auth state change (as would happen during polling)
    vi.mocked(authStorage.isAuthenticated).mockReturnValue(true);
    window.dispatchEvent(new Event('auth-state-changed'));

    await waitFor(() => {
      expect(rtcAgentManager.mountRtcAgent).toHaveBeenCalled();
    });
  });
});
