/**
 * Factory function for creating and configuring an `<rtc-agent>` element.
 *
 * @module factory
 */

import type { RtcAgentConfig, RtcAgentWithLifecycle, StaticTokenAuth, DynamicTokenAuth, AuthProvider } from './types/factory.js';
import type { AgentConfig } from './types/agent-config.js';
import { eventBus } from './core/event-bus.js';

/**
 * Create a pre-configured `<rtc-agent>` custom element.
 *
 * This factory simplifies integration by mapping a declarative configuration
 * object to the component's properties. It returns the component instance
 * directly (typed as `RtcAgentWithLifecycle`), so callers get full IDE autocompletion
 * for programmatic access.
 *
 * **Configuration scope**: Supports simple properties, server/database/scenario
 * configuration, window layout, activity bar, and agent behavior (functions,
 * groups, persona). Auth and event callbacks are reserved for future phases.
 *
 * The returned instance includes a `destroy()` method for complete resource
 * cleanup. Call `destroy()` when the agent is no longer needed to ensure all
 * resources are properly released.
 *
 * @param config - Configuration object for the agent instance.
 * @returns A configured `RtcAgentWithLifecycle` element ready to be appended to the DOM.
 *
 * @example
 * Basic usage:
 * ```ts
 * import { createRtcAgent } from '@rtc-agent/component';
 *
 * const agent = createRtcAgent({
 *   appLabel: 'My Assistant',
 *   theme: 'dark',
 *   lang: 'en-US',
 *   server: {
 *     url: 'https://api.example.com',
 *     redirectUri: 'https://example.com/callback',
 *   },
 *   databaseName: 'my-app',
 * });
 *
 * document.body.appendChild(agent);
 *
 * // Later, when done:
 * agent.destroy();
 * ```
 *
 * @example
 * Minimal usage (all defaults):
 * ```ts
 * const agent = createRtcAgent({
 *   server: { url: 'https://api.example.com' },
 * });
 * document.body.appendChild(agent);
 * ```
 *
 * @remarks
 * - The returned element is **not** automatically appended to the DOM.
 *   Callers must append it themselves (e.g. `document.body.appendChild(agent)`).
 * - The `databaseName` property must be set via this config (before mounting)
 *   to take effect. Setting it after mounting may not work for the current
 *   session.
 * - The `bubbleIcon` value is sanitized internally by the component using
 *   DOMPurify, but callers should still avoid passing untrusted content as
 *   a defense-in-depth measure.
 */
