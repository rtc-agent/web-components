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
 * SECURITY: This function does NOT verify the JWT signature. It is intended for
 * client-side inspection only (e.g. extracting claims for display or local filtering).
 * Never use the output for authorization decisions — the server always validates signatures.
 *
 * @param token - The JWT token string (format: header.payload.signature)
 * @returns The parsed payload as a record, or `null` if parsing failed
 */
export function parseJwtPayload(
  token: string,
): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
}
