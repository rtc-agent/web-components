/**
 * Type definitions for the `createRtcAgent` factory function.
 *
 * @module factory-types
 */

import type { WindowConfig } from './window-config.js';
import type { ActivityBarConfig } from './activity-bar-config.js';
import type { AgentFunctionGroup } from './agent-config.js';
import type { FunctionDef } from './skill.js';

// ===== Authentication Configuration (Three Modes) =====

/**
 * Authentication configuration for the RTC Agent.
 *
 * Supports three modes:
 * - StaticTokenAuth: Fixed token provided by host application
 * - DynamicTokenAuth: Token retrieved via callback (recommended)
 * - AuthProvider: Full authentication delegation to host application
 */
export type AuthConfig = StaticTokenAuth | DynamicTokenAuth | AuthProvider;

/**
 * Mode 1: Static Token Authentication
 *
 * The host application provides a fixed access token. The component will not
 * attempt to refresh the token. Use this mode when:
 * - The token is long-lived and doesn't expire
 * - The host application handles token refresh externally
 * - Simple integration is preferred over automatic token management
 *
 * @example
 * ```ts
 * const agent = createRtcAgent({
 *   auth: {
 *     accessToken: 'eyJhbGc...',
 *     refreshToken: 'optional-refresh-token',
 *     userId: 'user-123',
 *     expiresIn: 3600, // optional, seconds
 *   }
 * });
 * ```
 */
export interface StaticTokenAuth {
  /** Access token for API requests */
  accessToken: string;
  /** Optional refresh token (not used in static mode, reserved for future) */
  refreshToken?: string;
  /** User ID associated with the token */
  userId: string;
  /** Token expiration time in seconds. If not set, no auto-refresh is attempted */
  expiresIn?: number;
}

/**
 * Mode 2: Dynamic Token Authentication (Recommended)
 *
 * The host application provides callbacks for token retrieval and refresh.
 * The component calls these callbacks when needed. Use this mode when:
 * - Tokens expire and need automatic refresh
 * - Token management is handled by the host application
 * - You want the component to automatically refresh tokens before expiration
 *
 * @example
 * ```ts
 * const agent = createRtcAgent({
 *   auth: {
 *     getToken: () => authService.getLatestToken(),
 *     refreshToken: async () => {
 *       const result = await authService.refresh();
 *       return { accessToken: result.access, refreshToken: result.refresh };
 *     },
 *     userId: authService.getUserId(),
 *   }
 * });
 * ```
 */
export interface DynamicTokenAuth {
  /** Called each time a token is needed (e.g., WebSocket connection, API request) */
  getToken: () => string | Promise<string>;
  /** Called when the token expires and needs refresh */
  refreshToken?: () => Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  /** User ID associated with the authentication */
  userId: string;
}

/**
 * Mode 3: Auth Provider (Advanced)
 *
 * The host application provides a complete authentication provider interface.
 * Use this mode for:
 * - Multi-tenant applications
 * - Custom token rotation strategies
 * - Complex authentication flows
 *
 * @example
 * ```ts
 * const agent = createRtcAgent({
 *   auth: {
 *     getToken: () => authProvider.getAccessToken(),
 *     refreshToken: () => authProvider.refreshAccessToken(),
 *     isLoggedIn: () => authProvider.isAuthenticated(),
 *     logout: () => authProvider.signOut(),
 *   }
 * });
 * ```
 */
export interface AuthProvider {
  /** Returns the current access token */
  getToken(): string | Promise<string>;
  /** Refreshes the access token */
  refreshToken(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  /** Returns whether the user is currently logged in */
  isLoggedIn(): boolean;
  /** Optional logout handler. If provided, component logout delegates to host */
  logout?(): Promise<void>;
}

/**
 * Configuration for the `createRtcAgent` factory function.
 *
 * Supports basic properties, server/database/scenario configuration,
 * window layout, activity bar, and agent behavior (functions, groups, persona).
 *
 * @example
 * ```ts
 * const agent = createRtcAgent({
 *   appLabel: 'My Assistant',
 *   theme: 'dark',
 *   lang: 'en-US',
 *   server: {
 *     url: 'https://api.example.com',
 *     redirectUri: 'https://example.com/callback',
 *   },
 *   databaseName: 'my-app',
 *   scenariosUrl: '/scenarios',
 *   window: {
 *     defaultMode: 'maximized',
 *     embedded: true,
 *   },
 *   activityBar: {
 *     disabledActivities: ['settings'],
 *     defaultActivity: 'chat',
 *   },
 *   agentName: 'MyAgent',
 *   agentDescription: 'A helpful assistant',
 *   persona: 'You are a helpful AI assistant.',
 *   functions: [
 *     { name: 'greet', description: 'Say hello', handler: () => 'Hello!' },
 *   ],
 *   groups: [
 *     {
 *       name: 'editor',
 *       description: 'Editor operations',
 *       functions: [
 *         { name: 'getCode', description: 'Get code', handler: () => '' },
 *       ],
 *     },
 *   ],
 * });
 * document.body.appendChild(agent);
 * ```
 */
export interface RtcAgentConfig {
  // ── Basic properties ──

  /**
   * Application label displayed in the title bar and bubble tooltip.
   *
   * Maps to `RtcAgent.appLabel`.
   *
   * @default 'RTC Agent'
   */
  appLabel?: string;

