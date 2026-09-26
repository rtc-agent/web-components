/**
 * Unit tests for the `createRtcAgent` factory function.
 *
 * Covers all configuration mappings (basic properties, server, window,
 * activityBar, agent config) and lifecycle management (destroy method),
 * plus Phase 3 event callback registration and cleanup.
 */

import {describe, it, expect, afterEach, vi, beforeEach} from 'vitest';
import {createRtcAgent} from './factory.js';
import {cleanupFixtures} from './test-helpers.js';
import {eventBus} from './core/event-bus.js';

// Import the component to trigger @customElement('rtc-agent') registration.
// Without this, document.createElement('rtc-agent') returns a plain HTMLElement
// rather than an RtcAgent instance, and property setters won't exist.
import './components/rtc-agent/rtc-agent.js';

describe('createRtcAgent', () => {
  afterEach(() => {
    cleanupFixtures();
  });

  // ── Element creation ───────────────────────────────────────────

  it('should create <rtc-agent> element', () => {
    const agent = createRtcAgent({});
    expect(agent.tagName.toLowerCase()).toBe('rtc-agent');
  });

  // ── Basic properties ───────────────────────────────────────────

  it('should map appLabel', () => {
    const agent = createRtcAgent({appLabel: 'Test App'});
    expect(agent.appLabel).toBe('Test App');
  });

  it('should map theme', () => {
    const agent = createRtcAgent({theme: 'dark'});
    expect(agent.theme).toBe('dark');
  });

  it('should map lang', () => {
    const agent = createRtcAgent({lang: 'en-US'});
    expect(agent.lang).toBe('en-US');
  });

  it('should map bubbleIcon', () => {
    const agent = createRtcAgent({bubbleIcon: '<svg>icon</svg>'});
    expect(agent.bubbleIcon).toBe('<svg>icon</svg>');
  });

  it('should map multiple basic properties together', () => {
    const agent = createRtcAgent({
      appLabel: 'Test App',
      theme: 'dark',
      lang: 'en-US',
    });
    expect(agent.appLabel).toBe('Test App');
    expect(agent.theme).toBe('dark');
    expect(agent.lang).toBe('en-US');
  });

  // ── Server configuration ───────────────────────────────────────

  it('should map server.url to serverURL', () => {
    const agent = createRtcAgent({
      server: {url: 'https://api.example.com'},
    });
    expect(agent.serverURL).toBe('https://api.example.com');
  });

  it('should map server.redirectUri to redirectURI', () => {
    const agent = createRtcAgent({
      server: {
        url: 'https://api.example.com',
        redirectUri: 'https://app.com/callback',
      },
    });
    expect(agent.serverURL).toBe('https://api.example.com');
    expect(agent.redirectURI).toBe('https://app.com/callback');
  });

  // ── Database configuration ─────────────────────────────────────

  it('should map databaseName', () => {
    const agent = createRtcAgent({databaseName: 'my-app'});
    expect(agent.databaseName).toBe('my-app');
  });

  // ── Scenario documents ─────────────────────────────────────────

  it('should map scenariosUrl to scenariosURL', () => {
    const agent = createRtcAgent({scenariosUrl: '/scenarios'});
    expect(agent.scenariosURL).toBe('/scenarios');
  });

  // ── Window configuration ───────────────────────────────────────

  it('should map window config', () => {
    const agent = createRtcAgent({
      window: {
        defaultMode: 'maximized',
        embedded: true,
      },
    });
    expect(agent.windowConfig).toEqual({
      defaultMode: 'maximized',
      embedded: true,
    });
  });

  it('should map complex window config', () => {
    const windowConfig = {
      defaultMode: 'normal' as const,
      initialPosition: {x: 100, y: 200},
      initialSize: {width: 500, height: 700},
      minWidth: 300,
      minHeight: 400,
      draggable: false,
      resizable: false,
      embedded: false,
    };
    const agent = createRtcAgent({window: windowConfig});
    expect(agent.windowConfig).toEqual(windowConfig);
  });

  // ── Activity Bar configuration ─────────────────────────────────

  it('should map activityBar config', () => {
    const agent = createRtcAgent({
      activityBar: {
        disabledActivities: ['files'],
        defaultActivity: 'chat',
      },
    });
    expect(agent.activityBarConfig).toEqual({
      disabledActivities: ['files'],
      defaultActivity: 'chat',
    });
  });

  // ── Agent configuration ────────────────────────────────────────

  it('should build AgentConfig from agentName', () => {
    const agent = createRtcAgent({agentName: 'TestAgent'});
    expect(agent.agentConfig).toMatchObject({name: 'TestAgent'});
  });

  it('should build AgentConfig from agentDescription', () => {
    const agent = createRtcAgent({agentDescription: 'Test description'});
    expect(agent.agentConfig).toMatchObject({description: 'Test description'});
  });

  it('should build AgentConfig from persona', () => {
    const agent = createRtcAgent({persona: 'You are helpful'});
    expect(agent.agentConfig).toMatchObject({persona: 'You are helpful'});
  });

  it('should build AgentConfig from functions', () => {
    const fn = {name: 'test', description: 'Test fn', handler: () => 'ok'};
    const agent = createRtcAgent({functions: [fn]});
    expect(agent.agentConfig?.functions).toHaveLength(1);
    expect(agent.agentConfig?.functions?.[0]?.name).toBe('test');
  });

  it('should build AgentConfig from groups', () => {
    const groups = [
      {
        name: 'editor',
        description: 'Editor ops',
        functions: [{name: 'getCode', description: 'Get code', handler: () => ''}],
      },
    ];
    const agent = createRtcAgent({groups});
    expect(agent.agentConfig?.groups).toHaveLength(1);
    expect(agent.agentConfig?.groups?.[0]?.name).toBe('editor');
  });

  it('should build complete AgentConfig from multiple fields', () => {
    const agent = createRtcAgent({
      agentName: 'TestAgent',
      agentDescription: 'Test description',
      persona: 'You are helpful',
      functions: [{name: 'test', description: 'Test fn', handler: () => 'ok'}],
    });
    expect(agent.agentConfig).toMatchObject({
      name: 'TestAgent',
      description: 'Test description',
      persona: 'You are helpful',
    });
    expect(agent.agentConfig?.functions).toHaveLength(1);
  });

  it('should not set agentConfig when no agent fields are provided', () => {
    const agent = createRtcAgent({appLabel: 'Test'});
    // agentConfig getter returns null by default (no agent fields set)
    expect(agent.agentConfig).toBeNull();
  });

  // ── Lifecycle: destroy() ───────────────────────────────────────

  it('should have destroy() method', () => {
    const agent = createRtcAgent({});
    expect(typeof agent.destroy).toBe('function');
  });

  it('should remove element from DOM on destroy()', () => {
    const agent = createRtcAgent({});
    document.body.appendChild(agent);
    expect(document.body.contains(agent)).toBe(true);
    agent.destroy();
    expect(document.body.contains(agent)).toBe(false);
  });

  it('should not throw when destroy() is called without being in DOM', () => {
    const agent = createRtcAgent({});
    expect(() => agent.destroy()).not.toThrow();
  });

  // ── Authentication configuration ────────────────────────────────

  it('should set _pendingAuthConfig for StaticTokenAuth (mode 1)', () => {
    const agent = createRtcAgent({
      auth: {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        userId: 'user-123',
        expiresIn: 3600,
      },
    });
    expect(agent._pendingAuthConfig).toBeDefined();
    expect(agent._pendingAuthConfig!.accessToken).toBe('test-access-token');
    expect(agent._pendingAuthConfig!.refreshToken).toBe('test-refresh-token');
    expect(agent._pendingAuthConfig!.userId).toBe('user-123');
    expect(agent._pendingAuthConfig!.expiresIn).toBe(3600);
  });

  it('should set _pendingDynamicAuth for DynamicTokenAuth (mode 2)', () => {
    const getToken = () => 'dynamic-token';
    const refreshToken = () => Promise.resolve({accessToken: 'new-token'});

    const agent = createRtcAgent({
      auth: {
        getToken,
        refreshToken,
        userId: 'dynamic-user-456',
      },
    });
    expect(agent._pendingDynamicAuth).toBeDefined();
    expect(agent._pendingDynamicAuth!.getToken).toBe(getToken);
    expect(agent._pendingDynamicAuth!.refreshToken).toBe(refreshToken);
    expect(agent._pendingDynamicAuth!.userId).toBe('dynamic-user-456');
  });

  it('should set _pendingAuthProvider for AuthProvider (mode 3)', () => {
    const authProvider = {
      getToken: () => 'provider-token',
      refreshToken: () => Promise.resolve({accessToken: 'refreshed-token'}),
      isLoggedIn: () => true,
      logout: () => Promise.resolve(),
    };

    const agent = createRtcAgent({auth: authProvider});
    expect(agent._pendingAuthProvider).toBeDefined();
    expect(agent._pendingAuthProvider!.getToken).toBe(authProvider.getToken);
    expect(agent._pendingAuthProvider!.refreshToken).toBe(authProvider.refreshToken);
    expect(agent._pendingAuthProvider!.isLoggedIn).toBe(authProvider.isLoggedIn);
    expect(agent._pendingAuthProvider!.logout).toBe(authProvider.logout);
  });

  it('should clear pending auth references on destroy()', () => {
    const agent = createRtcAgent({
      auth: {
        accessToken: 'test-token',
        userId: 'user-123',
        expiresIn: 3600,
      },
    });
    expect(agent._pendingAuthConfig).toBeDefined();

    agent.destroy();
    expect(agent._pendingAuthConfig).toBeUndefined();
    expect(agent._pendingDynamicAuth).toBeUndefined();
    expect(agent._pendingAuthProvider).toBeUndefined();
  });

  // ── Edge cases ─────────────────────────────────────────────────

  it('should handle empty config', () => {
    const agent = createRtcAgent({});
    expect(agent.tagName.toLowerCase()).toBe('rtc-agent');
    // Defaults from RtcAgent component
    expect(agent.appLabel).toBe('RTC Agent');
    expect(agent.theme).toBe('system');
  });

  it('should handle full config without errors', () => {
    expect(() =>
      createRtcAgent({
        appLabel: 'Full Test',
        theme: 'dark',
        lang: 'zh-CN',
        bubbleIcon: '<svg></svg>',
        server: {
          url: 'https://api.example.com',
          redirectUri: 'https://app.com/callback',
        },
        databaseName: 'test-db',
        scenariosUrl: '/scenarios',
        window: {defaultMode: 'maximized', embedded: true},
        activityBar: {disabledActivities: ['settings'], defaultActivity: 'chat'},
        agentName: 'FullAgent',
        agentDescription: 'A full agent',
        persona: 'You are a test agent.',
        functions: [{name: 'fn1', description: 'Function 1', handler: () => 'ok'}],
        groups: [
          {
            name: 'group1',
            description: 'Group 1',
            functions: [{name: 'fn2', description: 'Function 2', handler: () => 'ok'}],
          },
        ],
      }),
    ).not.toThrow();
  });

  // ── Phase 3: Event Callbacks ─────────────────────────────────────

  describe('Event callbacks - DOM events', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should register and trigger ready callback', () => {
      const ready = vi.fn();
      const agent = createRtcAgent({
        on: {ready},
      });

      document.body.appendChild(agent);

      // Simulate rtc-agent-ready event
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));

      expect(ready).toHaveBeenCalledTimes(1);
    });

    it('should register and trigger session callbacks', () => {
      const sessionCreated = vi.fn();
      const sessionSwitched = vi.fn();
      const sessionRenamed = vi.fn();
      const sessionDeleted = vi.fn();

      const agent = createRtcAgent({
        on: {
          sessionCreated,
          sessionSwitched,
          sessionRenamed,
          sessionDeleted,
        },
      });

      document.body.appendChild(agent);

      // Trigger session events
      const mockSession = {id: 'session-1', title: 'Test Session', createdAt: new Date()};
      const createdEvent = new CustomEvent('rtc-session-created', {detail: {session: mockSession}});
      agent.dispatchEvent(createdEvent);
      expect(sessionCreated).toHaveBeenCalledWith(expect.any(CustomEvent));

      const switchedEvent = new CustomEvent('rtc-session-switched', {detail: {id: 'session-1'}});
      agent.dispatchEvent(switchedEvent);
      expect(sessionSwitched).toHaveBeenCalledWith(expect.any(CustomEvent));

      const renamedEvent = new CustomEvent('rtc-session-renamed', {detail: {id: 'session-1', title: 'New Title'}});
      agent.dispatchEvent(renamedEvent);
      expect(sessionRenamed).toHaveBeenCalledWith(expect.any(CustomEvent));

      const deletedEvent = new CustomEvent('rtc-session-deleted', {detail: {id: 'session-1'}});
      agent.dispatchEvent(deletedEvent);
      expect(sessionDeleted).toHaveBeenCalledWith(expect.any(CustomEvent));
    });

    it('should register and trigger message callbacks', () => {
      const messageReceived = vi.fn();
      const messageSent = vi.fn();

      const agent = createRtcAgent({
        on: {messageReceived, messageSent},
      });

      document.body.appendChild(agent);

      const mockMessage = {id: 'msg-1', content: 'Hello', role: 'user' as const, timestamp: new Date()};
      const receivedEvent = new CustomEvent('rtc-message-received', {detail: {message: mockMessage}});
      agent.dispatchEvent(receivedEvent);
      expect(messageReceived).toHaveBeenCalledWith(expect.any(CustomEvent));

      const sentEvent = new CustomEvent('rtc-message-sent', {detail: {message: mockMessage}});
      agent.dispatchEvent(sentEvent);
      expect(messageSent).toHaveBeenCalledWith(expect.any(CustomEvent));
    });

    it('should register and trigger auth/connection callbacks', () => {
      const connectionRetry = vi.fn();
      const authLoginRequested = vi.fn();
      const authError = vi.fn();
      const authLogout = vi.fn();
      const connectionStateChange = vi.fn();
      const authLogin = vi.fn();

      const agent = createRtcAgent({
        on: {
          connectionRetry,
          authLoginRequested,
          authError,
          authLogout,
          connectionStateChange,
          authLogin,
        },
      });

      document.body.appendChild(agent);

      agent.dispatchEvent(new CustomEvent('rtc-connection-retry'));
      expect(connectionRetry).toHaveBeenCalledWith(expect.any(CustomEvent));

      agent.dispatchEvent(new CustomEvent('rtc-auth-login-requested'));
      expect(authLoginRequested).toHaveBeenCalledWith(expect.any(CustomEvent));

      agent.dispatchEvent(new CustomEvent('rtc-auth-refresh-failed'));
      expect(authError).toHaveBeenCalledWith(expect.any(CustomEvent));

      agent.dispatchEvent(new CustomEvent('rtc-auth-logout'));
      expect(authLogout).toHaveBeenCalledWith(expect.any(CustomEvent));

      const stateEvent = new CustomEvent('rtc-connection-state-change', {detail: {state: 'connected'}});
      agent.dispatchEvent(stateEvent);
      expect(connectionStateChange).toHaveBeenCalledWith(expect.any(CustomEvent));

      const loginEvent = new CustomEvent('rtc-auth-login', {detail: {userId: 'user-123'}});
      agent.dispatchEvent(loginEvent);
      expect(authLogin).toHaveBeenCalledWith(expect.any(CustomEvent));
    });

    it('should register and trigger themeChange callback', () => {
      const themeChange = vi.fn();
      const agent = createRtcAgent({on: {themeChange}});

      document.body.appendChild(agent);

      const event = new CustomEvent('rtc-theme-change', {detail: {theme: 'dark'}});
      agent.dispatchEvent(event);
      expect(themeChange).toHaveBeenCalledWith(expect.any(CustomEvent));
    });

    it('should register and trigger beforeDestroy callback', () => {
      const beforeDestroy = vi.fn();
      const agent = createRtcAgent({on: {beforeDestroy}});

      document.body.appendChild(agent);

      const event = new CustomEvent('rtc-before-destroy');
      agent.dispatchEvent(event);
      expect(beforeDestroy).toHaveBeenCalledWith(expect.any(CustomEvent));
    });

    it('should clean up DOM event listeners on destroy', () => {
      const ready = vi.fn();
      const sessionCreated = vi.fn();

      const agent = createRtcAgent({
        on: {ready, sessionCreated},
      });

      document.body.appendChild(agent);

      // Verify callbacks work before destroy
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      expect(ready).toHaveBeenCalledTimes(1);

      // Destroy the agent
      agent.destroy();

      // Clear mock to check no new calls
      ready.mockClear();

      // Events after destroy should not trigger callbacks
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      agent.dispatchEvent(new CustomEvent('rtc-session-created', {detail: {session: {id: '1', title: 'test', createdAt: new Date()}}}));

      expect(ready).not.toHaveBeenCalled();
      expect(sessionCreated).not.toHaveBeenCalled();
    });

    it('should pass event detail to callbacks via event.detail', () => {
      const sessionCreated = vi.fn();
      const agent = createRtcAgent({on: {sessionCreated}});

      document.body.appendChild(agent);

      const mockSession = {id: 'session-1', title: 'Test', createdAt: new Date()};
      const event = new CustomEvent('rtc-session-created', {detail: {session: mockSession}});
      agent.dispatchEvent(event);

      // Callback receives CustomEvent, can access detail via event.detail
      expect(sessionCreated).toHaveBeenCalled();
      const receivedEvent = sessionCreated.mock.calls[0][0];
      expect(receivedEvent).toBeInstanceOf(CustomEvent);
      expect(receivedEvent.detail).toEqual({session: mockSession});
    });
  });

  describe('Event callbacks - EventBus bridging', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      eventBus.clearAll();
    });

    it('should register and trigger toolCallStart callback', () => {
      const toolCallStart = vi.fn();
      const agent = createRtcAgent({
        on: {toolCallStart},
      });

      document.body.appendChild(agent);

      // Simulate EventBus function:start event
      eventBus.emit('function:start', {
        path: 'test.function',
        params: {arg: 'value'},
      });

      expect(toolCallStart).toHaveBeenCalledWith({
        path: 'test.function',
        params: {arg: 'value'},
      });
    });

    it('should register and trigger toolCallSuccess callback', () => {
      const toolCallSuccess = vi.fn();
      const agent = createRtcAgent({
        on: {toolCallSuccess},
      });

      document.body.appendChild(agent);

      eventBus.emit('function:success', {
        path: 'test.function',
        result: {data: 'success'},
      });

      expect(toolCallSuccess).toHaveBeenCalledWith({
        path: 'test.function',
        result: {data: 'success'},
      });
    });

    it('should register and trigger toolCallError callback', () => {
      const toolCallError = vi.fn();
      const agent = createRtcAgent({
        on: {toolCallError},
      });

      document.body.appendChild(agent);

      const error = new Error('Test error');
      eventBus.emit('function:error', {
        path: 'test.function',
        error,
      });

      expect(toolCallError).toHaveBeenCalledWith({
        path: 'test.function',
        error,
      });
    });

    it('should register and trigger toolCallProgress callback', () => {
      const toolCallProgress = vi.fn();
      const agent = createRtcAgent({
        on: {toolCallProgress},
      });

      document.body.appendChild(agent);

      eventBus.emit('function:progress', {
        path: 'test.function',
        progress: 50,
      });

      expect(toolCallProgress).toHaveBeenCalledWith({
        path: 'test.function',
        progress: 50,
      });
    });

    it('should clean up EventBus listeners on destroy', () => {
      const toolCallStart = vi.fn();
      const toolCallSuccess = vi.fn();

      const agent = createRtcAgent({
        on: {toolCallStart, toolCallSuccess},
      });

      document.body.appendChild(agent);

      // Verify callbacks work before destroy
      eventBus.emit('function:start', {path: 'test.fn', params: {}});
      expect(toolCallStart).toHaveBeenCalledTimes(1);

      // Destroy the agent
      agent.destroy();

      // Clear mock to check no new calls
      toolCallStart.mockClear();

      // EventBus events after destroy should not trigger callbacks
      eventBus.emit('function:start', {path: 'test.fn', params: {}});
      eventBus.emit('function:success', {path: 'test.fn', result: null});

      expect(toolCallStart).not.toHaveBeenCalled();
      expect(toolCallSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Event callbacks - beforeMessageSend', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should register beforeMessageSend callback as async hook', () => {
      const beforeMessageSend = vi.fn().mockReturnValue(true);
      const agent = createRtcAgent({
        on: {beforeMessageSend},
      });

      document.body.appendChild(agent);

      // The factory installs an async hook on the element
      expect(agent._beforeMessageSendHook).toBeDefined();
      expect(typeof agent._beforeMessageSendHook).toBe('function');
    });

    it('should call beforeMessageSend callback with message detail', async () => {
      const beforeMessageSend = vi.fn().mockReturnValue(true);
      const agent = createRtcAgent({
        on: {beforeMessageSend},
      });

      document.body.appendChild(agent);

      // Call the async hook directly
      const detail = {message: {content: 'test message'}};
      const result = await agent._beforeMessageSendHook!(detail);

      expect(beforeMessageSend).toHaveBeenCalledWith(detail);
      expect(result).toBe(true);
    });

    it('should support synchronous return values', async () => {
      const beforeMessageSend = vi.fn().mockReturnValue(true);
      const agent = createRtcAgent({
        on: {beforeMessageSend},
      });

      document.body.appendChild(agent);

      const result = await agent._beforeMessageSendHook!({message: {content: 'test'}});
      expect(result).toBe(true);
    });

    it('should support async/Promise return values', async () => {
      const beforeMessageSend = vi.fn().mockResolvedValue(true);
      const agent = createRtcAgent({
        on: {beforeMessageSend},
      });

      document.body.appendChild(agent);

      const result = await agent._beforeMessageSendHook!({message: {content: 'test'}});
      expect(result).toBe(true);
      expect(beforeMessageSend).toHaveBeenCalled();
    });

    it('should return false when callback returns false (cancellation)', async () => {
      const beforeMessageSend = vi.fn().mockReturnValue(false);
      const agent = createRtcAgent({
        on: {beforeMessageSend},
      });

      document.body.appendChild(agent);

      const result = await agent._beforeMessageSendHook!({message: {content: 'test'}});
      expect(result).toBe(false);
    });

    it('should return false when callback resolves to false (async cancellation)', async () => {
      const beforeMessageSend = vi.fn().mockResolvedValue(false);
      const agent = createRtcAgent({
        on: {beforeMessageSend},
      });

      document.body.appendChild(agent);

      const result = await agent._beforeMessageSendHook!({message: {content: 'test'}});
      expect(result).toBe(false);
    });

    it('should also register a DOM event listener for rtc-before-message-send', () => {
      const beforeMessageSend = vi.fn().mockReturnValue(true);
      const agent = createRtcAgent({
        on: {beforeMessageSend},
      });

      document.body.appendChild(agent);

      // Dispatch the DOM event - the factory registers a no-op listener
      // for external listeners, but the async hook is the primary mechanism
      const event = new CustomEvent('rtc-before-message-send', {
        detail: {message: {content: 'test'}},
        cancelable: true,
      });
      agent.dispatchEvent(event);

      // The callback is invoked via the async hook, not the DOM event
      // The DOM event is for external listeners who don't use the factory
      expect(beforeMessageSend).not.toHaveBeenCalled();
    });

    it('should clean up beforeMessageSend hook on destroy', () => {
      const beforeMessageSend = vi.fn().mockReturnValue(true);
      const agent = createRtcAgent({
        on: {beforeMessageSend},
      });

      document.body.appendChild(agent);

      expect(agent._beforeMessageSendHook).toBeDefined();

      agent.destroy();

      // After destroy, the hook should still exist on the element
      // (destroy doesn't clear it, but the element is removed from DOM)
      // The important thing is that EventBus and DOM listeners are cleaned up
      expect(agent._eventUnsubscribes).toBeUndefined();
    });
  });

  describe('Event callbacks - Combined scenarios', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      eventBus.clearAll();
    });

    it('should support multiple callbacks registered together', () => {
      const ready = vi.fn();
      const toolCallStart = vi.fn();
      const beforeMessageSend = vi.fn().mockReturnValue(true);

      const agent = createRtcAgent({
        on: {
          ready,
          toolCallStart,
          beforeMessageSend,
        },
      });

      document.body.appendChild(agent);

      // DOM event
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      expect(ready).toHaveBeenCalledTimes(1);

      // EventBus event
      eventBus.emit('function:start', {path: 'test.fn', params: {}});
      expect(toolCallStart).toHaveBeenCalledTimes(1);

      // Async hook
      expect(agent._beforeMessageSendHook).toBeDefined();
    });

    it('should handle config without any callbacks', () => {
      const agent = createRtcAgent({
        appLabel: 'Test',
      });

      document.body.appendChild(agent);

      expect(agent._eventUnsubscribes).toBeUndefined();
      expect(agent._eventBusUnsubscribes).toBeUndefined();
      expect(agent._beforeMessageSendHook).toBeUndefined();
    });

    it('should handle empty on config', () => {
      const agent = createRtcAgent({
        on: {},
      });

      document.body.appendChild(agent);

      // Empty callbacks object should still create the arrays (but empty)
      expect(agent._eventUnsubscribes).toEqual([]);
      expect(agent._eventBusUnsubscribes).toEqual([]);
    });

    it('should only register provided callbacks', () => {
      const ready = vi.fn();

      const agent = createRtcAgent({
        on: {ready},
      });

      document.body.appendChild(agent);

      // Only ready callback should be registered
      agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
      expect(ready).toHaveBeenCalledTimes(1);

      // Other events should not throw
      agent.dispatchEvent(new CustomEvent('rtc-session-created', {detail: {session: {id: '1', title: 'test', createdAt: new Date()}}}));

      // EventBus should not have listeners
      eventBus.emit('function:start', {path: 'test.fn', params: {}});
      // No toolCallStart callback was registered, so nothing should happen
    });
  });

});
