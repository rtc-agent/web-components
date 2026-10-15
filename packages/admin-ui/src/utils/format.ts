/**
 * Format Utilities for Admin UI
 *
 * Design Decision:
 * This package maintains its own formatting utilities separate from the
 * component package (packages/component/src/utils/format.ts) because:
 *
 * 1. **Different Runtime Environments**: admin-ui is a React/Umi application,
 *    while component is a standalone Web Component library using Lit.
 *    They have different locale management strategies (getLocale() from @umijs/max
 *    vs getLocale() from @lit/localize).
 *
 * 2. **Independence**: admin-ui should not depend on the component package's
 *    internal utilities to maintain clear package boundaries and avoid
 *    circular dependencies.
 *
 * 3. **Feature Parity**: Both packages provide similar formatting functions
 *    (formatNumber, formatCurrency) but with implementations tailored to
 *    their respective ecosystems.
 *
 * For new code, prefer using these admin-ui utilities when working within
 * the admin-ui package context.
 *
 * Timezone Design:
 * All date formatting uses the browser's local timezone by default (via Intl APIs).
 * This is intentional because:
 * - Admin users expect times in their local timezone
 * - Intl.DateTimeFormat with timeZone option can override this when needed
 * - dayjs relative time (fromNow) also uses local timezone by default
 * If server-side timezone handling is required, consider using UTC timestamps
 * and converting on the client with explicit timeZone options.
 */

import { getLocale } from '@umijs/max';
import type { ConfigType } from 'dayjs';
import dayjs from 'dayjs';

/**
 * Cache for NumberFormat instances to avoid repeated allocations.
 * Key format: `${locale}_${options_hash}`
 *
 * NOTE: Similar caching exists in component package, but implementations
 * differ slightly due to different runtime requirements.
 */
const numberFormatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Get or create a cached NumberFormat instance.
 * Cache key is built from commonly-used option fields to avoid JSON.stringify overhead.
 */
function getCachedNumberFormatter(
  locale: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  // Build cache key from commonly-used option fields
  const optsKey = options
    ? `${options.minimumFractionDigits ?? ''}${options.maximumFractionDigits ?? ''}${options.style ?? ''}${options.currency ?? ''}`
    : '';
  const cacheKey = `${locale}_${optsKey}`;

  let formatter = numberFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatterCache.set(cacheKey, formatter);
  }

  return formatter;
}

/**
 * Format a number with thousand separators, locale-aware.
 * Replaces numeral(val).format('0,0')
 *
 * @param val - Number to format
 * @param locale - BCP 47 language tag (default: current locale from getLocale())
 */
export const formatNumber = (
  val: number | string,
  locale: string = getLocale(),
): string => {
  const parsed = Number(val);
  if (!Number.isFinite(parsed)) {
    return '';
  }

  try {
    return getCachedNumberFormatter(locale).format(parsed);
  } catch {
    // Fallback to US format if locale is invalid
    return getCachedNumberFormatter('en-US').format(parsed);
  }
};

/**
 * Format a number as currency string, locale-aware.
 * Replaces hardcoded ¥ symbol with proper Intl support.
 *
 * @param val - Number to format
 * @param currency - ISO 4217 currency code (default: 'CNY')
 * @param locale - BCP 47 language tag (default: current locale from getLocale())
 */
export const formatCurrency = (
  val: number | string,
  currency: string = 'CNY',
  locale: string = getLocale(),
): string => {
  const parsed = Number(val);
  if (!Number.isFinite(parsed)) {
    return '';
  }

  try {
    return getCachedNumberFormatter(locale, {
      style: 'currency',
      currency,
    }).format(parsed);
  } catch {
    // Fallback to simple format if locale or currency is invalid
    return `${currency} ${parsed.toFixed(2)}`;
  }
};

/**
 * Format a number as yuan currency string (backward compatible).
 * Uses formatCurrency with CNY and zh-CN locale.
 *
 * @param val - Number to format
 * @deprecated Use formatCurrency for new code
 */
export const formatYuan = (val: number | string, locale: string = 'zh-CN') =>
  formatCurrency(val, 'CNY', locale);

/**
 * Format a date as relative time (e.g., "5 minutes ago", "in 2 hours").
 *
 * Uses dayjs relativeTime plugin with automatic locale support.
 * Timezone: Uses browser's local timezone by design (see module docblock).
 *
 * @param date - Date input (ISO string, timestamp, Date object, etc.)
 * @param locale - BCP 47 language tag (default: current locale from getLocale())
 * @returns Relative time string (e.g., "5 minutes ago", "in 2 hours")
 *
 * @example
 * ```ts
 * formatRelativeTime('2024-01-01T10:00:00Z') // "2 hours ago"
 * formatRelativeTime(Date.now() - 300000)     // "5 minutes ago"
 * ```
 */
export const formatRelativeTime = (
  date: ConfigType,
  locale: string = getLocale(),
): string => {
  // Map Ant Design Pro locale codes to dayjs locale identifiers
  // Aligned with loadDayjsLocale in locale-helpers.ts
  const dayjsLocaleMap: Record<string, string> = {
    'zh-CN': 'zh-cn',
    'zh-TW': 'zh-tw',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
    'pt-BR': 'pt-br',
    'id-ID': 'id',
    'bn-BD': 'bn-bd',
    'fa-IR': 'fa',
  };

  const dayjsLocale = dayjsLocaleMap[locale] || locale.toLowerCase();

  try {
    return dayjs(date).locale(dayjsLocale).fromNow();
  } catch {
    // Fallback to English if locale is invalid
    return dayjs(date).fromNow();
  }
};

/**
 * Format a date with explicit timezone support using Intl.DateTimeFormat.
 *
 * Use this when you need to display times in a specific timezone different from
 * the browser's local timezone (e.g., showing server time, multi-timezone support).
 *
 * @param date - Date input (ISO string, timestamp, Date object)
 * @param timeZone - IANA timezone name (e.g., 'Asia/Shanghai', 'America/New_York', 'UTC')
 * @param options - Intl.DateTimeFormatOptions for formatting
 * @returns Formatted date string in the specified timezone
 *
 * @example
 * ```ts
 * formatWithTimeZone('2024-01-01T10:00:00Z', 'Asia/Shanghai')
 * // "2024-01-01 18:00:00" (UTC+8)
 *
 * formatWithTimeZone('2024-01-01T10:00:00Z', 'America/New_York', {
 *   dateStyle: 'medium',
 *   timeStyle: 'short'
 * })
 * // "Jan 1, 2024, 5:00 AM"
 * ```
 */
export const formatWithTimeZone = (
  date: ConfigType,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  },
): string => {
  const locale = getLocale();
  try {
    const dateObj = dayjs(date).toDate();
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
      dateObj,
    );
  } catch {
    // Fallback to local timezone if specified timezone is invalid
    return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
  }
};
