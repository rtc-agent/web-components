/**
 * 相对时间格式化工具
 *
 * 使用原生 Intl.RelativeTimeFormat，无需第三方库。
 * 支持中英文，自动选择最佳单位（秒/分钟/小时/天/周/月/年）。
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
 * 格式化时间戳为相对时间
 * @param timestamp 毫秒时间戳
 * @param locale 语言环境，默认中文
 * @returns 相对时间字符串，如 "3分钟前"、"2小时前"、"5天前"
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
