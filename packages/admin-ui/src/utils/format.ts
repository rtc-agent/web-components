/**
 * Format a number with thousand separators, locale-aware.
 * Replaces numeral(val).format('0,0')
 *
 * @param val - Number to format
 * @param locale - BCP 47 language tag (default: 'en-US')
 */
export const formatNumber = (
  val: number | string,
  locale: string = 'en-US',
): string => {
  const parsed = Number(val);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat(locale).format(parsed)
    : '';
};

/**
 * Format a number as currency string, locale-aware.
 * Replaces hardcoded ¥ symbol with proper Intl support.
 *
 * @param val - Number to format
 * @param currency - ISO 4217 currency code (default: 'CNY')
 * @param locale - BCP 47 language tag (default: 'en-US')
 */
export const formatCurrency = (
  val: number | string,
  currency: string = 'CNY',
  locale: string = 'en-US',
): string => {
  const parsed = Number(val);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
      }).format(parsed)
    : '';
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
