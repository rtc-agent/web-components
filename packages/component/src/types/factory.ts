/**
 * Type definitions for the `createRtcAgent` factory function.
 *
 * @module factory-types
 */

/**
 * Configuration for the `createRtcAgent` factory function.
 *
 * Only simple, direct-assignment properties are mapped in Phase 1.
 * Subsequent phases will add support for window, activityBar, functions,
 * groups, persona, auth, and event callbacks.
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

  // ── Reserved for future phases ──
  // window?: WindowConfig;        // Phase 2
  // activityBar?: ActivityBarConfig; // Phase 2
  // functions?: FunctionConfig;   // Phase 2
  // groups?: GroupConfig;         // Phase 2
  // persona?: PersonaConfig;      // Phase 2
  // auth?: AuthConfig;            // Phase 2
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
