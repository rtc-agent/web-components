/**
 * Sensitive Data Masking Utilities
 *
 * Prevent accidental leakage of user identifiers and other PII in logs,
 * debug output, and error messages. All masking functions are pure and
 * safe to call with empty or undefined input.
 */

/**
 * Mask a user identifier so that only the first 3 and last 3 characters
 * remain visible. Short IDs (<=6 chars) are fully replaced with "***".
 *
 * @example
 * maskUserID('550e8400-e29b') // => '550***29b'
 * maskUserID('abc')           // => '***'
 * maskUserID('')              // => ''
 */
export function maskUserID(userID: string | undefined | null): string {
  if (!userID) return '';
  if (userID.length <= 6) return '***';
  return `${userID.slice(0, 3)}***${userID.slice(-3)}`;
}

/**
 * Mask an email address, keeping only the first character of the local
 * part and the full domain.
 *
 * @example
 * maskEmail('alice@example.com') // => 'a***@example.com'
 */
export function maskEmail(email: string | undefined | null): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 0) return maskUserID(email);
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 1) return `***${domain}`;
  return `${local[0]}***${domain}`;
}
