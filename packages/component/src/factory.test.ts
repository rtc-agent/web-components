/**
 * Unit tests for the `createRtcAgent` factory function.
 *
 * Covers all configuration mappings (basic properties, server, window,
 * activityBar, agent config) and lifecycle management (destroy method).
 */

import {describe, it, expect, afterEach} from 'vitest';
import {createRtcAgent} from './factory.js';
import {cleanupFixtures} from './test-helpers.js';

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

});
