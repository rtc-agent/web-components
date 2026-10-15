/**
 * Responsive configuration for Tailwind CSS
 *
 * TODO: Migrate global.less media queries to Tailwind utility classes
 * This file provides breakpoint configuration that matches existing Less variables.
 * Full migration should be done component-by-component to avoid breaking changes.
 */

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

/**
 * Mobile breakpoint (< 768px)
 * Used for responsive adjustments in mobile view
 */
export const MOBILE_BREAKPOINT = BREAKPOINTS.md;

/**
 * Dashboard height offsets for different viewports
 * Mobile: 120px (compact header)
 * Desktop: 140px (standard header)
 */
export const DASHBOARD_OFFSETS = {
  mobile: 120,
  desktop: 140,
} as const;
