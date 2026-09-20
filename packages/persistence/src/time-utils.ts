/**
 * Time formatting utilities
 *
 * Generates RFC3339 timestamps consistent with the Go server.
 * Server format example: 2026-09-02T17:55:13.228132+08:00
 */

/**
 * Generate an RFC3339-formatted timestamp for the given date.
 *
 * Format: YYYY-MM-DDTHH:mm:ss.SSS+08:00
 * Note: JavaScript only supports millisecond precision (3 digits),
 * while the server uses microsecond precision (6 digits).
 * Millisecond precision is sufficient for ordering purposes.
 */
export function formatRFC3339(date: Date = new Date()): string {
  // Convert to local-timezone RFC3339 format
  // RFC3339: 2026-09-02T17:55:13.228+08:00 (local timezone)

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  // Get timezone offset
  const timezoneOffset = -date.getTimezoneOffset();
  const offsetHours = String(Math.floor(Math.abs(timezoneOffset) / 60)).padStart(2, '0');
  const offsetMinutes = String(Math.abs(timezoneOffset) % 60).padStart(2, '0');
  const offsetSign = timezoneOffset >= 0 ? '+' : '-';

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

/**
 * Get the current time as an RFC3339-formatted string.
 */
export function nowRFC3339(): string {
  return formatRFC3339(new Date());
}
