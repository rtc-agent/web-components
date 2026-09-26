/**
 * Integration tests for `createRtcAgent` lifecycle.
 *
 * Validates end-to-end workflows from creation through destruction,
 * including authentication flows, event integration, and error recovery.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { createRtcAgent } from './factory.js';
import { cleanupFixtures } from './test-helpers.js';
import { eventBus } from './core/event-bus.js';

// Register the custom element
import './components/rtc-agent/rtc-agent.js';

describe('createRtcAgent integration', () => {
  afterEach(() => {
    cleanupFixtures();
    eventBus.clearAll();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Complete lifecycle ─────────────────────────────────────────

  describe('complete lifecycle', () => {
    it('should complete create → configure → mount → use → destroy', () => {
      const ready = vi.fn();
      const agent = createRtcAgent({
        appLabel: 'Lifecycle Test',
        theme: 'dark',
        lang: 'en-US',
        server: { url: 'https://api.example.com' },
        databaseName: 'lifecycle-db',
        on: { ready },
      });

      // Verify properties
      expect(agent.appLabel).toBe('Lifecycle Test');
      expect(agent.theme).toBe('dark');
      expect(agent.lang).toBe('en-US');
      expect(agent.serverURL).toBe('https://api.example.com');
      expect(agent.databaseName).toBe('lifecycle-db');

      // Mount to DOM
      document.body.appendChild(agent);
      expect(document.body.contains(agent)).toBe(true);

      // Trigger ready event
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      expect(ready).toHaveBeenCalledTimes(1);

      // Destroy
      agent.destroy();
      expect(document.body.contains(agent)).toBe(false);
    });

    it('should handle mount with all configuration options', () => {
      const agent = createRtcAgent({
        appLabel: 'Full Config',
        theme: 'light',
        lang: 'zh-CN',
        bubbleIcon: '<svg>test</svg>',
        server: {
          url: 'https://api.example.com',
          redirectUri: 'https://app.com/callback',
        },
        databaseName: 'test-db',
        scenariosUrl: '/scenarios',
        window: { defaultMode: 'maximized', embedded: true },
        activityBar: { disabledActivities: ['settings'], defaultActivity: 'chat' },
        agentName: 'TestAgent',
        agentDescription: 'Test description',
        persona: 'You are helpful',
      });

      document.body.appendChild(agent);

      expect(agent.appLabel).toBe('Full Config');
      expect(agent.theme).toBe('light');
      expect(agent.serverURL).toBe('https://api.example.com');
      expect(agent.redirectURI).toBe('https://app.com/callback');
      expect(agent.databaseName).toBe('test-db');
      expect(agent.scenariosURL).toBe('/scenarios');
      expect(agent.windowConfig).toEqual({ defaultMode: 'maximized', embedded: true });
      expect(agent.activityBarConfig).toEqual({ disabledActivities: ['settings'], defaultActivity: 'chat' });
      expect(agent.agentConfig).toMatchObject({
        name: 'TestAgent',
        description: 'Test description',
        persona: 'You are helpful',
      });

      agent.destroy();
    });
  });

  // ── 2. Authentication flow integration ─────────────────────────────

  describe('authentication flows', () => {
    it('should handle StaticTokenAuth integration', () => {
      const agent = createRtcAgent({
        auth: {
          accessToken: 'static-token-123',
          refreshToken: 'refresh-token-456',
          userId: 'user-789',
          expiresIn: 3600,
        },
      });

      // Verify pending auth config BEFORE mount (connectedCallback clears it)
      expect(agent._pendingAuthConfig).toBeDefined();
      expect(agent._pendingAuthConfig!.accessToken).toBe('static-token-123');
      expect(agent._pendingAuthConfig!.refreshToken).toBe('refresh-token-456');
      expect(agent._pendingAuthConfig!.userId).toBe('user-789');
      expect(agent._pendingAuthConfig!.expiresIn).toBe(3600);

      document.body.appendChild(agent);

      agent.destroy();
    });

    it('should handle DynamicTokenAuth integration', () => {
      const getToken = vi.fn().mockReturnValue('dynamic-token');
      const refreshToken = vi.fn().mockResolvedValue({ accessToken: 'new-token' });

      const agent = createRtcAgent({
        auth: {
          getToken,
          refreshToken,
          userId: 'dynamic-user',
        },
      });

      // Verify pending dynamic auth BEFORE mount
      expect(agent._pendingDynamicAuth).toBeDefined();
      expect(agent._pendingDynamicAuth!.getToken).toBe(getToken);
      expect(agent._pendingDynamicAuth!.refreshToken).toBe(refreshToken);
      expect(agent._pendingDynamicAuth!.userId).toBe('dynamic-user');

      document.body.appendChild(agent);

      agent.destroy();
    });

    it('should handle AuthProvider integration', () => {
      const authProvider = {
        getToken: vi.fn().mockReturnValue('provider-token'),
        refreshToken: vi.fn().mockResolvedValue({ accessToken: 'refreshed-token' }),
        isLoggedIn: vi.fn().mockReturnValue(true),
        logout: vi.fn().mockResolvedValue(undefined),
      };

      const agent = createRtcAgent({ auth: authProvider });

      // Verify pending auth provider BEFORE mount
      expect(agent._pendingAuthProvider).toBeDefined();
      expect(agent._pendingAuthProvider!.getToken).toBe(authProvider.getToken);
      expect(agent._pendingAuthProvider!.refreshToken).toBe(authProvider.refreshToken);
      expect(agent._pendingAuthProvider!.isLoggedIn).toBe(authProvider.isLoggedIn);
      expect(agent._pendingAuthProvider!.logout).toBe(authProvider.logout);

      document.body.appendChild(agent);

      agent.destroy();
    });
  });

  // ── 3. Event system integration ────────────────────────────────────

  describe('event system integration', () => {
    it('should handle multiple callbacks simultaneously', () => {
      const ready = vi.fn();
      const sessionCreated = vi.fn();
      const messageReceived = vi.fn();
      const toolCallStart = vi.fn();

      const agent = createRtcAgent({
        on: { ready, sessionCreated, messageReceived, toolCallStart },
      });

      document.body.appendChild(agent);

      // Trigger DOM events
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      expect(ready).toHaveBeenCalledTimes(1);

      const mockSession = { id: 'session-1', title: 'Test', createdAt: new Date() };
      agent.dispatchEvent(new CustomEvent('rtc-session-created', { detail: { session: mockSession } }));
      expect(sessionCreated).toHaveBeenCalledTimes(1);

      const mockMessage = { id: 'msg-1', content: 'Hello', role: 'user' as const, timestamp: new Date() };
      agent.dispatchEvent(new CustomEvent('rtc-message-received', { detail: { message: mockMessage } }));
      expect(messageReceived).toHaveBeenCalledTimes(1);

      // Trigger EventBus event
      eventBus.emit('function:start', { path: 'test.fn', params: { arg: 'value' } });
      expect(toolCallStart).toHaveBeenCalledWith({ path: 'test.fn', params: { arg: 'value' } });

      agent.destroy();
    });

    it('should bridge EventBus events to callbacks', () => {
      const toolCallStart = vi.fn();
      const toolCallSuccess = vi.fn();
      const toolCallError = vi.fn();
      const toolCallProgress = vi.fn();

      const agent = createRtcAgent({
        on: { toolCallStart, toolCallSuccess, toolCallError, toolCallProgress },
      });

      document.body.appendChild(agent);

      // function:start
      eventBus.emit('function:start', { path: 'group/func1', params: { x: 1 } });
      expect(toolCallStart).toHaveBeenCalledWith({ path: 'group/func1', params: { x: 1 } });

      // function:success
      eventBus.emit('function:success', { path: 'group/func1', result: 'done' });
      expect(toolCallSuccess).toHaveBeenCalledWith({ path: 'group/func1', result: 'done' });

      // function:error
      const error = new Error('Test error');
      eventBus.emit('function:error', { path: 'group/func1', error });
      expect(toolCallError).toHaveBeenCalledWith({ path: 'group/func1', error });

      // function:progress
      eventBus.emit('function:progress', { path: 'group/func1', progress: 75 });
      expect(toolCallProgress).toHaveBeenCalledWith({ path: 'group/func1', progress: 75 });

      agent.destroy();
    });

    it('should not trigger events after destroy', () => {
      const ready = vi.fn();
      const toolCallStart = vi.fn();

      const agent = createRtcAgent({
        on: { ready, toolCallStart },
      });

      document.body.appendChild(agent);

      // Verify callbacks work
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      eventBus.emit('function:start', { path: 'test.fn', params: {} });
      expect(ready).toHaveBeenCalledTimes(1);
      expect(toolCallStart).toHaveBeenCalledTimes(1);

      // Destroy
      agent.destroy();

      // Clear mocks
      ready.mockClear();
      toolCallStart.mockClear();

      // Events after destroy should not trigger
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      eventBus.emit('function:start', { path: 'test.fn', params: {} });

      expect(ready).not.toHaveBeenCalled();
      expect(toolCallStart).not.toHaveBeenCalled();
    });
  });

  // ── 4. beforeMessageSend integration ───────────────────────────────

  describe('beforeMessageSend integration', () => {
    it('should intercept messages with beforeMessageSend', async () => {
      const beforeMessageSend = vi.fn().mockReturnValue(true);

      const agent = createRtcAgent({
        on: { beforeMessageSend },
      });

      document.body.appendChild(agent);

      expect(agent._beforeMessageSendHook).toBeDefined();

      const detail = { message: { content: 'test message' } };
      const result = await agent._beforeMessageSendHook!(detail);

      expect(beforeMessageSend).toHaveBeenCalledWith(detail);
      expect(result).toBe(true);

      agent.destroy();
    });

    it('should support async beforeMessageSend', async () => {
      const beforeMessageSend = vi.fn().mockResolvedValue(true);

      const agent = createRtcAgent({
        on: { beforeMessageSend },
      });

      document.body.appendChild(agent);

      const detail = { message: { content: 'async test' } };
      const result = await agent._beforeMessageSendHook!(detail);

      expect(beforeMessageSend).toHaveBeenCalledWith(detail);
      expect(result).toBe(true);

      agent.destroy();
    });

    it('should cancel message when beforeMessageSend returns false', async () => {
      const beforeMessageSend = vi.fn().mockReturnValue(false);

      const agent = createRtcAgent({
        on: { beforeMessageSend },
      });

      document.body.appendChild(agent);

      const detail = { message: { content: 'cancelled message' } };
      const result = await agent._beforeMessageSendHook!(detail);

      expect(beforeMessageSend).toHaveBeenCalledWith(detail);
      expect(result).toBe(false);

      agent.destroy();
    });
  });

  // ── 5. Error recovery ──────────────────────────────────────────────

  describe('error recovery', () => {
    it('should handle invalid configuration without crashing', () => {
      expect(() => {
        createRtcAgent({
          appLabel: 'Invalid Test',
          server: { url: '' },
          databaseName: '',
          window: undefined,
        });
      }).not.toThrow();
    });

    it('should handle destroy called twice without throwing', () => {
      const agent = createRtcAgent({ appLabel: 'Double Destroy Test' });

      document.body.appendChild(agent);

      expect(() => agent.destroy()).not.toThrow();
      expect(() => agent.destroy()).not.toThrow();
    });

    it('should handle destroy without being mounted', () => {
      const agent = createRtcAgent({ appLabel: 'Unmounted Destroy' });

      expect(() => agent.destroy()).not.toThrow();
    });

    it('should handle empty event callbacks', () => {
      const agent = createRtcAgent({ on: {} });

      document.body.appendChild(agent);

      expect(agent._eventUnsubscribes).toEqual([]);
      expect(agent._eventBusUnsubscribes).toEqual([]);

      agent.destroy();
    });
  });

  // ── 6. Additional integration scenarios ────────────────────────────

  describe('additional integration scenarios', () => {
    it('should handle complete config with all auth modes and events', () => {
      const ready = vi.fn();
      const sessionCreated = vi.fn();
      const toolCallStart = vi.fn();
      const beforeMessageSend = vi.fn().mockReturnValue(true);

      const agent = createRtcAgent({
        appLabel: 'Complete Integration',
        theme: 'dark',
        lang: 'en-US',
        server: {
          url: 'https://api.example.com',
          redirectUri: 'https://app.com/callback',
        },
        databaseName: 'integration-db',
        scenariosUrl: '/scenarios',
        window: { defaultMode: 'normal', embedded: false },
        activityBar: { disabledActivities: ['files'], defaultActivity: 'chat' },
        agentName: 'IntegrationAgent',
        agentDescription: 'Complete integration test',
        persona: 'You are an integration tester',
        auth: {
          accessToken: 'integration-token',
          userId: 'integration-user',
          expiresIn: 7200,
        },
        on: {
          ready,
          sessionCreated,
          toolCallStart,
          beforeMessageSend,
        },
      });

      // Verify all configurations (check pending auth BEFORE mount)
      expect(agent.appLabel).toBe('Complete Integration');
      expect(agent.theme).toBe('dark');
      expect(agent.lang).toBe('en-US');
      expect(agent.serverURL).toBe('https://api.example.com');
      expect(agent.redirectURI).toBe('https://app.com/callback');
      expect(agent.databaseName).toBe('integration-db');
      expect(agent.scenariosURL).toBe('/scenarios');
      expect(agent._pendingAuthConfig).toBeDefined();
      expect(agent._pendingAuthConfig!.accessToken).toBe('integration-token');

      document.body.appendChild(agent);

      // Verify event callbacks
      expect(agent._eventUnsubscribes).toBeDefined();
      expect(agent._eventBusUnsubscribes).toBeDefined();
      expect(agent._beforeMessageSendHook).toBeDefined();

      // Trigger events
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      expect(ready).toHaveBeenCalledTimes(1);

      const mockSession = { id: 'session-1', title: 'Integration', createdAt: new Date() };
      agent.dispatchEvent(new CustomEvent('rtc-session-created', { detail: { session: mockSession } }));
      expect(sessionCreated).toHaveBeenCalledTimes(1);

      eventBus.emit('function:start', { path: 'test.fn', params: {} });
      expect(toolCallStart).toHaveBeenCalledTimes(1);

      agent.destroy();
    });

    it('should handle multiple agents independently', () => {
      const ready1 = vi.fn();
      const ready2 = vi.fn();

      const agent1 = createRtcAgent({
        appLabel: 'Agent 1',
        on: { ready: ready1 },
      });

      const agent2 = createRtcAgent({
        appLabel: 'Agent 2',
        on: { ready: ready2 },
      });

      document.body.appendChild(agent1);
      document.body.appendChild(agent2);

      expect(agent1.appLabel).toBe('Agent 1');
      expect(agent2.appLabel).toBe('Agent 2');

      agent1.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      expect(ready1).toHaveBeenCalledTimes(1);
      expect(ready2).not.toHaveBeenCalled();

      agent2.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      expect(ready2).toHaveBeenCalledTimes(1);

      agent1.destroy();
      agent2.destroy();

      expect(document.body.contains(agent1)).toBe(false);
      expect(document.body.contains(agent2)).toBe(false);
    });

    it('should handle agent with only basic properties', () => {
      const agent = createRtcAgent({
        appLabel: 'Minimal',
        theme: 'light',
      });

      document.body.appendChild(agent);

      expect(agent.appLabel).toBe('Minimal');
      expect(agent.theme).toBe('light');
      expect(agent._pendingAuthConfig).toBeUndefined();
      expect(agent._pendingDynamicAuth).toBeUndefined();
      expect(agent._pendingAuthProvider).toBeUndefined();
      expect(agent._eventUnsubscribes).toBeUndefined();
      expect(agent._eventBusUnsubscribes).toBeUndefined();
      expect(agent._beforeMessageSendHook).toBeUndefined();

      agent.destroy();
    });
  });
});
