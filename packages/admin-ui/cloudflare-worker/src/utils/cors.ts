/**
 * CORS Configuration
 *
 * Security: Use exact domain allowlist instead of wildcard patterns to prevent
 * malicious subdomains on public hosting platforms (surge.sh, pages.dev, etc.).
 *
 * For development: localhost with any port is allowed.
 * For production: Add specific production domains to ALLOWED_ORIGINS.
 */

/**
 * Exact origin allowlist for CORS.
 *
 * Add production domains here. Subdomain wildcards are intentionally avoided
 * to prevent attacks via malicious subdomains on public hosting platforms.
 */
const ALLOWED_ORIGINS = new Set<string>([
  'https://preview.pro.ant.design',
  // Add production domains here, e.g.:
  // 'https://your-production-domain.com',
]);

/**
 * Check if an origin is allowed for CORS.
 *
 * Development: Allows localhost with any port.
 * Production: Only allows exact origins in ALLOWED_ORIGINS set.
 */
export const corsOrigin = (origin: string): boolean => {
  // Allow localhost with any port (development)
  if (/^http:\/\/localhost:\d+$/.test(origin)) {
    return true;
  }

  // Production: exact match against allowlist
  return ALLOWED_ORIGINS.has(origin);
};
