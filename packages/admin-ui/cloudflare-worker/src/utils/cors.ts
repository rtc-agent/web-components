/**
 * CORS Configuration
 *
 * Security: Use exact domain allowlist instead of wildcard patterns to prevent
 * malicious subdomains on public hosting platforms (surge.sh, pages.dev, etc.).
 *
 * For development: localhost with any port is allowed.
 * For production: Read allowed origins from CORS_ORIGINS environment variable
 * (comma-separated list), with fallback to hardcoded defaults.
 *
 * Environment variable format:
 *   CORS_ORIGINS=https://prod.example.com,https://staging.example.com
 */

/**
 * Default origin allowlist (fallback when CORS_ORIGINS env var is not set).
 *
 * Add production domains here. Subdomain wildcards are intentionally avoided
 * to prevent attacks via malicious subdomains on public hosting platforms.
 */
const DEFAULT_ALLOWED_ORIGINS = new Set<string>([
  'https://preview.pro.ant.design',
  // Add production domains here as fallback, e.g.:
  // 'https://your-production-domain.com',
]);

/**
 * Parse CORS_ORIGINS environment variable into a Set of allowed origins.
 *
 * @param envOrigins - Comma-separated list of origins from environment variable
 * @returns Set of allowed origins
 */
function parseAllowedOrigins(envOrigins: string | undefined): Set<string> {
  if (!envOrigins) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  const origins = envOrigins
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  return new Set(origins);
}

/**
 * Check if an origin is allowed for CORS.
 *
 * Development: Allows localhost with any port.
 * Production: Only allows exact origins from CORS_ORIGINS env var (or defaults).
 *
 * @param origin - The origin to check
 * @param allowedOrigins - Set of allowed origins (from parseAllowedOrigins)
 */
export const corsOrigin = (
  origin: string,
  allowedOrigins: Set<string> = DEFAULT_ALLOWED_ORIGINS,
): boolean => {
  // Allow localhost with any port (development)
  if (/^http:\/\/localhost:\d+$/.test(origin)) {
    return true;
  }

  // Production: exact match against allowlist
  return allowedOrigins.has(origin);
};

export { parseAllowedOrigins };
