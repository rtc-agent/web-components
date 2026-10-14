/**
 * Context Runtime Validation Utilities
 *
 * P1 Fix: Provides lightweight runtime type checking for Context values.
 * When Context data flows from providers to consumers, type mismatches can cause
 * silent errors (e.g., accessing undefined properties). These validators catch
 * such issues early and log warnings for debugging.
 *
 * Design principles:
 * 1. **Lightweight**: Only check critical fields, not full type compliance
 * 2. **Dev-only**: Warnings don't block production behavior
 * 3. **Fail-safe**: Validators return true for valid data, false for invalid
 * 4. **Informative**: Clear error messages help locate the source of issues
 *
 * Usage:
 * ```ts
 * import { validateAuthContext, validateSessionContext } from './context-validation.js';
 *
 * // In a component's render or willUpdate:
 * if (!validateAuthContext(authContext)) {
 *   // Handle invalid context (log already emitted)
 * }
 * ```
 */

import { createLogger } from '@rtc-agent/protocol';
import type { AuthContextValue } from '../contexts/auth.js';
import type { SessionContextValue } from '../contexts/session.js';
import type { MessageContextValue } from '../contexts/message.js';
import type { ModeContextValue } from '../contexts/mode.js';
import type { ActivityContextValue } from '../contexts/activity.js';

const log = createLogger('ContextValidation');

/**
 * Validate AuthContext value structure.
 *
 * Checks for critical fields:
 * - `state` object with `isLoggedIn` boolean
 * - `actions` object with `login` and `logout` functions
 *
 * @param ctx - The AuthContext value to validate
 * @returns true if valid, false if invalid (warning logged)
 */
export function validateAuthContext(ctx: unknown): ctx is AuthContextValue {
  if (!ctx || typeof ctx !== 'object') {
    log.warn('AuthContext is not an object:', typeof ctx);
    return false;
  }

  const c = ctx as Record<string, unknown>;

  // Check state
  if (!c.state || typeof c.state !== 'object') {
    log.warn('AuthContext.state is not an object:', typeof c.state);
    return false;
  }

  const state = c.state as Record<string, unknown>;
  if (typeof state.isLoggedIn !== 'boolean') {
    log.warn(
      'AuthContext.state.isLoggedIn is not a boolean:',
      typeof state.isLoggedIn,
    );
    return false;
  }

  // Check actions (P1 Fix: now actions are in a sub-object)
  if (!c.actions || typeof c.actions !== 'object') {
    log.warn('AuthContext.actions is not an object:', typeof c.actions);
    return false;
  }

  const actions = c.actions as Record<string, unknown>;
  if (typeof actions.login !== 'function') {
    log.warn(
      'AuthContext.actions.login is not a function:',
      typeof actions.login,
    );
    return false;
  }

  if (typeof actions.logout !== 'function') {
    log.warn(
      'AuthContext.actions.logout is not a function:',
      typeof actions.logout,
    );
    return false;
  }

  return true;
}

/**
 * Validate SessionContext value structure.
 *
 * Checks for critical fields:
 * - `state` object with `sessions` array and `currentSessionId` (string or null)
 * - `actions` object with required functions
 *
 * @param ctx - The SessionContext value to validate
 * @returns true if valid, false if invalid (warning logged)
 */
export function validateSessionContext(
  ctx: unknown,
): ctx is SessionContextValue {
  if (!ctx || typeof ctx !== 'object') {
    log.warn('SessionContext is not an object:', typeof ctx);
    return false;
  }

  const c = ctx as Record<string, unknown>;

  // Check state
  if (!c.state || typeof c.state !== 'object') {
    log.warn('SessionContext.state is not an object:', typeof c.state);
    return false;
  }

  const state = c.state as Record<string, unknown>;
  if (!Array.isArray(state.sessions)) {
    log.warn(
      'SessionContext.state.sessions is not an array:',
      typeof state.sessions,
    );
    return false;
  }

  if (
    state.currentSessionId !== null &&
    typeof state.currentSessionId !== 'string'
  ) {
    log.warn(
      'SessionContext.state.currentSessionId is not string|null:',
      typeof state.currentSessionId,
    );
    return false;
  }

  // Check actions
  if (!c.actions || typeof c.actions !== 'object') {
    log.warn('SessionContext.actions is not an object:', typeof c.actions);
    return false;
  }

  const actions = c.actions as Record<string, unknown>;
  if (typeof actions.setCurrentSession !== 'function') {
    log.warn(
      'SessionContext.actions.setCurrentSession is not a function:',
      typeof actions.setCurrentSession,
    );
    return false;
  }

  return true;
}

