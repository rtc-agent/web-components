/**
 * Toast Controller
 *
 * Manages toast notifications: show, auto-dismiss, manual remove.
 * Extracted from <rtc-agent> root component to keep it under 300 lines.
 *
 * No context — toast state is consumed only by <rtc-toast> via root render.
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {ToastItem, ToastType} from '../components/overlay/rtc-toast.js';

export type {ToastItem, ToastType} from '../components/overlay/rtc-toast.js';

export interface ToastActions {
    show: (message: string, type?: ToastType) => void;
    remove: (id: number) => void;
}

export class ToastController implements ReactiveController {
    private _host: ReactiveControllerHost;
    private _toasts: ToastItem[] = [];
    /** Active auto-dismiss timers, keyed by toast ID */
    private _timers = new Map<number, ReturnType<typeof setTimeout>>();

    readonly actions: ToastActions;

    get toasts(): readonly ToastItem[] {
        return this._toasts;
    }

    constructor(host: ReactiveControllerHost) {
        this._host = host;
        this._host.addController(this);
        this.actions = {
            show: (message, type = 'info') => this._show(message, type),
            remove: (id) => this._remove(id),
        };
    }

    hostConnected() {}

    hostDisconnected() {
        // Clean up all pending timers to prevent memory leaks
        for (const timer of this._timers.values()) {
            clearTimeout(timer);
        }
        this._timers.clear();
    }

    private _show(message: string, type: ToastType) {
        const id = Date.now() + Math.random();
        this._toasts = [...this._toasts, {id, message, type}];
        this._host.requestUpdate();

        // error 不自动消失，其他类型自动消失
        const duration = type === 'error' ? 0 : type === 'success' ? 2000 : 2500;
        if (duration > 0) {
            const timer = setTimeout(() => this._remove(id), duration);
            this._timers.set(id, timer);
        }
    }

    private _remove(id: number) {
        // Clear the associated timer if it exists
        const timer = this._timers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._timers.delete(id);
        }
        this._toasts = this._toasts.filter(t => t.id !== id);
        this._host.requestUpdate();
    }
}
