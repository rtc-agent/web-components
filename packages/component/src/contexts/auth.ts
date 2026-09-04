import {createContext} from '@lit/context';
import type {AuthState} from '../types/index.js';

/**
 * Auth Context — tracks login status and tokens.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-login-page>, <rtc-content-wrapper>
 *
 * Note: Token persistence and OAuth2 flows are managed by AuthController.
 * setTokens() is a root-level coordination method, NOT exposed on this context.
 *
 * **设计例外**：与其他 context 的 `{state, actions}` 模式不同，
 * AuthContext 将 `login`/`logout` 直接放在顶层（与 `state` 并列）。
 * 理由：Auth 只有两个动作，包装成 `actions` 子对象徒增冗余，
 * 且 `el.login()` 比 `el.actions.login()` 更符合语义直觉。
 */
export interface AuthContextValue {
    state: AuthState;

    /** Trigger OAuth2 login flow (UI dispatches event; root handles). */
    login(): void;

    /** Clear auth state and return to login page. */
    logout(): void;
}

export const AuthContext = createContext<AuthContextValue>(
    Symbol('auth-context')
);

/** Default auth state — not logged in. */
export const DEFAULT_AUTH_STATE: AuthState = {
    isLoggedIn: false,
};