/**
 * Validate MessageContext value structure.
 *
 * Checks for critical fields:
 * - `state` object with `messages` array
 * - `actions` object with required functions
 *
 * @param ctx - The MessageContext value to validate
 * @returns true if valid, false if invalid (warning logged)
 */
export function validateMessageContext(
  ctx: unknown,
): ctx is MessageContextValue {
  if (!ctx || typeof ctx !== 'object') {
    log.warn('MessageContext is not an object:', typeof ctx);
    return false;
  }

  const c = ctx as Record<string, unknown>;

  // Check state
  if (!c.state || typeof c.state !== 'object') {
    log.warn('MessageContext.state is not an object:', typeof c.state);
    return false;
  }

  const state = c.state as Record<string, unknown>;
  if (!Array.isArray(state.messages)) {
    log.warn(
      'MessageContext.state.messages is not an array:',
      typeof state.messages,
    );
    return false;
  }

  // Check actions
  if (!c.actions || typeof c.actions !== 'object') {
    log.warn('MessageContext.actions is not an object:', typeof c.actions);
    return false;
  }

  const actions = c.actions as Record<string, unknown>;
  if (typeof actions.sendMessage !== 'function') {
    log.warn(
      'MessageContext.actions.sendMessage is not a function:',
      typeof actions.sendMessage,
    );
    return false;
  }

  return true;
}

/**
 * Validate ModeContext value structure.
 *
 * Checks for critical fields:
 * - `state` object with `currentMode` string
 * - `actions` object with required functions
 *
 * @param ctx - The ModeContext value to validate
 * @returns true if valid, false if invalid (warning logged)
 */
export function validateModeContext(ctx: unknown): ctx is ModeContextValue {
  if (!ctx || typeof ctx !== 'object') {
    log.warn('ModeContext is not an object:', typeof ctx);
    return false;
  }

  const c = ctx as Record<string, unknown>;

  // Check state
  if (!c.state || typeof c.state !== 'object') {
    log.warn('ModeContext.state is not an object:', typeof c.state);
    return false;
  }

  const state = c.state as Record<string, unknown>;
  if (typeof state.currentMode !== 'string') {
    log.warn(
      'ModeContext.state.currentMode is not a string:',
      typeof state.currentMode,
    );
    return false;
  }

  // Check actions
  if (!c.actions || typeof c.actions !== 'object') {
    log.warn('ModeContext.actions is not an object:', typeof c.actions);
    return false;
  }

  return true;
}

/**
 * Validate ActivityContext value structure.
 *
 * Checks for critical fields:
 * - `state` object with `active` string
 * - `actions` object with required functions
 *
 * @param ctx - The ActivityContext value to validate
 * @returns true if valid, false if invalid (warning logged)
 */
export function validateActivityContext(
  ctx: unknown,
): ctx is ActivityContextValue {
  if (!ctx || typeof ctx !== 'object') {
    log.warn('ActivityContext is not an object:', typeof ctx);
    return false;
  }

  const c = ctx as Record<string, unknown>;

  // Check state
  if (!c.state || typeof c.state !== 'object') {
    log.warn('ActivityContext.state is not an object:', typeof c.state);
    return false;
  }

  const state = c.state as Record<string, unknown>;
  if (typeof state.active !== 'string') {
    log.warn(
      'ActivityContext.state.active is not a string:',
      typeof state.active,
    );
    return false;
  }

  // Check actions
  if (!c.actions || typeof c.actions !== 'object') {
    log.warn('ActivityContext.actions is not an object:', typeof c.actions);
    return false;
  }

  return true;
}
