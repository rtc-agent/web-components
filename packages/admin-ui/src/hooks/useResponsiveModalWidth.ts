import { useIsMobile } from './useIsMobile';

/**
 * Responsive Modal width hook.
 * Returns '95vw' on mobile (< 768px), `desktopWidth` on desktop.
 *
 * @param desktopWidth - Width in pixels for desktop viewports (default: 480)
 */
export function useResponsiveModalWidth(
  desktopWidth: number = 480,
): number | string {
  const isMobile = useIsMobile();
  return isMobile ? '95vw' : desktopWidth;
}
