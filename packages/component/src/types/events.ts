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

import type { ConnectionState } from '@rtc-agent/client';
import type { Session, Message } from './index.js';

/**
 * Public custom events (for external host application listeners)
 *
 * Detail type explanation:
 * - `void`: event has no payload
 * - `T`: event payload type is T
 */
export interface RtcAgentEventDetailMap {
  // ── Lifecycle ──

  /** Component first render complete; safe to set agentConfig / registry */
  'rtc-agent-ready': void;
  /** Component is about to be removed from DOM (fires before disconnectedCallback cleanup) */
  'rtc-before-destroy': void;
  /** Theme changed (triggered by attribute change or 'system' following system preference) */
  'rtc-theme-change': { theme: 'light' | 'dark' | 'system' };

  // ── Message interception ──

  /** Intercept before message send (cancel via preventDefault(), or modify detail.message.content) */
  'rtc-before-message-send': { message: { content: string; metadata?: Record<string, unknown> } };

  // ── Connection & Auth ──

  /** User clicks the retry button */
  'rtc-connection-retry': void;
  /** Connection state transitions (disconnected → connecting → connected, etc.) */
  'rtc-connection-state-change': { state: ConnectionState; reason?: string };
  /** User requests login (login dialog submitted) */
  'rtc-auth-login-requested': void;
  /** Login successful (covers initial load, token refresh, manual login, external token set) */
  'rtc-auth-login': { userId: string };
  /** Auth token refresh failed */
  'rtc-auth-refresh-failed': void;
  /** User logs out */
  'rtc-auth-logout': void;
  /** User's account has been banned (disconnect code 4501) */
  'rtc-account-banned': { reason?: string };

  // ── Session ──

  /** New session created */
  'rtc-session-created': { session: Session };
  /** Session switched */
  'rtc-session-switched': { id: string };
  /** Session renamed */
  'rtc-session-renamed': { id: string; title: string };
  /** Session deleted */
  'rtc-session-deleted': { id: string };

  // ── Message ──

  /** AI message received */
  'rtc-message-received': { message: Message };
  /** User message sent */
  'rtc-message-sent': { message: Message };
}

// Globally extend HTMLElementEventMap so addEventListener automatically supports these events
declare global {
  interface HTMLElementEventMap {
    // Lifecycle
    'rtc-agent-ready': CustomEvent<RtcAgentEventDetailMap['rtc-agent-ready']>;
    'rtc-before-destroy': CustomEvent<RtcAgentEventDetailMap['rtc-before-destroy']>;
    'rtc-theme-change': CustomEvent<RtcAgentEventDetailMap['rtc-theme-change']>;

    // Message interception
    'rtc-before-message-send': CustomEvent<RtcAgentEventDetailMap['rtc-before-message-send']>;

    // Connection & Auth
    'rtc-connection-retry': CustomEvent<RtcAgentEventDetailMap['rtc-connection-retry']>;
    'rtc-connection-state-change': CustomEvent<RtcAgentEventDetailMap['rtc-connection-state-change']>;
    'rtc-auth-login-requested': CustomEvent<RtcAgentEventDetailMap['rtc-auth-login-requested']>;
    'rtc-auth-login': CustomEvent<RtcAgentEventDetailMap['rtc-auth-login']>;
    'rtc-auth-refresh-failed': CustomEvent<RtcAgentEventDetailMap['rtc-auth-refresh-failed']>;
    'rtc-auth-logout': CustomEvent<RtcAgentEventDetailMap['rtc-auth-logout']>;
    'rtc-account-banned': CustomEvent<RtcAgentEventDetailMap['rtc-account-banned']>;

    // Session
    'rtc-session-created': CustomEvent<RtcAgentEventDetailMap['rtc-session-created']>;
    'rtc-session-switched': CustomEvent<RtcAgentEventDetailMap['rtc-session-switched']>;
    'rtc-session-renamed': CustomEvent<RtcAgentEventDetailMap['rtc-session-renamed']>;
    'rtc-session-deleted': CustomEvent<RtcAgentEventDetailMap['rtc-session-deleted']>;

    // Message
    'rtc-message-received': CustomEvent<RtcAgentEventDetailMap['rtc-message-received']>;
    'rtc-message-sent': CustomEvent<RtcAgentEventDetailMap['rtc-message-sent']>;
  }
}
