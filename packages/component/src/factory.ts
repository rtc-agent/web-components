/**
 * Factory function for creating and configuring an `<rtc-agent>` element.
 *
 * @module factory
 */

import type { RtcAgentConfig, RtcAgentWithLifecycle } from './types/factory.js';
import type { AgentConfig } from './types/agent-config.js';

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

  // ── Lifecycle management ──
  // Mount destroy() method for complete resource cleanup.
  element.destroy = () => {
    // 1. Remove element from DOM (triggers disconnectedCallback)
    element.remove();

    // 2. Clear external token references (reserved for Phase 2)
    // TODO: Implement after auth integration
    // if (element.authController) {
    //   element.authController.clearExternalTokens();
    // }

    // 3. Cancel all EventBus subscriptions (reserved for Phase 3)
    // TODO: Implement after EventBus bridging
    // if (eventBusUnsubscribes) {
    //   eventBusUnsubscribes.forEach(unsub => unsub());
    // }

    // 4. Optionally clear localStorage tokens
    // TODO: Implement as needed
  };

  return element;
}
