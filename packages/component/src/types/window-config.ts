/**
 * Window Configuration Types
 *
 * Window configuration API for the <rtc-agent> component.
 * Controls the window's default state, size, position, interaction constraints, etc.
 */

/**
 * Bubble position configuration
 *
 * Uses a mathematical Cartesian coordinate system:
 * - Origin is at one corner of the host application (determined by `corner`)
 * - x-axis: positive to the right, negative to the left
 * - y-axis: positive upward, negative downward (mathematical, not screen coordinates)
 *
 * Quadrant distribution:
 * - top-left: Quadrant IV (x>0, y<0)
 * - top-right: Quadrant III (x<0, y<0)
 * - bottom-left: Quadrant I (x>0, y>0)
 * - bottom-right: Quadrant II (x<0, y>0)
 */
export type BubbleCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface BubblePosition {
    /** Which corner of the host application is the coordinate origin */
    corner: BubbleCorner;
    /** Offset relative to the origin (mathematical Cartesian coordinates) */
    offset: { x: number; y: number };
}

/**
 * Window configuration
 *
 * Set via the <rtc-agent>.windowConfig property.
 */
export interface WindowConfig {
    // ── Default State ──

    /** Default window mode */
    defaultMode?: 'normal' | 'maximized' | 'minimized';

    /** Initial position (only effective in normal mode) */
    initialPosition?: { x: number; y: number };

    /** Initial size (only effective in normal mode) */
    initialSize?: { width: number; height: number };

    // ── Size Limits ──

    /** Minimum width */
    minWidth?: number;

    /** Minimum height */
    minHeight?: number;

    /** Maximum width (defaults to viewport width) */
    maxWidth?: number;

    /** Maximum height (defaults to viewport height) */
    maxHeight?: number;

    // ── Interaction Controls ──

    /** Whether dragging is allowed (default: true) */
    draggable?: boolean;

    /** Whether resizing is allowed (default: true) */
    resizable?: boolean;

    // ── Button Controls ──

    /** Whether to show the minimize button (default: true) */
    showMinimize?: boolean;

    /** Whether to show the maximize button (default: true) */
    showMaximize?: boolean;

    /** Whether to show the close button (default: false; close = minimize) */
    showClose?: boolean;

    // ── Embedded Mode ──

    /**
     * Embedded mode (disables all window interaction)
     *
     * Equivalent to:
     * - draggable: false
     * - resizable: false
     * - showMinimize: false
     * - showMaximize: false
     * - showClose: false
     * - defaultMode: 'maximized'
     */
    embedded?: boolean;

    // ── Bubble Position ──

    /**
     * Minimized bubble position configuration
     *
     * Uses a mathematical Cartesian coordinate system with the origin at one corner of the host application.
     * Default: { corner: 'bottom-right', offset: { x: -20, y: 20 } }
     */
    bubblePosition?: BubblePosition;
}

/**
 * Resolved window configuration (all fields have defaults)
 */
export interface ResolvedWindowConfig {
    defaultMode: 'normal' | 'maximized' | 'minimized';
    initialPosition: { x: number; y: number };
    initialSize: { width: number; height: number };
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
    draggable: boolean;
    resizable: boolean;
    showMinimize: boolean;
    showMaximize: boolean;
    showClose: boolean;
    embedded: boolean;
    bubblePosition: BubblePosition;
}

/**
 * Sentinel value for initialPosition.x/y meaning "use default position
 * calculation logic" (bottom-right corner with margin), rather than an
 * explicit pixel offset.
 */
export const POSITION_AUTO = -1;

/**
 * Default window configuration
 */
export const DEFAULT_WINDOW_CONFIG: ResolvedWindowConfig = {
    defaultMode: 'normal',
    initialPosition: { x: POSITION_AUTO, y: POSITION_AUTO },  // Auto-calculate (bottom-right corner)
    initialSize: { width: 420, height: 640 },
    minWidth: 350,
    minHeight: 520,
    maxWidth: Infinity,
    maxHeight: Infinity,
    draggable: true,
    resizable: true,
    showMinimize: true,
    showMaximize: true,
    showClose: false,
    embedded: false,
    bubblePosition: { corner: 'bottom-right', offset: { x: -20, y: 20 } },  // Bottom-right corner inset 20px
};

/**
 * Resolve window configuration (merge with defaults)
 *
 * embedded: true overrides interaction-related settings.
 */
export function resolveWindowConfig(config?: WindowConfig): ResolvedWindowConfig {
    if (!config) return { ...DEFAULT_WINDOW_CONFIG };

    // embedded mode: disable all interactions
    if (config.embedded) {
        return {
            ...DEFAULT_WINDOW_CONFIG,
            ...config,
            draggable: false,
            resizable: false,
            showMinimize: false,
            showMaximize: false,
            showClose: false,
            // In embedded mode, default to maximized unless explicitly overridden.
            defaultMode: config.defaultMode ?? 'maximized',
            bubblePosition: config.bubblePosition ?? DEFAULT_WINDOW_CONFIG.bubblePosition,
        };
    }

    return {
        ...DEFAULT_WINDOW_CONFIG,
        ...config,
        // The ?? fallbacks below are necessary: when config carries explicit
        // `undefined` for these fields, the spread would override the DEFAULT
        // values from ...DEFAULT_WINDOW_CONFIG with `undefined`.
        initialPosition: config.initialPosition ?? DEFAULT_WINDOW_CONFIG.initialPosition,
        initialSize: config.initialSize ?? DEFAULT_WINDOW_CONFIG.initialSize,
        bubblePosition: config.bubblePosition ?? DEFAULT_WINDOW_CONFIG.bubblePosition,
    };
}
