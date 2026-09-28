/**
 * WindowState Controller
 *
 * Encapsulates floating-window state logic: mode, position, size, and restore.
 * Extracted from <rtc-agent> root component to keep it under 300 lines.
 *
 * Corresponds to: `windowStateContext` (defined in `contexts/window-state.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-title-bar>`, `<rtc-content-wrapper>`
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {
    WindowState,
    WindowStateActions,
    WindowMode,
} from '../types/index.js';
import type {WindowStateContextValue} from '../contexts/window-state.js';
import {DEFAULT_WINDOW_STATE} from '../contexts/window-state.js';
import {STORAGE_KEYS} from '../config/auth.js';
import type {ResolvedWindowConfig} from '../types/window-config.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('WindowStateController');

/** Exclude transient fields when serializing window state (lastState is meaningless after restore) */
type PersistedWindowState = Omit<WindowState, 'lastState'>;

export class WindowStateController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: WindowState = {...DEFAULT_WINDOW_STATE};
    /** Whether state was restored from localStorage (used to skip initial position setup). */
    private _restored = false;
    /** Window configuration */
    private _config: ResolvedWindowConfig;
    /** Callback when viewport is too small for the window (triggers auto-minimize). */
    onViewportTooSmall?: () => void;

    readonly actions: WindowStateActions;

    get value(): WindowStateContextValue {
        return {state: this._state, actions: this.actions};
    }

    /** Whether window state was restored from localStorage. */
    get restored(): boolean {
        return this._restored;
    }

    constructor(host: ReactiveControllerHost, config?: ResolvedWindowConfig) {
        this.host = host;
        this._config = config ?? {
            defaultMode: 'normal',
            initialPosition: { x: -1, y: -1 },
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
            bubblePosition: { corner: 'bottom-right', offset: { x: -20, y: 20 } },
        };
        this.host.addController(this);
        this.actions = {
            setMode: (mode: WindowMode) => this._setMode(mode),
            setPosition: (pos) => this._updateState({position: pos}),
            setSize: (size) => this._updateState({size}),
            maximize: () => this._setMode('maximized'),
            minimize: () => this._setMode('minimized'),
            restore: () => this._setMode('normal'),
        };

        this._restoreState();
    }

    /** Update config */
    setConfig(config: ResolvedWindowConfig): void {
        this._config = config;
        // If no saved state, apply default mode
        if (!this._restored) {
            this._state = {...this._state, mode: config.defaultMode};
            this.host.requestUpdate();
        }
    }

    /** Get config */
    get config(): ResolvedWindowConfig {
        return this._config;
    }

    hostConnected() {
        // Listen for viewport resize (e.g. DevTools open/close/resize)
        window.addEventListener('resize', this._boundOnViewportResize);
    }
    hostDisconnected() {
        window.removeEventListener('resize', this._boundOnViewportResize);
    }

    /** Viewport resize handler — bound once in constructor. */
    private _boundOnViewportResize = () => this._handleViewportResize();

    /**
     * Handle viewport resize (e.g. DevTools open/close/resize).
     *
     * - embedded: no action (fills parent container via CSS)
     * - minimized: recalculate bubble position from bubblePosition config + new viewport size
     * - normal: clamp position to keep window visible; auto-minimize if viewport too small
     * - maximized: no action needed (CSS inset:0 handles it)
     */
    private _handleViewportResize(): void {
        const { mode } = this._state;

        if (this._config.embedded) return; // CSS handles layout

        if (mode === 'maximized') return; // CSS handles it

        if (mode === 'minimized') {
            // Just trigger a re-render — applyGeometry will recalculate bubble position
            // from bubblePosition config using the new viewport dimensions
            this.host.requestUpdate();
            return;
        }

        // Normal mode: check if viewport is too small for the window
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const { position, size } = this._state;
        const margin = 20;

        if (vw < size.width + 2 * margin || vh < size.height + 2 * margin) {
            this.onViewportTooSmall?.();
            return;
        }

        // Clamp position to keep window visible
        let x = position.x;
        let y = position.y;
        let needsUpdate = false;

        // Right edge
        if (x + size.width > vw - margin) {
            x = vw - size.width - margin;
            needsUpdate = true;
        }
        // Bottom edge
        if (y + size.height > vh - margin) {
            y = vh - size.height - margin;
            needsUpdate = true;
        }
        // Left edge
        if (x < margin) {
            x = margin;
            needsUpdate = true;
        }
        // Top edge
        if (y < margin) {
            y = margin;
            needsUpdate = true;
        }

        if (needsUpdate) {
            this._updateState({ position: { x, y } });
        }
    }

    /* ── Persistence ── */

    private _restoreState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.windowState);
            if (!raw) {
                // No saved state, apply default mode
                this._state = {...this._state, mode: this._config.defaultMode};
                return;
            }
            const saved: PersistedWindowState = JSON.parse(raw);
            // Validate required fields
            if (
                saved.mode &&
                saved.position?.x != null &&
                saved.position?.y != null &&
                saved.size?.width != null &&
                saved.size?.height != null
            ) {
                this._state = {...saved, lastState: undefined};
                this._restored = true;
                // Clamp to current viewport — devtools / zoom may have changed
                this._clampToViewport();
            } else {
                // Saved state is invalid, apply default mode
                this._state = {...this._state, mode: this._config.defaultMode};
            }
        } catch (e) {
            // localStorage may be unavailable or data corrupted
            log.debug('Failed to restore window state:', e);
            this._state = {...this._state, mode: this._config.defaultMode};
        }
    }

    /**
     * Clamp window position and size to current viewport bounds
     *
     * After refresh, browser devtools/zoom level may have changed;
     * directly restoring the last position may cause the window to overflow the viewport (e.g., obscured by right-side devtools).
     */
    private _clampToViewport() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const {position, size, mode} = this._state;

        if (mode === 'maximized') return; // maximized is controlled by CSS inset:0, no clamping needed

        // Clamp size to not exceed viewport
        const width = Math.min(size.width, vw);
        const height = Math.min(size.height, vh);

        // Clamp position: ensure window is at least partially visible
        const x = Math.max(0, Math.min(position.x, vw - width));
        const y = Math.max(0, Math.min(position.y, vh - height));

        this._state = {
            ...this._state,
            position: {x, y},
            size: {width, height},
        };
    }

    private _persistState() {
        try {
            const {mode, position, size} = this._state;
            const persisted: PersistedWindowState = {mode, position, size};
            localStorage.setItem(STORAGE_KEYS.windowState, JSON.stringify(persisted));
        } catch (e) {
            // localStorage may be unavailable
            log.debug('Failed to persist window state:', e);
        }
    }

    private _setMode(mode: WindowMode) {
        const current = this._state;
        let lastState = current.lastState;

        if (mode === 'normal' && !lastState) {
            // First restore from minimized: calculate window position based on bubblePosition.corner
            // This determines the "expand direction" based on the configured corner
            lastState = this._calculateInitialWindowState();
        } else if (mode !== 'normal') {
            // Save current state before minimizing/maximizing
            lastState = {position: {...current.position}, size: {...current.size}};
        }

        this._state = {...current, mode, lastState};
        this._persistState();
        this.host.requestUpdate();
    }

    /**
     * Calculate initial window state based on bubblePosition.corner
     *
     * The corner determines which corner of the window aligns with the bubble position:
     * - bottom-right: window's bottom-right aligns with bubble (expand to upper-left)
     * - top-left: window's top-left aligns with bubble (expand to lower-right)
     * - etc.
     */
    private _calculateInitialWindowState(): { position: { x: number; y: number }; size: { width: number; height: number } } {
        const { corner, offset } = this._config.bubblePosition;
        const { width, height } = this._config.initialSize;
        const viewport = { width: window.innerWidth, height: window.innerHeight };

        let x: number;
        let y: number;

        // Calculate window position based on corner
        // The window's corner (specified by bubblePosition.corner) should align with the bubble position
        switch (corner) {
            case 'top-left':
                // Window's top-left corner at bubble position
                x = offset.x;
                y = -offset.y;
                break;
            case 'top-right':
                // Window's top-right corner at bubble position
                x = viewport.width + offset.x - width;
                y = -offset.y;
                break;
            case 'bottom-left':
                // Window's bottom-left corner at bubble position
                x = offset.x;
                y = viewport.height - offset.y - height;
                break;
            case 'bottom-right':
                // Window's bottom-right corner at bubble position
                x = viewport.width + offset.x - width;
                y = viewport.height - offset.y - height;
                break;
            default:
                // Fallback: center the window in the viewport
                x = (viewport.width - width) / 2;
                y = (viewport.height - height) / 2;
                break;
        }

        return {
            position: { x, y },
            size: { width, height },
        };
    }

    private _updateState(partial: Partial<WindowState>) {
        this._state = {...this._state, ...partial};
        this._persistState();
        this.host.requestUpdate();
    }

    /**
     * Apply position/size state to a host element as inline styles.
     *
     * Inline styles override CSS rules (including :host([data-mode=...])),
     * so we clear them when leaving 'normal' mode to let CSS take over.
     *
     * When the host has `data-embedded` attribute, skip all inline geometry —
     * the component fills its parent container via CSS (position: relative).
     *
     * @param el - The host element to apply geometry to (typically the root component).
     */
    applyGeometry(el: HTMLElement): void {
        // Embedded mode: CSS handles layout (position: relative, width/height: 100%).
        // Clear any residual inline geometry so CSS rules take effect.
        if (el.hasAttribute('data-embedded')) {
            el.style.width = '';
            el.style.height = '';
            el.style.left = '';
            el.style.top = '';
            el.style.bottom = '';
            el.style.right = '';
            return;
        }

        const {position, size, mode} = this._state;

        if (mode === 'normal') {
            // Use left/top positioning (compatible with interact.js)
            el.style.left = `${position.x}px`;
            el.style.top = `${position.y}px`;
            el.style.width = `${size.width}px`;
            el.style.height = `${size.height}px`;
            // Clear bottom/right (set by CSS defaults)
            el.style.bottom = '';
            el.style.right = '';
            // Clear bubble inline styles (set during minimized) so CSS can take over
            const bubble = el.shadowRoot?.querySelector<HTMLElement>('.bubble');
            if (bubble) {
                bubble.style.removeProperty('position');
                bubble.style.removeProperty('left');
                bubble.style.removeProperty('top');
                bubble.style.removeProperty('width');
                bubble.style.removeProperty('height');
                bubble.style.removeProperty('right');
                bubble.style.removeProperty('bottom');
            }
        } else if (mode === 'minimized') {
            // Clear inline width/height so CSS :host([data-mode='minimized']) can
            // apply the bubble size (40×40). Inline styles would otherwise win.
            el.style.width = '';
            el.style.height = '';
            el.style.minWidth = '';
            el.style.minHeight = '';

            // Calculate bubble position using bubblePosition config
            const bubbleSize = parseInt(getComputedStyle(el).getPropertyValue('--rtc-bubble-size')) || 40;
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const { corner, offset } = this._config.bubblePosition;

            // Calculate bubble's top-left corner position based on the Cartesian coordinate system
            // The offset represents the position of the bubble's corner closest to the origin
            let bubbleX: number;
            let bubbleY: number;

            switch (corner) {
                case 'top-left':
                    // Origin at top-left (0, 0)
                    // Nearest corner of bubble is top-left
                    // offset: x>0 (right), y<0 (down in Cartesian, but we convert)
                    bubbleX = offset.x;
                    bubbleY = -offset.y;
                    break;
                case 'top-right':
                    // Origin at top-right (viewport.width, 0)
                    // Nearest corner of bubble is top-right
                    // offset: x<0 (left), y<0 (down in Cartesian)
                    bubbleX = viewport.width + offset.x - bubbleSize;
                    bubbleY = -offset.y;
                    break;
                case 'bottom-left':
                    // Origin at bottom-left (0, viewport.height)
                    // Nearest corner of bubble is bottom-left
                    // offset: x>0 (right), y>0 (up in Cartesian)
                    bubbleX = offset.x;
                    bubbleY = viewport.height - offset.y - bubbleSize;
                    break;
                case 'bottom-right':
                    // Origin at bottom-right (viewport.width, viewport.height)
                    // Nearest corner of bubble is bottom-right
                    // offset: x<0 (left), y>0 (up in Cartesian)
                    bubbleX = viewport.width + offset.x - bubbleSize;
                    bubbleY = viewport.height - offset.y - bubbleSize;
                    break;
            }

            el.style.left = `${bubbleX}px`;
            el.style.top = `${bubbleY}px`;
            // Clear bottom/right
            el.style.bottom = '';
            el.style.right = '';

            // Also position the .bubble element directly via position:fixed.
            // The .bubble inside shadow DOM cannot rely on `position:absolute; inset:0`
            // because the shadow DOM layout may be offset from the host's visual position
            // (the host's static position in document flow differs from its fixed position).
            // By using position:fixed on the .bubble itself, it positions relative to the
            // viewport — same as the host — ensuring correct visual alignment.
            const bubble = el.shadowRoot?.querySelector<HTMLElement>('.bubble');
            if (bubble) {
                bubble.style.setProperty('position', 'fixed', 'important');
                bubble.style.setProperty('left', `${bubbleX}px`, 'important');
                bubble.style.setProperty('top', `${bubbleY}px`, 'important');
                bubble.style.setProperty('width', `${bubbleSize}px`, 'important');
                bubble.style.setProperty('height', `${bubbleSize}px`, 'important');
                bubble.style.setProperty('right', 'auto', 'important');
                bubble.style.setProperty('bottom', 'auto', 'important');
            }
        } else {
            // 'maximized' — clear inline geometry, let CSS inset:0 take over
            el.style.width = '';
            el.style.height = '';
            el.style.left = '';
            el.style.top = '';
            el.style.bottom = '';
            el.style.right = '';
            // Clear bubble inline styles (set during minimized) so CSS can take over
            const bubble = el.shadowRoot?.querySelector<HTMLElement>('.bubble');
            if (bubble) {
                bubble.style.removeProperty('position');
                bubble.style.removeProperty('left');
                bubble.style.removeProperty('top');
                bubble.style.removeProperty('width');
                bubble.style.removeProperty('height');
                bubble.style.removeProperty('right');
                bubble.style.removeProperty('bottom');
            }
        }
    }
}