export function createRtcAgent(config: RtcAgentConfig): RtcAgentWithLifecycle {
  const element = document.createElement('rtc-agent') as RtcAgentWithLifecycle;

  // ── Basic properties ──

  if (config.appLabel !== undefined) {
    element.appLabel = config.appLabel;
  }

  if (config.theme !== undefined) {
    element.theme = config.theme;
  }

  if (config.lang !== undefined) {
    element.lang = config.lang;
  }

  if (config.bubbleIcon !== undefined) {
    element.bubbleIcon = config.bubbleIcon;
  }

  // ── Server configuration ──

  if (config.server) {
    // The serverURL setter internally calls setServerUrl().
    element.serverURL = config.server.url;

    if (config.server.redirectUri !== undefined) {
      // The redirectURI setter internally calls setRedirectUri().
      element.redirectURI = config.server.redirectUri;
    }
  }

  // ── Database configuration ──
  // Must be set before the element is mounted to the DOM.

  if (config.databaseName !== undefined) {
    element.databaseName = config.databaseName;
  }

  // ── Scenario documents ──

  if (config.scenariosUrl !== undefined) {
    element.scenariosURL = config.scenariosUrl;
  }

  // ── Window configuration ──

  if (config.window !== undefined) {
    element.windowConfig = config.window;
  }

  // ── Activity Bar configuration ──

  if (config.activityBar !== undefined) {
    element.activityBarConfig = config.activityBar;
  }

  // ── Agent configuration ──
  // Build an AgentConfig from the individual top-level fields. Only construct
  // the object when at least one agent-related field is provided.

  const hasAgentConfig =
    config.agentName !== undefined ||
    config.agentDescription !== undefined ||
    config.persona !== undefined ||
    config.functions !== undefined ||
    config.groups !== undefined;

  if (hasAgentConfig) {
    const agentConfig: AgentConfig = {};

    if (config.agentName !== undefined) {
      agentConfig.name = config.agentName;
    }
    if (config.agentDescription !== undefined) {
      agentConfig.description = config.agentDescription;
    }
    if (config.persona !== undefined) {
      agentConfig.persona = config.persona;
    }
    if (config.functions !== undefined) {
      agentConfig.functions = config.functions;
    }
    if (config.groups !== undefined) {
      agentConfig.groups = config.groups;
    }

    element.agentConfig = agentConfig;
  }

  // ── Authentication configuration ──

  if (config.auth) {
    // Detect auth mode by checking fields
    if ('accessToken' in config.auth) {
      // Mode 1: StaticTokenAuth
      const staticAuth = config.auth as StaticTokenAuth;

      // Store pending auth config — will be applied in connectedCallback
      // after the element is mounted (controllers are initialized at that point).
      element._pendingAuthConfig = staticAuth;
    } else if ('getToken' in config.auth && !('isLoggedIn' in config.auth)) {
      // Mode 2: DynamicTokenAuth
      const dynamicAuth = config.auth as DynamicTokenAuth;
      element._pendingDynamicAuth = dynamicAuth;
    } else if ('isLoggedIn' in config.auth) {
      // Mode 3: AuthProvider
      const authProvider = config.auth as AuthProvider;
      element._pendingAuthProvider = authProvider;
    }
  }

  // ── Event callbacks ──
  //
  // Perf note: For the current ~15 events, direct addEventListener registration
  // is optimal. Event delegation (single listener + bubbling dispatch) would add
  // complexity without measurable benefit at this scale. If event count grows
  // significantly (>50), consider switching to a delegation pattern.

  if (config.on) {
    const callbacks = config.on;
    // PERF: Array of tuples (not object) avoids dictionary iteration overhead.
    // Each entry is [eventName, callback | undefined].
    const eventMap: Array<[string, EventListener | undefined]> = [
      ['rtc-agent-ready', callbacks.ready],
      ['rtc-connection-retry', callbacks.connectionRetry],
      ['rtc-auth-login-requested', callbacks.authLoginRequested],
      ['rtc-auth-refresh-failed', callbacks.authError],
      ['rtc-auth-logout', callbacks.authLogout],
      ['rtc-session-created', callbacks.sessionCreated as EventListener | undefined],
      ['rtc-session-switched', callbacks.sessionSwitched as EventListener | undefined],
      ['rtc-session-renamed', callbacks.sessionRenamed as EventListener | undefined],
      ['rtc-session-deleted', callbacks.sessionDeleted as EventListener | undefined],
      ['rtc-message-received', callbacks.messageReceived as EventListener | undefined],
      ['rtc-message-sent', callbacks.messageSent as EventListener | undefined],
      ['rtc-connection-state-change', callbacks.connectionStateChange as EventListener | undefined],
      ['rtc-auth-login', callbacks.authLogin as EventListener | undefined],
      ['rtc-theme-change', callbacks.themeChange as EventListener | undefined],
      ['rtc-before-destroy', callbacks.beforeDestroy as EventListener | undefined],
    ];

    // Register callbacks and store unsubscribe functions for cleanup
    const unsubscribes: Array<() => void> = [];

    for (const [eventName, callback] of eventMap) {
      if (callback) {
        element.addEventListener(eventName, callback);
        unsubscribes.push(() => element.removeEventListener(eventName, callback));
      }
    }

    // Store unsubscribes for destroy() cleanup
    element._eventUnsubscribes = unsubscribes;
  }

  // ── EventBus bridging (tool call events) ──
  //
  // The component's internal EventBus dispatches function lifecycle events
  // (function:start, function:success, function:error, function:progress).
  // Bridge these to the corresponding callbacks so host applications can
  // observe tool call activity without importing the EventBus directly.
  //
  // Perf note: Each callback is registered lazily — only when the user provides
  // it. This means zero overhead for unused callbacks. The EventBus uses a
  // Map<string, Set<EventHandler>> internally, so on() is O(1) amortized.

  if (config.on) {
    const callbacks = config.on;
    const eventBusUnsubscribes: Array<() => void> = [];

    if (callbacks.toolCallStart) {
      const unsub = eventBus.on('function:start', (detail) => {
        callbacks.toolCallStart?.({ path: detail.path, params: detail.params });
      });
      eventBusUnsubscribes.push(unsub);
    }

    if (callbacks.toolCallSuccess) {
      const unsub = eventBus.on('function:success', (detail) => {
        callbacks.toolCallSuccess?.({ path: detail.path, result: detail.result });
      });
      eventBusUnsubscribes.push(unsub);
    }

    if (callbacks.toolCallError) {
      const unsub = eventBus.on('function:error', (detail) => {
        callbacks.toolCallError?.({ path: detail.path, error: detail.error });
      });
      eventBusUnsubscribes.push(unsub);
    }

    if (callbacks.toolCallProgress) {
      const unsub = eventBus.on('function:progress', (detail) => {
        callbacks.toolCallProgress?.({ path: detail.path, progress: detail.progress });
      });
      eventBusUnsubscribes.push(unsub);
    }

    // Store EventBus unsubscribes for destroy() cleanup
    element._eventBusUnsubscribes = eventBusUnsubscribes;
  }

  // ── beforeMessageSend async hook ──
  //
  // The beforeMessageSend callback supports async (returns Promise<boolean>),
  // which cannot be expressed via a synchronous DOM event listener alone.
  // We install a direct async hook on the element that the component awaits
  // before each message send. A cancelable DOM event is also dispatched by
  // the component (Layer 2 in rtc-agent.ts) for external listeners.
  //
  // Perf note: assign userCallback directly instead of wrapping in an extra
  // async function. This avoids one unnecessary Promise allocation per message
  // send — _beforeMessageSend() in rtc-agent.ts already handles `await` on the
  // hook, so the wrapper added no value.

  if (config.on?.beforeMessageSend) {
    element._beforeMessageSendHook = config.on.beforeMessageSend;
  }

  // ── Lifecycle management ──
  // Mount destroy() method for complete resource cleanup.
  //
  // Perf note: destroy() is O(n) where n is the number of registered listeners.
  // For the current scale (~15 DOM events + ~4 EventBus listeners), this is
  // negligible. All references are nullified after cleanup to help GC reclaim
  // closures and their captured scopes promptly.
  element.destroy = () => {
    // 1. Remove element from DOM (triggers disconnectedCallback)
    element.remove();

    // 2. Clear external token references
    element._pendingAuthConfig = undefined;
    element._pendingDynamicAuth = undefined;
    element._pendingAuthProvider = undefined;

    // 3. Cancel all DOM event subscriptions
    if (element._eventUnsubscribes) {
      element._eventUnsubscribes.forEach(unsub => unsub());
      element._eventUnsubscribes = undefined;
    }

    // 4. Cancel all EventBus subscriptions
    if (element._eventBusUnsubscribes) {
      element._eventBusUnsubscribes.forEach(unsub => unsub());
      element._eventBusUnsubscribes = undefined;
    }

    // 5. Optionally clear localStorage tokens
    // TODO: Implement as needed
  };

  return element;
}
