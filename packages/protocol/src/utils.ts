/**
 * Shared Utility Functions
 *
 * Common utilities used across multiple packages.
 */

/**
 * Parse the payload from a JWT token (without signature verification).
 *
 * Splits the token by `.`, decodes the middle segment (payload) from base64,
 * and parses it as JSON. Returns `null` if the token is malformed or parsing fails.
 *
 * ## SECURITY WARNING
 *
 * **This function does NOT verify the JWT signature.**
 *
 * @security SIGNATURE_NOT_VERIFIED
 *
 * **Intended use cases:**
 * - Client-side inspection only (e.g., extracting claims for display)
 * - Local filtering or UI logic based on token contents
 * - Parsing tokens received from a trusted source
 *
 * **DO NOT use this function for:**
 * - Authorization or authentication decisions
 * - Security-critical operations that depend on token integrity
 * - Verifying that a token was issued by a trusted party
 *
 * For security-critical operations, the server MUST validate the signature.
 * Never trust client-side JWT parsing for access control.
 *
 * @param token - The JWT token string (format: header.payload.signature)
 * @returns The parsed payload as a record, or `null` if parsing failed
 *
 * @example
 * ```typescript
 * // SAFE: Display user info in UI
 * const payload = parseJwtPayload(token);
 * if (payload) {
 *   showUserName(payload.name);
 * }
 *
 * // UNSAFE: Making authorization decisions
 * const payload = parseJwtPayload(token);
 * if (payload?.role === 'admin') {  // DANGEROUS - signature not verified!
 *   grantAdminAccess();  // NEVER do this!
 * }
 * ```
 */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadSegment = parts[1];
    if (payloadSegment === undefined) return null;
    const parsed: unknown = JSON.parse(atob(payloadSegment));
    // JWT payloads must be JSON objects per RFC 7519.
    // Reject arrays, primitives, and null to honor the return type contract.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
