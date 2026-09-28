/**
 * Activity Controller
 *
 * Manages activity state in VS Code-style layout (explorer/chat/settings).
 *
 * Corresponds to: `ActivityContext` (defined in `contexts/activity.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-activity-bar>`, `<rtc-agent>` (conditional layout rendering)
 *
 * ## Persistence
 * - Saves current active activity and sidebarVisible state via localStorage
 * - Restores to last activity on page refresh
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Activity} from '../types/index.js';
import type {ActivityState, ActivityActions, ActivityContextValue} from '../contexts/activity.js';
import {DEFAULT_ACTIVITY_STATE} from '../contexts/activity.js';
import {STORAGE_KEYS} from '../config/auth.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('ActivityController');

// Re-export types for convenience
export type {ActivityState, ActivityActions};

export class ActivityController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: ActivityState = {...DEFAULT_ACTIVITY_STATE};

    readonly actions: ActivityActions;

    get value(): ActivityContextValue {
        return {state: this._state, actions: this.actions};
    }

    /** Current activity (readonly quick access) */
    get active(): Activity {
        return this._state.active;
    }

    /** Whether sidebar is visible (readonly quick access) */
    get sidebarVisible(): boolean {
        return this._state.sidebarVisible;
    }

    constructor(host: ReactiveControllerHost) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            setActivity: (activity: Activity) => this._setActivity(activity),
            showSidebar: () => this._showSidebar(),
            hideSidebar: () => this._hideSidebar(),
            toggleSidebar: () => this._toggleSidebar(),
            reset: () => this._reset(),
        };
        this._restore();
    }

    hostConnected() {}
    hostDisconnected() {}

    /* ─ Persistence ── */

    private _restore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.activityBar);
            if (!raw) return;
            const saved = JSON.parse(raw);
            const isValidActivity = (v: unknown): v is Activity =>
                v === 'files' || v === 'chat' || v === 'settings';
            if (saved && typeof saved === 'object') {
                this._state = {
                    active: isValidActivity(saved.active) ? saved.active : DEFAULT_ACTIVITY_STATE.active,
                    sidebarVisible: typeof saved.sidebarVisible === 'boolean'
                        ? saved.sidebarVisible
                        : DEFAULT_ACTIVITY_STATE.sidebarVisible,
                };
            }
        } catch (e) {
            // localStorage may be unavailable or data corrupted
            log.debug('Failed to restore activity state:', e);
        }
    }

    private _persist() {
        try {
            localStorage.setItem(STORAGE_KEYS.activityBar, JSON.stringify(this._state));
        } catch (e) {
            // localStorage may be unavailable
            log.debug('Failed to persist activity state:', e);
        }
    }

    /**
     * Set activity
     *
     * Logic:
     * - Click current activity → toggle sidebar
     * - Click different activity → switch activity and show sidebar
     */
    private _setActivity(activity: Activity) {
        if (this._state.active === activity) {
            // Click current activity, toggle sidebar
            this._toggleSidebar();
        } else {
            // Switch to new activity, preserve sidebarVisible state
            this._state = {
                active: activity,
                sidebarVisible: this._state.sidebarVisible,
            };
            this._persist();
            this.host.requestUpdate();
        }
    }

    private _showSidebar() {
        if (!this._state.sidebarVisible) {
            this._state = {...this._state, sidebarVisible: true};
            this._persist();
            this.host.requestUpdate();
        }
    }

    private _hideSidebar() {
        if (this._state.sidebarVisible) {
            this._state = {...this._state, sidebarVisible: false};
            this._persist();
            this.host.requestUpdate();
        }
    }

    private _toggleSidebar() {
        this._state = {
            ...this._state,
            sidebarVisible: !this._state.sidebarVisible,
        };
        this._persist();
        this.host.requestUpdate();
    }

    private _reset() {
        this._state = {...DEFAULT_ACTIVITY_STATE};
        this._persist();
        this.host.requestUpdate();
    }
}
