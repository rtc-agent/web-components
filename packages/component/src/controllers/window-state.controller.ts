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

export class WindowStateController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: WindowState = {...DEFAULT_WINDOW_STATE};

    readonly actions: WindowStateActions;

    get value(): WindowStateContextValue {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            setMode: (mode: WindowMode) => this._setMode(mode),
            setPosition: (pos) => this._updateState({position: pos}),
            setSize: (size) => this._updateState({size}),
            maximize: () => this._setMode('maximized'),
            minimize: () => this._setMode('minimized'),
            restore: () => this._setMode('normal'),
        };
    }

    hostConnected() {}
    hostDisconnected() {}

    private _setMode(mode: WindowMode) {
        const current = this._state;
        const lastState =
            mode !== 'normal'
                ? {position: {...current.position}, size: {...current.size}}
                : current.lastState;

        this._state = {...current, mode, lastState};
        this.host.requestUpdate();
    }

    private _updateState(partial: Partial<WindowState>) {
        this._state = {...this._state, ...partial};
        this.host.requestUpdate();
    }

    /**
     * Apply position/size state to a host element as inline styles.
     *
     * Inline styles override CSS rules (including :host([data-mode=...])),
     * so we clear them when leaving 'normal' mode to let CSS take over.
     *
     * @param el - The host element to apply geometry to (typically the root component).
     */
    applyGeometry(el: HTMLElement): void {
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
        } else if (mode === 'minimized') {
            // Clear inline width/height so CSS :host([data-mode='minimized']) can
            // apply the bubble size (40×40). Inline styles would otherwise win.
            el.style.width = '';
            el.style.height = '';
            el.style.minWidth = '';
            el.style.minHeight = '';
            // Position bubble at the bottom-right corner of the ORIGINAL window position
            // (not the viewport's bottom-right)
            const margin = 20;
            const bubbleSize = parseInt(getComputedStyle(el).getPropertyValue('--rtc-bubble-size')) || 40;
            // Use lastState to get the window position before minimization
            const lastState = this._state.lastState;
            const windowX = lastState?.position.x ?? position.x;
            const windowY = lastState?.position.y ?? position.y;
            const windowWidth = lastState?.size.width ?? size.width;
            const windowHeight = lastState?.size.height ?? size.height;
            // Calculate bottom-right corner of the original window
            const bubbleX = windowX + windowWidth - bubbleSize - margin;
            const bubbleY = windowY + windowHeight - bubbleSize - margin;
            el.style.left = `${bubbleX}px`;
            el.style.top = `${bubbleY}px`;
            // Clear bottom/right
            el.style.bottom = '';
            el.style.right = '';
        } else {
            // 'maximized' — clear inline geometry, let CSS inset:0 take over
            el.style.width = '';
            el.style.height = '';
            el.style.left = '';
            el.style.top = '';
            el.style.bottom = '';
            el.style.right = '';
        }
    }
}
