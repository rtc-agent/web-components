import {createLogger} from '@rtc-agent/client';

const log = createLogger('Theme');

// Theme types
export type Theme = 'light' | 'dark' | 'system';

// Storage key for theme persistence
const STORAGE_KEY = 'rtc-agent-theme';

/**
 * Get the current effective theme (resolves 'system' to 'light' or 'dark')
 */
export function getEffectiveTheme(theme: Theme = getStoredTheme()): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/**
 * Get the stored theme preference from localStorage
 */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch (err) {
    log.debug('localStorage unavailable for reading theme:', err);
  }
  return 'system';
}

/**
 * Persist theme preference to localStorage
 */
export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (err) {
    log.debug('localStorage unavailable for persisting theme:', err);
  }
}

/**
 * Switch theme for all <rtc-agent> elements and persist the preference
 *
 * @example
 * ```ts
 * import { switchTheme } from '@rtc-agent/component';
 * await switchTheme('dark');
 * ```
 */
export function switchTheme(theme: Theme): void {
  // Persist to localStorage
  persistTheme(theme);

  // Update all <rtc-agent> elements
  const agents = document.querySelectorAll('rtc-agent');
  agents.forEach((agent) => {
    if ('theme' in agent) {
      (agent as {theme: Theme}).theme = theme;
    }
  });

  // Update document attribute for CSS selectors
  const effectiveTheme = getEffectiveTheme(theme);
  document.documentElement.setAttribute('data-theme', effectiveTheme);

  log.debug('Theme switched to:', theme);
}

/**
 * Initialize theme from stored preference
 * Should be called once on app startup
 */
export function initTheme(): void {
  const theme = getStoredTheme();
  const effectiveTheme = getEffectiveTheme(theme);
  document.documentElement.setAttribute('data-theme', effectiveTheme);
}
