/**
 * Relative time formatting utilities
 *
 * Uses native Intl.RelativeTimeFormat, no third-party library needed.
 * Automatically uses current locale from i18n system.
 * Supports any locale, automatically selects the best unit (seconds/minutes/hours/days/weeks/months/years).
 *
 * Note: Component package intentionally supports only zh-CN and en-US to minimize bundle size.
 * Admin UI supports 9 languages for broader enterprise deployment.
 * See lit-localize.json for configuration details.
 */

import { getLocale } from '../core/i18n.js';

const DIVISIONS: { amount: number; name: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, name: 'seconds' },
  { amount: 60, name: 'minutes' },
  { amount: 24, name: 'hours' },
  { amount: 7, name: 'days' },
  { amount: 4.34524, name: 'weeks' },
  { amount: 12, name: 'months' },
  { amount: Number.POSITIVE_INFINITY, name: 'years' },
];

/**
 * Cache for RelativeTimeFormat instances to avoid repeated allocations.
 * Key format: `${locale}`
 */
const relativeTimeFormatterCache = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Get or create a cached RelativeTimeFormat instance.
 */
function getCachedRelativeTimeFormatter(
  locale: string,
): Intl.RelativeTimeFormat {
  let formatter = relativeTimeFormatterCache.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeTimeFormatterCache.set(locale, formatter);
  }
  return formatter;
}

/**
 * Clear relative time formatter cache to free memory and ensure fresh formatters after locale switch.
 *
 * Called automatically when locale changes via `switchLocale()` in format.ts.
 */
export function clearRelativeTimeFormatterCache(): void {
  relativeTimeFormatterCache.clear();
}

/**
 * Format a timestamp as relative time
 * @param timestamp Millisecond timestamp
 * @param locale Optional locale override (defaults to current i18n locale)
 * @returns Relative time string, e.g. "just now", "3 minutes ago", "2 hours ago", "5 days ago"
 */
export function formatRelativeTime(timestamp: number, locale?: string): string {
  const lang = locale ?? getLocale();
  const duration = (timestamp - Date.now()) / 1000;

  // Get or create a cached RelativeTimeFormat instance for the locale
  const rtf = getCachedRelativeTimeFormatter(lang);

  // Special case: very recent times (< 5 seconds) show "just now"
  // Intl.RelativeTimeFormat with numeric: 'auto' handles this automatically:
  // - en: "just now"
  // - zh: "刚刚"
  // - other locales: locale-appropriate "just now" translation
  if (Math.abs(duration) < 5) {
    return rtf.format(0, 'seconds');
  }

  let normalizedDuration = duration;

  for (const division of DIVISIONS) {
    if (Math.abs(normalizedDuration) < division.amount) {
      return rtf.format(Math.round(normalizedDuration), division.name);
    }
    normalizedDuration /= division.amount;
  }

  return rtf.format(Math.round(normalizedDuration), 'years');
}
