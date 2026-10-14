import { createContext } from '@lit/context';
import type { SessionState, SessionActions } from '../types/index.js';

/**
 * Session Context — holds session list and current session.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-session-header>, <rtc-session-panel>, <rtc-content-area>
 *
 * @example
 * ```ts
 * // Consuming in a LitElement component:
 * import { consume } from '@lit/context';
 * import { SessionContext, type SessionContextValue } from './contexts/session.js';
 *
 * class MyComponent extends LitElement {
 *   @consume({ context: SessionContext })
 *   private _sessionContext!: SessionContextValue;
 *
 *   render() {
 *     const { state, actions } = this._sessionContext;
 *     return html`
 *       <div>Current session: ${state.currentSessionId}</div>
 *       <button @click=${() => actions.createSession()}>New Session</button>
 *     `;
 *   }
 * }
 * ```
 *
 * @example
 * ```ts
 * // Providing in a root component:
 * import { provide } from '@lit/context';
 * import { SessionContext } from './contexts/session.js';
 *
 * class RtcAgent extends LitElement {
 *   @provide({ context: SessionContext })
 *   private _sessionContext: SessionContextValue = {
 *     state: { sessions: [], currentSessionId: null },
 *     actions: {
 *       createSession: () => { ... },
 *       deleteSession: (id) => { ... },
 *       setCurrentSession: (id) => { ... },
 *     },
 *   };
 * }
 * ```
 */
export interface SessionContextValue {
  state: SessionState;
  actions: SessionActions;
}

export const SessionContext = createContext<SessionContextValue>(
  Symbol('session-context'),
);

export const DEFAULT_SESSION_STATE: SessionState = {
  sessions: [],
  currentSessionId: null,
};
