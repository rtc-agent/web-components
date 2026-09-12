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

/** 序列化窗口状态时剔除 transient 字段（lastState 在 restore 后无意义） */
type PersistedWindowState = Omit<WindowState, 'lastState'>;

export class WindowStateController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: WindowState = {...DEFAULT_WINDOW_STATE};
    /** Whether state was restored from localStorage (used to skip initial position setup). */
    private _restored = false;
    /** Window configuration */
    private _config: ResolvedWindowConfig;

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

    /** 更新配置 */
    setConfig(config: ResolvedWindowConfig): void {
        this._config = config;
        // 如果没有保存的状态，应用默认模式
        if (!this._restored) {
            this._state = {...this._state, mode: config.defaultMode};
            this.host.requestUpdate();
        }
    }

    /** 获取配置 */
    get config(): ResolvedWindowConfig {
        return this._config;
    }

    hostConnected() {}
    hostDisconnected() {}

    /* ── Persistence ── */

    private _restoreState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.windowState);
            if (!raw) {
                // 没有保存的状态，应用默认模式
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
                // 保存的状态无效，应用默认模式
                this._state = {...this._state, mode: this._config.defaultMode};
            }
        } catch {
            // localStorage may be unavailable or data corrupted
            this._state = {...this._state, mode: this._config.defaultMode};
        }
    }

    /**
     * 将窗口位置和尺寸限制在当前视口范围内
     *
     * 刷新后浏览器 devtools、缩放比例可能已变化，
     * 直接恢复上次的位置可能导致窗口溢出视口（如被右侧 devtools 遮挡）。
     */
    private _clampToViewport() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const {position, size, mode} = this._state;

        if (mode === 'maximized') return; // maximized 由 CSS inset:0 控制，无需 clamp

        // 限制尺寸不超过视口
        const width = Math.min(size.width, vw);
        const height = Math.min(size.height, vh);

        // 限制位置：确保窗口至少部分可见
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
        } catch {
            // localStorage may be unavailable
        }
    }

    private _setMode(mode: WindowMode) {
        const current = this._state;
        const lastState =
            mode !== 'normal'
                ? {position: {...current.position}, size: {...current.size}}
                : current.lastState;

        this._state = {...current, mode, lastState};
        this._persistState();
        this.host.requestUpdate();
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
