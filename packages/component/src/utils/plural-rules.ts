/**
 * Pluralization helper for i18n
 *
 * Uses Intl.PluralRules to select the correct plural form based on count and locale.
 *
 * @param count - The count to determine plural form
 * @param singular - Singular form (e.g., "1 task")
 * @param plural - Plural form (e.g., "2 tasks")
 * @param locale - Optional locale string (defaults to current document locale)
 * @returns Formatted string with correct plural form
 *
 * @example
 * formatPluralCount(1, 'task', 'tasks') // returns "1 task"
 * formatPluralCount(2, 'task', 'tasks') // returns "2 tasks"
 * formatPluralCount(0, 'task', 'tasks') // returns "0 tasks"
 */
export function formatPluralCount(
  count: number,
  singular: string,
  plural: string,
  locale?: string,
): string {
  // Use Intl.PluralRules to determine the plural category
  // 'one' = singular (1 item), 'other' = plural (0, 2+ items)
  const resolvedLocale = locale || document.documentElement.lang || 'en-US';
  const pr = new Intl.PluralRules(resolvedLocale);
  const category = pr.select(count);

  // For most languages, 'one' is singular, everything else is plural
  // Note: Some languages have more complex plural rules (dual, few, many)
  // but for simplicity we handle the common case
  const noun = category === 'one' ? singular : plural;

  return `${count} ${noun}`;
}
