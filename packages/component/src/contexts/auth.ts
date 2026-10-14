import { createContext } from '@lit/context';
import type { AuthState } from '../types/index.js';

/**
 * Auth Actions — authentication operations.
 *
 * Consistent with other Contexts (SessionContext, ModeContext, etc.) that follow
 * the `{state, actions}` pattern. This ensures a uniform API across all contexts.
 */
export interface AuthActions {
  /** Trigger OAuth2 login flow (UI dispatches event; root handles). */
  login(): void;

  /** Clear auth state and return to login page. */
  logout(): void;
}

/**
 * Auth Context — tracks login status and tokens.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-login-page>, <rtc-content-wrapper>
 *
 * Note: Token persistence and OAuth2 flows are managed by AuthController.
 * setTokens() is a root-level coordination method, NOT exposed on this context.
 *
 * **Design**: Follows the standard `{state, actions}` pattern consistent with
 * other Contexts (SessionContext, ModeContext, ActivityContext, etc.).
 * This ensures a uniform API across all contexts, making them predictable and easy to use.
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
 *     const { state, actions } = this._authContext;
 *     if (!state.isLoggedIn) {
 *       return html`<button @click=${actions.login}>Login</button>`;
 *     }
 *     return html`<button @click=${actions.logout}>Logout</button>`;
 *   }
 * }
 * ```
 */
export interface AuthContextValue {
  state: AuthState;
  actions: AuthActions;
}

export const AuthContext = createContext<AuthContextValue>(
  Symbol('auth-context'),
);

/** Default auth state — not logged in. */
export const DEFAULT_AUTH_STATE: AuthState = {
  isLoggedIn: false,
};
