/**
 * Pluralization helper for i18n
 *
 * Uses Intl.PluralRules to select the correct plural form based on count and locale.
 * Supports the full set of ICU plural categories: zero, one, two, few, many, other.
 * This allows correct rendering for languages with complex plural rules such as
 * Arabic (6 forms), Russian (3 forms), Polish (4 forms), etc.
 *
 * Each form may contain a '#' placeholder which will be replaced with the count.
 *
 * @param count - The count to determine plural form
 * @param forms - Map of ICU plural categories to form strings. Must include 'other'.
 *                Each form may contain '#' as a placeholder for the numeric value.
 * @param locale - Optional locale string (defaults to current document locale)
 * @returns Formatted string with correct plural form and count substituted
 *
 * @example
 * // Simple English (one/other)
 * formatPluralCount(1, { one: '# task', other: '# tasks' }) // "1 task"
 * formatPluralCount(5, { one: '# task', other: '# tasks' }) // "5 tasks"
 *
 * @example
 * // Russian (one/few/many/other)
 * formatPluralCount(21, {
 *   one: '# задача',
 *   few: '# задачи',
 *   many: '# задач',
 *   other: '# задач',
 * }, 'ru') // "21 задача"
 *
 * @example
 * // Arabic (zero/one/two/few/many/other)
 * formatPluralCount(0, {
 *   zero: 'لا مهام',
 *   one: 'مهمة واحدة',
 *   two: 'مهمتان',
 *   few: '# مهام',
 *   many: '# مهمة',
 *   other: '# مهمة',
 * }, 'ar') // "لا مهام"
 */
export function formatPluralCount(
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
  locale?: string,
): string {
  const resolvedLocale = locale || document.documentElement.lang || 'zh-CN';
  const pr = new Intl.PluralRules(resolvedLocale);
  const category = pr.select(count);

  // Fall back to 'other' if the specific category form is not provided
  const form = forms[category] || forms.other;

  // Replace '#' placeholder with the actual count
  return form.replace(/#/g, count.toString());
}
