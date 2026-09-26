/**
 * Type definitions for the `createRtcAgent` factory function.
 *
 * @module factory-types
 */

import type { WindowConfig } from './window-config.js';
import type { ActivityBarConfig } from './activity-bar-config.js';
import type { AgentFunctionGroup } from './agent-config.js';
import type { FunctionDef } from './skill.js';
import type { Session, Message } from './index.js';

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

// ===== Event Callbacks (Phase 3) =====

/**
 * Event callbacks for the RTC Agent.
 *
 * Each callback maps to a corresponding DOM CustomEvent dispatched by the component.
 * The factory function internally registers these callbacks via `addEventListener()`.
 * Callbacks are automatically removed when `destroy()` is called.
 *
 * @example
 * ```ts
 * const agent = createRtcAgent({
 *   on: {
 *     ready: () => console.log('Agent ready'),
 *     sessionCreated: ({ session }) => console.log('Session:', session.title),
 *     messageReceived: ({ message }) => console.log('Message:', message.content),
 *   }
 * });
 * ```
 */
export interface EventCallbacks {
  // ===== Lifecycle =====

  /** Component first render complete (maps to `rtc-agent-ready` event) */
  ready?: () => void;

  /**
   * Component about to be removed from DOM
   *
   * Note: Web Component's `disconnectedCallback` may fire when element is temporarily
   * removed, not necessarily "permanently destroyed". Use `destroy()` for permanent cleanup.
   */
  beforeDestroy?: () => void;

  // ===== Connection / Auth =====

  /** User clicks retry button (maps to `rtc-connection-retry` event) */
  connectionRetry?: () => void;

  /** User requests login (maps to `rtc-auth-login-requested` event) */
  authLoginRequested?: () => void;

  /** Authentication error (maps to `rtc-auth-refresh-failed` event) */
  authError?: () => void;

  /** User logs out (maps to `rtc-auth-logout` event) */
  authLogout?: () => void;

  /**
   * Connection state change (maps to `rtc-connection-state-change` event).
   *
   * Fires when the persistence layer's connection state transitions
   * (e.g. 'disconnected' -> 'connecting' -> 'connected').
   */
  connectionStateChange?: (detail: { state: import('@rtc-agent/client').ConnectionState }) => void;

  /**
   * Login successful (maps to `rtc-auth-login` event).
   *
   * Fires when authentication transitions to logged-in state. Covers all login paths:
   * - Initial token load (valid tokens in localStorage)
   * - Token refresh success (expired tokens refreshed on page load)
   * - Login dialog completion (user explicitly logs in)
   * - External token set (host application provides tokens via factory)
   */
  authLogin?: (detail: { userId: string }) => void;

  // ===== Session =====

  /** Session created (maps to `rtc-session-created` event) */
  sessionCreated?: (detail: { session: Session }) => void;

  /** Session switched (maps to `rtc-session-switched` event) */
  sessionSwitched?: (detail: { id: string }) => void;

  /** Session renamed (maps to `rtc-session-renamed` event) */
  sessionRenamed?: (detail: { id: string; title: string }) => void;

  /** Session deleted (maps to `rtc-session-deleted` event) */
  sessionDeleted?: (detail: { id: string }) => void;

  // ===== Message =====

  /** Message received (maps to `rtc-message-received` event) */
  messageReceived?: (detail: { message: Message }) => void;

  /** Message sent (maps to `rtc-message-sent` event) */
  messageSent?: (detail: { message: Message }) => void;

  // ===== Tool Call (EventBus bridging) =====

  /**
   * Tool call started (bridged from EventBus `function:start`).
   *
   * Fires when a tool function begins execution. The `path` field contains
   * the function path (e.g. `"myGroup/myFunction"`), and `params` contains
   * the validated arguments passed to the handler.
   */
  toolCallStart?: (detail: {
    /** Function path, e.g. "groupName/functionName" */
    path: string;
    /** Validated arguments passed to the handler */
    params: Record<string, unknown>;
  }) => void;

  /**
   * Tool call succeeded (bridged from EventBus `function:success`).
   *
   * Fires after the tool handler returns a value successfully.
   */
  toolCallSuccess?: (detail: {
    /** Function path, e.g. "groupName/functionName" */
    path: string;
    /** Return value of the handler */
    result: unknown;
  }) => void;

  /**
   * Tool call failed (bridged from EventBus `function:error`).
   *
   * Fires when the tool handler throws an error.
   */
  toolCallError?: (detail: {
    /** Function path, e.g. "groupName/functionName" */
    path: string;
    /** Error thrown by the handler */
    error: Error;
  }) => void;

  /**
   * Tool call progress (bridged from EventBus `function:progress`).
   *
   * Fires when the tool handler reports progress via the `onProgress` callback.
   */
  toolCallProgress?: (detail: {
    /** Function path, e.g. "groupName/functionName" */
    path: string;
    /** Progress value reported by the handler (typically 0–100) */
    progress: number;
  }) => void;
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

  /**
   * Event callbacks for the agent.
   *
   * Each callback is automatically registered via `addEventListener()` on the component.
   * Callbacks are removed when `destroy()` is called.
   */
  on?: EventCallbacks;
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
  /** @internal Event callback unsubscribes for cleanup */
  _eventUnsubscribes?: Array<() => void>;

  /** @internal EventBus unsubscribes for cleanup */
  _eventBusUnsubscribes?: Array<() => void>;

  /**
   * Permanently destroy the agent instance.
   *
   * Performs complete cleanup:
   * 1. Removes element from DOM (triggers disconnectedCallback)
   * 2. Clears external token references (added in Phase 2)
   * 3. Cancels all DOM event subscriptions (added in Phase 3 part 1)
   * 4. Cancels all EventBus subscriptions (added in Phase 3 part 2)
   * 5. Optionally clears localStorage tokens
   *
   * After calling destroy(), the agent instance should not be reused.
   */
  destroy(): void;
}
