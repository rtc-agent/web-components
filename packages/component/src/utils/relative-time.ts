/**
 * Relative time formatting utilities
 *
 * Uses native Intl.RelativeTimeFormat, no third-party library needed.
 * Supports Chinese and English, automatically selects the best unit (seconds/minutes/hours/days/weeks/months/years).
 */

const rtfZh = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
const rtfEn = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

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
 * @param locale Locale, defaults to Chinese
 * @returns Relative time string, e.g. "3 minutes ago", "2 hours ago", "5 days ago"
 */
export function formatRelativeTime(
    timestamp: number,
    locale: 'zh-CN' | 'en-US' = 'zh-CN'
): string {
    const rtf = locale === 'zh-CN' ? rtfZh : rtfEn;
    let duration = (timestamp - Date.now()) / 1000;

    for (const division of DIVISIONS) {
        if (Math.abs(duration) < division.amount) {
            return rtf.format(Math.round(duration), division.name);
        }
        duration /= division.amount;
    }

    return rtf.format(Math.round(duration), 'years');
}
