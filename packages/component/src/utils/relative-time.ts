/**
 * Relative time formatting utilities
 *
 * Uses native Intl.RelativeTimeFormat, no third-party library needed.
 * Automatically uses current locale from i18n system.
 * Supports any locale, automatically selects the best unit (seconds/minutes/hours/days/weeks/months/years).
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
 * Format a timestamp as relative time
 * @param timestamp Millisecond timestamp
 * @param locale Optional locale override (defaults to current i18n locale)
 * @returns Relative time string, e.g. "3 minutes ago", "2 hours ago", "5 days ago"
 */
export function formatRelativeTime(timestamp: number, locale?: string): string {
  const lang = locale ?? getLocale();
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  let duration = (timestamp - Date.now()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.name);
    }
    duration /= division.amount;
  }

  return rtf.format(Math.round(duration), 'years');
}