  /**
   * Visual theme for the component.
   *
   * - `'light'` — force light theme
   * - `'dark'` — force dark theme
   * - `'system'` — follow system preference (default)
   *
   * Maps to `RtcAgent.theme`.
   *
   * @default 'system'
   */
  theme?: 'light' | 'dark' | 'system';

  /**
   * BCP 47 language tag (e.g. `'zh-CN'`, `'en-US'`).
   *
   * Priority: this property > localStorage > browser language > default (`'zh-CN'`).
   *
   * Maps to `RtcAgent.lang` setter.
   */
  lang?: string;

  /**
   * SVG or HTML string rendered inside the minimized bubble.
   *
   * **Security note**: The component internally sanitizes this value with
   * DOMPurify before rendering. However, as a defense-in-depth measure,
   * callers should still avoid passing content from untrusted sources.
   *
   * Maps to `RtcAgent.bubbleIcon`.
   */
  bubbleIcon?: string;

  // ── Server configuration ──

  /**
   * Backend server connection settings.
   */
  server?: {
    /**
     * Backend server URL (e.g. `'https://api.example.com'`).
     *
     * Maps to `RtcAgent.serverURL` setter, which internally calls `setServerUrl()`.
     */
    url: string;

    /**
     * OAuth redirect URI for authentication flows.
     *
     * Maps to `RtcAgent.redirectURI` setter, which internally calls `setRedirectUri()`.
     */
    redirectUri?: string;
  };

  // ── Database configuration ──

  /**
   * Custom IndexedDB database name prefix.
   *
   * When set, the actual database name becomes `${databaseName}-${userId}`
   * instead of the default `rtc-agent-${userId}`.
   *
   * **Important**: This property must be set before the element is mounted
   * to the DOM. Setting it after mounting may not take effect for the
   * current session.
   *
   * Maps to `RtcAgent.databaseName`.
   */
  databaseName?: string;

  // ── Scenario documents ──

  /**
   * URL to load scenario documents from.
   *
   * The component will auto-load `manifest.json` and associated `.md` files
   * from this base URL.
   *
   * Maps to `RtcAgent.scenariosURL` setter.
   */
  scenariosUrl?: string;

  // ── Window configuration ──

  /**
   * Window layout and behavior settings.
   *
   * Maps to `RtcAgent.windowConfig`.
   *
   * Controls default mode (normal/maximized/minimized), size, position,
   * drag/resize behavior, button visibility, embedded mode, and bubble
   * placement.
   *
   * @example
   * ```ts
   * window: {
   *   defaultMode: 'maximized',
   *   embedded: true,
   * }
   * ```
   */
  window?: WindowConfig;

  // ── Activity Bar configuration ──

  /**
   * Activity Bar visibility and defaults.
   *
   * Maps to `RtcAgent.activityBarConfig`.
   *
   * Controls which activity tabs (files, settings) are hidden and which
   * tab is shown by default. The chat tab is always visible.
   *
   * @example
   * ```ts
   * activityBar: {
   *   disabledActivities: ['settings'],
   *   defaultActivity: 'chat',
   * }
   * ```
   */
  activityBar?: ActivityBarConfig;

  // ── Agent configuration ──

  /**
   * Agent name (used in system prompts, etc.).
   *
   * Maps to `AgentConfig.name`. Named `agentName` here to avoid collision
   * with top-level config fields.
   */
  agentName?: string;

  /**
   * Agent description.
   *
   * Maps to `AgentConfig.description`. Named `agentDescription` here to
   * avoid collision with top-level config fields.
   */
  agentDescription?: string;

  /**
   * AI persona (system prompt).
   *
   * Maps to `AgentConfig.persona`.
   */
  persona?: string;

  /**
   * Flat function list (auto-placed into a 'default' group).
   *
   * Maps to `AgentConfig.functions`.
   *
   * For simple scenarios; use `groups` for complex setups. Both can be
   * used together: groups are registered first, then functions.
   */
  functions?: FunctionDef[];

  /**
   * Grouped function list.
   *
   * Maps to `AgentConfig.groups`.
   */
  groups?: AgentFunctionGroup[];

  // ── Authentication ──

  /**
   * Authentication configuration.
   *
   * Three modes are supported:
   * - StaticTokenAuth: Fixed token (simplest)
   * - DynamicTokenAuth: Token via callback (recommended)
   * - AuthProvider: Full delegation (advanced)
   *
   * If not provided, the component uses its internal OAuth flow.
   */
  auth?: AuthConfig;

  // ── Reserved for future phases ──
  // on?: EventCallbacks;         // Phase 3
}

/**
 * The RTC Agent component instance type.
 *
 * This is a convenience alias for the `RtcAgent` class exported from the
 * component module. Using this type allows consumers to get full IDE
 * autocompletion when working with the factory return value.
 */
export type RtcAgent = import('../components/rtc-agent/rtc-agent.js').RtcAgent;

/**
 * RTC Agent instance with lifecycle management.
 *
 * Extends `RtcAgent` with a `destroy()` method for complete resource cleanup.
 */
export interface RtcAgentWithLifecycle extends RtcAgent {
  /**
   * Permanently destroy the agent instance.
   *
   * Performs complete cleanup:
   * 1. Removes element from DOM (triggers disconnectedCallback)
   * 2. Clears external token references (added in Phase 2)
   * 3. Cancels all EventBus subscriptions (added in Phase 3)
   * 4. Optionally clears localStorage tokens
   *
   * After calling destroy(), the agent instance should not be reused.
   */
  destroy(): void;
}
