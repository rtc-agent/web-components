/**
 * Locale constants shared across the application.
 *
 * Keep these in sync with `public/scripts/set-dir.js` (which runs before
 * any TypeScript modules are loaded and therefore cannot import this file).
 */

/**
 * RTL (Right-to-Left) language prefixes.
 *
 * Used by both the runtime `locale-helpers.ts` and the early `set-dir.js`
 * script to determine the document direction.
 */
export const RTL_LOCALES = ['fa', 'ar', 'he', 'ur'] as const;
