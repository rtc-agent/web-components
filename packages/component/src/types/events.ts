/**
 * RtcAgent Event Type Map
 *
 * Extends HTMLElementEventMap globally to provide type-safe addEventListener
 * for custom events dispatched by <rtc-agent>.
 *
 * Design points:
 * - Extend, don't override: preserve type inference for native HTMLElement events
 *   and internal events (e.g. rtc-window-minimize), while adding public events
 *   like rtc-agent-ready.
 * - To add a new public event, simply add an entry to RtcAgentEventMap.
 *
 * @example
 * ```ts
 * const agent = document.querySelector<RtcAgent>('#agent')!;
 * agent.addEventListener('rtc-agent-ready', (e) => {
 *   e.detail;  // void -- type-safe
 * });
 * agent.addEventListener('click', (e) => {
 *   e.clientX;  // number -- native events remain type-safe
 * });
 * agent.addEventListener('typo-event', ...);  // ✗ TS error
 * ```
 */

/**
 * Public custom events (for external host application listeners)
 *
 * Detail type explanation:
 * - `void`: event has no payload
 * - `T`: event payload type is T
 */
export interface RtcAgentEventDetailMap {
  /** Component first render complete; safe to set agentConfig / registry */
  'rtc-agent-ready': void;
  /** Theme changed (triggered by attribute change or 'system' following system preference) */
  'rtc-theme-change': { theme: 'light' | 'dark' | 'system' };
  /** Component is about to be removed from DOM (fires before disconnectedCallback cleanup) */
  'rtc-before-destroy': void;
  /** Intercept before message send (cancel via preventDefault(), or modify detail.message.content) */
  'rtc-before-message-send': { message: { content: string; metadata?: Record<string, unknown> } };
}

// Globally extend HTMLElementEventMap so addEventListener automatically supports these events
declare global {
  interface HTMLElementEventMap {
    'rtc-agent-ready': CustomEvent<RtcAgentEventDetailMap['rtc-agent-ready']>;
    'rtc-theme-change': CustomEvent<RtcAgentEventDetailMap['rtc-theme-change']>;
    'rtc-before-destroy': CustomEvent<RtcAgentEventDetailMap['rtc-before-destroy']>;
    'rtc-before-message-send': CustomEvent<RtcAgentEventDetailMap['rtc-before-message-send']>;
  }
}
