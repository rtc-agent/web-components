/**
 * Floating Panel Controller — shared positioning lifecycle for overlay panels.
 *
 * Encapsulates the floating-ui autoUpdate/computePosition pattern used by
 * multiple overlay panels (mode, command, scenario) in <rtc-input-area>.
 *
 * Each instance manages one panel's positioning lifecycle:
 * - startPositioning(): begin auto-updating position when panel opens
 * - stopPositioning(): tear down autoUpdate when panel closes
 *
 * The host component retains ownership of visibility state (@state) and
 * outside-click dismissal, while this controller handles the DOM math.
 */
import {
    computePosition,
    flip,
    shift,
    offset,
    autoUpdate,
    type Placement,
    type Middleware,
} from '@floating-ui/dom';

export interface FloatingPanelControllerOptions {
    /** Host element for awaiting updateComplete before positioning. */
    host: {updateComplete: Promise<boolean>};
    /** Returns the anchor button element (may be undefined before render). */
    getButton: () => HTMLElement | undefined;
    /** Returns the floating panel element (may be undefined before render). */
    getPanel: () => HTMLElement | undefined;
    /** Floating-ui placement relative to the anchor. */
    placement: Placement;
}

export class FloatingPanelController {
    private _cleanup: (() => void) | null = null;
    private readonly _host: {updateComplete: Promise<boolean>};
    private readonly _getButton: () => HTMLElement | undefined;
    private readonly _getPanel: () => HTMLElement | undefined;
    private readonly _placement: Placement;
    private readonly _middleware: Middleware[];

    constructor(options: FloatingPanelControllerOptions) {
        this._host = options.host;
        this._getButton = options.getButton;
        this._getPanel = options.getPanel;
        this._placement = options.placement;
        // Consistent middleware across all panels: offset from anchor, flip to
        // opposite side if overflowing, shift to stay within viewport.
        this._middleware = [
            offset(6),
            flip({padding: 8}),
            shift({padding: 8}),
        ];
    }

    /**
     * Start auto-updating the panel position relative to its anchor button.
     *
     * Waits for the host's updateComplete so the panel element exists in DOM,
     * then sets up floating-ui's autoUpdate for continuous repositioning on
     * scroll/resize.
     */
    async startPositioning(): Promise<void> {
        await this._host.updateComplete;
        const btn = this._getButton();
        const panel = this._getPanel();
        if (!btn || !panel) return;

        this.stopPositioning();
        this._cleanup = autoUpdate(btn, panel, () => this._updatePosition());
    }

    /** Stop auto-updating and release the floating-ui cleanup callback. */
    stopPositioning(): void {
        this._cleanup?.();
        this._cleanup = null;
    }

    /**
     * Compute and apply the panel's position.
     *
     * Called by autoUpdate on scroll/resize, and once on initial positioning.
     */
    private async _updatePosition(): Promise<void> {
        await this._host.updateComplete;
        const btn = this._getButton();
        const panel = this._getPanel();
        if (!btn || !panel) return;

        const {x, y} = await computePosition(btn, panel, {
            placement: this._placement,
            strategy: 'absolute',
            middleware: this._middleware,
        });
        Object.assign(panel.style, {
            left: `${x}px`,
            top: `${y}px`,
        });
    }
}
