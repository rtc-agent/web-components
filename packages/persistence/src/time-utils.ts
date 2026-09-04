/**
 * 时间格式化工具
 *
 * 用于生成与 Go 服务器一致的 RFC3339 格式时间戳
 * 服务器格式示例：2026-09-02T17:55:13.228132+08:00
 */

/**
 * 生成 RFC3339 格式的当前时间戳
 *
 * 格式：YYYY-MM-DDTHH:mm:ss.SSS+08:00
 * 注意：JavaScript 只能精确到毫秒（3位），服务器使用微秒（6位）
 * 但毫秒精度对于排序已经足够
 */
export function formatRFC3339(date: Date = new Date()): string {
  // 使用 date-fns 生成 ISO 格式，然后调整时区表示
  const isoString = date.toISOString();

  // 转换为本地时区的 RFC3339 格式
  // ISO: 2026-09-02T09:55:13.228Z (UTC)
  // RFC3339: 2026-09-02T17:55:13.228+08:00 (本地时区)

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  // 获取时区偏移
  const timezoneOffset = -date.getTimezoneOffset();
  const offsetHours = String(Math.floor(Math.abs(timezoneOffset) / 60)).padStart(2, '0');
  const offsetMinutes = String(Math.abs(timezoneOffset) % 60).padStart(2, '0');
  const offsetSign = timezoneOffset >= 0 ? '+' : '-';

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

/**
 * 获取当前时间的 RFC3339 格式字符串
 */
export function nowRFC3339(): string {
  return formatRFC3339(new Date());
}
