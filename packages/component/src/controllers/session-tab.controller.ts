/**
 * Session Tab Controller
 *
 * Manages conversation page tabs:
 * - Open/switch to session tabs
 * - Close tabs (auto-activate adjacent tab when closing the active tab)
 * - Clear all tabs
 *
 * Each tab uses sessionId as its unique identifier; only one tab per session is allowed.
 *
 * Corresponds to: `SessionTabContext` (contexts/session-tab.ts)
 * Consumers: <rtc-session-tab-bar>, <rtc-chat-layout>
 */
import { msg } from '@lit/localize';
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {SessionTab, SessionTabState, SessionTabActions, SessionStatus} from '../types/index.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('SessionTabController');

const ACTIVE_TAB_STORAGE_KEY = 'rtc:active-tab';

export class SessionTabController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: SessionTabState = {tabs: [], activeSessionId: null};

    readonly actions: SessionTabActions;

    get value(): {state: SessionTabState; actions: SessionTabActions} {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            openOrActivate: (sessionId: string, title: string, options?: { isUnsaved?: boolean; activate?: boolean; skipPersist?: boolean; initialInputValue?: string; noticeMessage?: string }) =>
                this._openOrActivate(sessionId, title, options),
            closeTab: (sessionId: string) => this._closeTab(sessionId),
            setActiveTab: (sessionId: string | null) =>
                this._setActiveTab(sessionId),
            clearAll: () => this._clearAll(),
            updateTabTitles: (sessionTitleMap: Map<string, string>) =>
                this.updateTabTitles(sessionTitleMap),
            syncTabStatuses: (sessionStatusMap: Map<string, SessionStatus>) =>
                this.syncTabStatuses(sessionStatusMap),
            markSaved: (sessionId: string) => this._markSaved(sessionId),
            findUnsavedTab: () => this._findUnsavedTab(),
            updateTabStatus: (sessionId: string, status) =>
                this._updateTabStatus(sessionId, status),
            restoreActiveFromStorage: () => this._restoreActiveFromStorage(),
            getStoredActiveSessionId: () => this._getStoredActiveSessionId(),
            setTransientParams: (sessionId: string, params: { initialInputValue?: string; noticeMessage?: string }) =>
                this._setTransientParams(sessionId, params),
            clearTransientParams: (sessionId: string) =>
                this._clearTransientParams(sessionId),
        };
    }

    hostConnected() {}
    hostDisconnected() {}

    /**
     * Filter out invalid tabs (session has been deleted or does not exist)
     *
     * Called after session list is loaded from IndexedDB to clean up stale persisted tabs.
     * Tabs with `isUnsaved === true` are kept even if their sessionId is not in the DB
     * (they are drafts not yet persisted).
     * Returns true if any tab was removed (caller may need to update UI).
     */
    filterInvalidTabs(validSessionIds: Set<string>): boolean {
        const before = this._state.tabs.length;
        const tabs = this._state.tabs.filter(
            t => validSessionIds.has(t.sessionId) || t.isUnsaved === true
        );
        let activeSessionId = this._state.activeSessionId;

        log.debug('filterInvalidTabs before:', before, 'after:', tabs.length);
        log.debug('filterInvalidTabs activeSessionId:', activeSessionId);

        // If the active tab was filtered out (and is not a preserved unsaved tab), activate the first available one
        if (activeSessionId && !tabs.some(t => t.sessionId === activeSessionId)) {
            activeSessionId = tabs.length > 0 ? tabs[0].sessionId : null;
            log.debug('activeTab filtered out, new activeSessionId:', activeSessionId);
        }

        if (tabs.length !== before) {
            this._state = {tabs, activeSessionId};

            this.host.requestUpdate();
            return true;
        }
        return false;
    }

    /**
     * Sync existing tab titles with the latest titles from sessions
     *
     * The DB is the authoritative source for titles. Session changes pushed via UIUpdateBus
     * (user renames or server-generated) are written to DB first; this method syncs the
     * latest DB titles to tabs.
     *
     * Skip conditions:
     * - Tab's session is not in the DB (e.g., unsaved tab, newTitle is undefined)
     * - DB returns an empty title
     * - DB title is identical to the tab's current title (no change)
     */
    updateTabTitles(sessionTitleMap: Map<string, string>): boolean {
        log.debug('updateTabTitles called with', sessionTitleMap.size, 'titles');
        let changed = false;
        const tabs = this._state.tabs.map(t => {
            const newTitle = sessionTitleMap.get(t.sessionId);
            // Sync to tab whenever DB provides a non-empty title that differs from the current one.
            // The DB is the authoritative source for titles: changes pushed via UIUpdateBus
            // (whether user renames or server-generated) are already reflected in the DB;
            // tabs should follow.
            // Note: unsaved tabs (no DB record) have newTitle === undefined and are automatically skipped.
            const shouldUpdate = newTitle !== undefined &&
                newTitle.trim() !== '' &&
                newTitle !== t.title;
            if (shouldUpdate) {
                log.debug('Updating tab', t.sessionId, ':', `"${t.title}"`, '->', `"${newTitle}"`);
                changed = true;
                return {...t, title: newTitle, isDefault: false, isUnsaved: false};
            }
            return t;
        });

        if (changed) {
            this._state = {...this._state, tabs};

            this.host.requestUpdate();
        }
        return changed;
    }

    /**
     * Sync existing tab statuses with the latest statuses from sessions
     *
     * The DB is the authoritative source for status (written by server turn lifecycle events).
     * Called during _loadSessions to ensure tab statuses match the DB.
     */
    syncTabStatuses(sessionStatusMap: Map<string, SessionStatus>): boolean {
        let changed = false;
        const tabs = this._state.tabs.map(t => {
            const newStatus = sessionStatusMap.get(t.sessionId);
            if (newStatus !== undefined && newStatus !== t.status) {
                changed = true;
                return {...t, status: newStatus};
            }
            return t;
        });
        if (changed) {
            this._state = {...this._state, tabs};

            this.host.requestUpdate();
        }
        return changed;
    }

    /* ── Private ── */

    private _isPlaceholderTitle(title: string): boolean {
        return !title || title === msg('未命名') || title === msg('新聊天');
    }

    /** Find the current unsaved tab, returns the first tab with isUnsaved === true. */
    private _findUnsavedTab(): SessionTab | undefined {
        return this._state.tabs.find(t => t.isUnsaved === true);
    }

    /** Mark a specific tab as saved. */
    private _markSaved(sessionId: string): void {
        const tab = this._state.tabs.find(t => t.sessionId === sessionId);
        if (!tab || tab.isUnsaved !== true) {
            return;
        }
        const tabs = this._state.tabs.map(t =>
            t.sessionId === sessionId ? {...t, isUnsaved: false} : t
        );
        this._state = {...this._state, tabs};

        this.host.requestUpdate();
    }

    /** Update the session runtime status (active/idle/closed) of a specific tab. */
    private _updateTabStatus(sessionId: string, status: SessionStatus): void {
        const tab = this._state.tabs.find(t => t.sessionId === sessionId);
        if (!tab || tab.status === status) return;
        const tabs = this._state.tabs.map(t =>
            t.sessionId === sessionId ? {...t, status} : t
        );
        this._state = {...this._state, tabs};

        this.host.requestUpdate();
    }

    private _openOrActivate(sessionId: string, title: string, options?: { isUnsaved?: boolean; activate?: boolean; skipPersist?: boolean; initialInputValue?: string; noticeMessage?: string }) {
        log.debug('openOrActivate sessionId:', sessionId, 'title:', `"${title}"`);
        log.debug('openOrActivate current tabs:', this._state.tabs.map(t => `${t.sessionId}="${t.title}"(isDefault=${t.isDefault})`));

        const isPlaceholder = this._isPlaceholderTitle(title);
        const shouldActivate = options?.activate ?? true; // Default: activate
        const skipPersist = options?.skipPersist ?? false;
        const transientParams = (options?.initialInputValue !== undefined || options?.noticeMessage !== undefined)
            ? { initialInputValue: options?.initialInputValue, noticeMessage: options?.noticeMessage }
            : undefined;
        const existingIndex = this._state.tabs.findIndex(
            t => t.sessionId === sessionId
        );

        if (existingIndex >= 0) {
            const existing = this._state.tabs[existingIndex];
            // Protect tabs with real titles from being overwritten by placeholder titles
            if (isPlaceholder && !existing.isDefault && existing.title !== title) {
                log.debug('Protected tab title:', existing.title);
                // Only update activeSessionId when activation is needed
                if (shouldActivate && this._state.activeSessionId !== sessionId) {
                    this._state = {...this._state, activeSessionId: sessionId};
                    if (!skipPersist) this._persistActiveSessionId(sessionId);
                    this.host.requestUpdate();
                }
                return;
            }
            const tabs = this._state.tabs.map((t, i) => {
                if (i !== existingIndex) return t;
                const updated = {...t, title, isDefault: isPlaceholder ? true : false};
                if (transientParams) {
                    updated.initialInputValue = transientParams.initialInputValue;
                    updated.noticeMessage = transientParams.noticeMessage;
                    updated.initialValueVersion = (t.initialValueVersion ?? 0) + 1;
                }
                return updated;
            });
            const newActiveId = shouldActivate ? sessionId : this._state.activeSessionId;
            this._state = {tabs, activeSessionId: newActiveId};
            if (shouldActivate && !skipPersist) {
                this._persistActiveSessionId(newActiveId);
            }
        } else {
            const newTab: SessionTab = {
                sessionId,
                title,
                isDefault: isPlaceholder ? true : false,
                isUnsaved: options?.isUnsaved ?? false,
                ...(transientParams ? {
                    initialInputValue: transientParams.initialInputValue,
                    noticeMessage: transientParams.noticeMessage,
                    initialValueVersion: 1,
                } : {}),
            };
            const tabs = [...this._state.tabs, newTab];
            const newActiveId = shouldActivate ? sessionId : this._state.activeSessionId;
            this._state = {tabs, activeSessionId: newActiveId};
            if (shouldActivate && !skipPersist) {
                this._persistActiveSessionId(newActiveId);
            }
        }

        log.debug('openOrActivate final tabs:', this._state.tabs.map(t => `${t.sessionId}="${t.title}"(isDefault=${t.isDefault})`));

        this.host.requestUpdate();
    }

    private _closeTab(sessionId: string) {
        const tabIndex = this._state.tabs.findIndex(t => t.sessionId === sessionId);
        if (tabIndex < 0) return;

        const tabs = this._state.tabs.filter(t => t.sessionId !== sessionId);

        let activeSessionId = this._state.activeSessionId;

        if (activeSessionId === sessionId) {
            // Closing the active tab → activate adjacent tab
            if (tabs.length === 0) {
                activeSessionId = null;
            } else {
                // Prefer activating the right tab, otherwise the left
                const nextIndex = Math.min(tabIndex, tabs.length - 1);
                activeSessionId = tabs[nextIndex].sessionId;
            }
            this._persistActiveSessionId(activeSessionId);
        }

        this._state = {tabs, activeSessionId};

        this.host.requestUpdate();
    }

    private _setActiveTab(sessionId: string | null) {
        if (sessionId !== null && sessionId !== this._state.activeSessionId) {
            this._state = {...this._state, activeSessionId: sessionId};
            this._persistActiveSessionId(sessionId);
            this.host.requestUpdate();
        } else if (sessionId === null && this._state.activeSessionId !== null) {
            this._state = {...this._state, activeSessionId: null};
            this._persistActiveSessionId(null);
            this.host.requestUpdate();
        }
    }

    private _clearAll() {
        this._state = {tabs: [], activeSessionId: null};
        this._persistActiveSessionId(null);
        this.host.requestUpdate();
    }

    /**
     * Write activeSessionId to localStorage
     *
     * Only runs in browser environments (SSR-safe); any errors are silently ignored
     * (e.g., private mode quota is 0).
     */
    private _persistActiveSessionId(sessionId: string | null): void {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            if (sessionId === null) {
                window.localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
            } else {
                window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, sessionId);
            }
        } catch {
            // localStorage unavailable (private mode / quota full), ignore
        }
    }

    /**
     * Read the last active tab's sessionId from localStorage
     *
     * Used to decide which tab should have activate: true when restoring the tabs cycle.
     * Returns null if localStorage is empty or unavailable.
     */
    private _getStoredActiveSessionId(): string | null {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return null;
            return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
        } catch {
            return null;
        }
    }

    /**
     * Set transient UI params for a tab (initialInputValue, noticeMessage)
     *
     * Also increments initialValueVersion to ensure input-area's updated() is triggered
     * even when old and new values are identical (defends against Lit dirty-check skipping).
     */
    private _setTransientParams(sessionId: string, params: { initialInputValue?: string; noticeMessage?: string }): void {
        const tab = this._state.tabs.find(t => t.sessionId === sessionId);
        if (!tab) return;
        const tabs = this._state.tabs.map(t =>
            t.sessionId === sessionId
                ? {
                    ...t,
                    initialInputValue: params.initialInputValue,
                    noticeMessage: params.noticeMessage,
                    initialValueVersion: (t.initialValueVersion ?? 0) + 1,
                }
                : t
        );
        this._state = {...this._state, tabs};
        this.host.requestUpdate();
    }

    /** Clear transient UI params for a specific tab. */
    private _clearTransientParams(sessionId: string): void {
        const tab = this._state.tabs.find(t => t.sessionId === sessionId);
        if (!tab) return;
        if (tab.initialInputValue === undefined && tab.noticeMessage === undefined) return;
        const tabs = this._state.tabs.map(t =>
            t.sessionId === sessionId
                ? {...t, initialInputValue: undefined, noticeMessage: undefined}
                : t
        );
        this._state = {...this._state, tabs};
        this.host.requestUpdate();
    }

    /**
     * Restore active tab from localStorage
     *
     * Only restores when the stored sessionId is in the current tab list; otherwise no change.
     * Used to restore the user's last active tab after a browser refresh.
     */
    private _restoreActiveFromStorage(): boolean {
        const stored = this._getStoredActiveSessionId();
        if (!stored) return false;
        // Only restore when the stored tab still exists in the current tab list
        if (!this._state.tabs.some(t => t.sessionId === stored)) {
            log.debug('Stored id not in tabs:', stored);
            return false;
        }
        if (this._state.activeSessionId === stored) {
            log.debug('Already active:', stored);
            return false;
        }
        log.debug('Restoring active tab:', stored);
        this._state = {...this._state, activeSessionId: stored};
        this.host.requestUpdate();
        return true;
    }
}
