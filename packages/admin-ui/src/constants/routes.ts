/**
 * Shared route path constants
 *
 * Centralizes public/auth route paths to avoid duplication across:
 * - app.tsx (getInitialState, onPageChange)
 * - requestErrorConfig.ts (redirectToLogin)
 * - GlobalRtcAgent (excluded paths check)
 */

/** Centralized public (unauthenticated) route paths */
export const PUBLIC_PATHS = {
  login: '/user/login',
  register: '/user/register',
  registerResult: '/user/register-result',
} as const;

/** Check if a pathname is a public (unauthenticated) route */
export function isPublicPath(pathname: string): boolean {
  // Exact match against known public paths, with optional trailing slash
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    normalized === PUBLIC_PATHS.login ||
    normalized === PUBLIC_PATHS.register ||
    normalized === PUBLIC_PATHS.registerResult
  );
}
