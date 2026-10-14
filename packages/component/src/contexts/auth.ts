import { createContext } from '@lit/context';
import type { AuthState } from '../types/index.js';

/**
 * Auth Context — tracks login status and tokens.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-login-page>, <rtc-content-wrapper>
 *
 * Note: Token persistence and OAuth2 flows are managed by AuthController.
 * setTokens() is a root-level coordination method, NOT exposed on this context.
 *
 * **Design exception**: Unlike other contexts that follow the `{state, actions}` pattern,
 * AuthContext places `login`/`logout` directly at the top level (alongside `state`).
 * Rationale: Auth has only two actions, so wrapping them in an `actions` sub-object
 * would add unnecessary redundancy, and `el.login()` is more semantically intuitive
 * than `el.actions.login()`.
 *
 * @example
 * ```ts
 * // Consuming in a LitElement component:
 * import { consume } from '@lit/context';
 * import { AuthContext, type AuthContextValue } from './contexts/auth.js';
 *
 * class MyComponent extends LitElement {
 *   @consume({ context: AuthContext })
 *   private _authContext!: AuthContextValue;
 *
 *   render() {
 *     const { state, login, logout } = this._authContext;
 *     if (!state.isLoggedIn) {
 *       return html`<button @click=${login}>Login</button>`;
 *     }
 *     return html`<button @click=${logout}>Logout</button>`;
 *   }
 * }
 * ```
 */
export interface AuthContextValue {
  state: AuthState;

  /** Trigger OAuth2 login flow (UI dispatches event; root handles). */
  login(): void;

  /** Clear auth state and return to login page. */
  logout(): void;
}

export const AuthContext = createContext<AuthContextValue>(
  Symbol('auth-context'),
);

/** Default auth state — not logged in. */
export const DEFAULT_AUTH_STATE: AuthState = {
  isLoggedIn: false,
};
