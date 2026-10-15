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

import { createLogger } from '@rtc-agent/protocol';
import type { ReactiveControllerHost } from 'lit';
import { STORAGE_KEYS } from '../config/auth.js';
import type { ActivityActions, ActivityState } from '../contexts/activity.js';
import { DEFAULT_ACTIVITY_STATE } from '../contexts/activity.js';
import { CachedContextController } from '../core/cached-context.controller.js';
import type { Activity } from '../types/index.js';

const log = createLogger('ActivityController');

// Re-export types for convenience
export type { ActivityActions, ActivityState };

export class ActivityController extends CachedContextController<
  ActivityState,
  ActivityActions
> {
  /** Current activity (readonly quick access) */
  get active(): Activity {
    return this._state.active;
  }

  /** Whether sidebar is visible (readonly quick access) */
  get sidebarVisible(): boolean {
    return this._state.sidebarVisible;
  }

  constructor(host: ReactiveControllerHost) {
    const initialState = { ...DEFAULT_ACTIVITY_STATE };
    const actions: ActivityActions = {
      setActivity: (activity: Activity) => this._setActivity(activity),
      showSidebar: () => this._showSidebar(),
      hideSidebar: () => this._hideSidebar(),
      toggleSidebar: () => this._toggleSidebar(),
      reset: () => this._reset(),
    };
    super(host, initialState, actions, log);
    this._restore();
  }

  /* ─ Persistence ── */

  private _restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.activityBar);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const isValidActivity = (v: unknown): v is Activity =>
        v === 'files' || v === 'chat' || v === 'settings' || v === 'functions';
      if (saved && typeof saved === 'object') {
        this._state = {
          active: isValidActivity(saved.active)
            ? saved.active
            : DEFAULT_ACTIVITY_STATE.active,
          sidebarVisible:
            typeof saved.sidebarVisible === 'boolean'
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
      localStorage.setItem(
        STORAGE_KEYS.activityBar,
        JSON.stringify(this._state),
      );
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
      this._updateState({ active: activity });
      this._persist();
      this.host.requestUpdate();
    }
  }

  private _showSidebar() {
    if (!this._state.sidebarVisible) {
      this._updateState({ sidebarVisible: true });
      this._persist();
      this.host.requestUpdate();
    }
  }

  private _hideSidebar() {
    if (this._state.sidebarVisible) {
      this._updateState({ sidebarVisible: false });
      this._persist();
      this.host.requestUpdate();
    }
  }

  private _toggleSidebar() {
    this._updateState({ sidebarVisible: !this._state.sidebarVisible });
    this._persist();
    this.host.requestUpdate();
  }

  private _reset() {
    this._setState({ ...DEFAULT_ACTIVITY_STATE });
    this._persist();
    this.host.requestUpdate();
  }
}
