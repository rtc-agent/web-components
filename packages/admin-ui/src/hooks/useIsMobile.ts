import { Grid } from 'antd';

/**
 * Unified mobile detection hook for responsive design.
 *
 * Uses Ant Design's Grid system breakpoint to determine if the current viewport
 * is mobile-sized. The breakpoint is `< 768px` (md breakpoint).
 *
 * @returns `true` if the viewport width is less than 768px, `false` otherwise.
 *
 * @example
 * ```tsx
 * const isMobile = useIsMobile();
 *
 * // Conditional rendering
 * {isMobile ? <MobileMenu /> : <DesktopMenu />}
 *
 * // Responsive styles
 * const styles = {
 *   padding: isMobile ? '8px' : '16px',
 *   fontSize: isMobile ? '14px' : '16px',
 * };
 * ```
 *
 * @remarks
 * - This hook uses `Grid.useBreakpoint()` internally, which is based on CSS media queries.
 * - The hook is reactive: it automatically updates when the viewport is resized.
 * - Use this hook instead of manually checking `window.innerWidth` to ensure consistency
 *   with Ant Design's responsive system.
 *
 * @see {@link https://ant.design/components/grid#responsive-utilities Ant Design Breakpoints}
 */
export function useIsMobile(): boolean {
  const breakpoints = Grid.useBreakpoint();
  return !breakpoints.md;
}
