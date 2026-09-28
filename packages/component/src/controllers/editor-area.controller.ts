/**
 * Editor Area Controller
 *
 * Manages Editor Area state:
 * - Open file tab list
 * - Current active file
 * - Content and dirty state per tab
 * - View mode per tab
 *
 * Provides actions for components or Debug HTML to call.
 *
 * Design notes:
 * - Only one tab allowed per path (idempotent open)
 * - activeFilePath clears after closing the last tab
 * - Auto-switches to adjacent tab after closing the active tab
 * - Marks isDirty on content change
 * - Clears isDirty on save (actual VFS write handled externally)
 *
 * ## Persistence
 * - Saves the open tab list (filePath, viewMode, cursorPosition)
 *   and activeFilePath via localStorage. Content is not persisted;
 *   it is reloaded from VFS after refresh.
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {EditorTab, EditorViewMode} from '../types/index.js';
import {STORAGE_KEYS} from '../config/auth.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('EditorAreaController');

/** Persisted Tab data (excluding content) */
interface PersistedTabMeta {
    filePath: string;
    viewMode: EditorViewMode;
    cursorPosition: {line: number; column: number};
}

interface PersistedEditorAreaData {
    tabs: PersistedTabMeta[];
    activeFilePath: string;
}

export interface EditorAreaState {
    tabs: EditorTab[];
    activeFilePath: string;
}

export interface EditorAreaActions {
    /** Open a file (idempotent: switches to existing tab if already open) */
    openFile(filePath: string, content: string, viewMode?: EditorViewMode): void;
    /** Close a tab */
    closeFile(filePath: string): void;
    /** Close all tabs */
    closeAll(): void;
    /** Switch to a specific tab */
    switchTab(filePath: string): void;
    /** Update content (auto-marks dirty) */
    updateContent(filePath: string, content: string): void;
    /** Save file (clears dirty flag) */
    saveFile(filePath: string): void;
    /** Set view mode */
    setViewMode(filePath: string, viewMode: EditorViewMode): void;
    /** Update cursor position */
    setCursorPosition(filePath: string, position: {line: number; column: number}): void;
    /**
     * Silently set file content (does not mark dirty)
     *
     * Used to reload content from VFS into restored tabs after refresh.
     * Creates a new tab if the tab does not exist.
     */
    loadContent(filePath: string, content: string): void;
}

export class EditorAreaController implements ReactiveController {
    private _host: ReactiveControllerHost;
    private _tabs: EditorTab[] = [];
    private _activeFilePath = '';

    /** Cursor position persistence throttle: avoid frequent localStorage writes */
    private _cursorPersistTimer?: ReturnType<typeof setTimeout>;

    readonly actions: EditorAreaActions;

    constructor(host: ReactiveControllerHost) {
        this._host = host;
        this._host.addController(this);
        this.actions = {
            openFile: (filePath, content, viewMode) => this._openFile(filePath, content, viewMode),
            closeFile: (filePath) => this._closeFile(filePath),
            closeAll: () => this._closeAll(),
            switchTab: (filePath) => this._switchTab(filePath),
            updateContent: (filePath, content) => this._updateContent(filePath, content),
            saveFile: (filePath) => this._saveFile(filePath),
            setViewMode: (filePath, viewMode) => this._setViewMode(filePath, viewMode),
            setCursorPosition: (filePath, position) => this._setCursorPosition(filePath, position),
            loadContent: (filePath, content) => this._loadContent(filePath, content),
        };
        this._restore();
    }

    hostConnected() {}

    hostDisconnected() {
        // Clean up throttle timer
        if (this._cursorPersistTimer) {
            clearTimeout(this._cursorPersistTimer);
            this._cursorPersistTimer = undefined;
        }
    }

    /* ── Persistence ── */

    private _restore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.editorArea);
            if (!raw) return;
            const saved: PersistedEditorAreaData = JSON.parse(raw);
            if (!saved || !Array.isArray(saved.tabs)) return;

            const isValidViewMode = (v: unknown): v is EditorViewMode =>
                v === 'edit' || v === 'preview' || v === 'split';

            // Restore tabs with empty content; content will be filled by external loadContent calls once VFS is ready
            this._tabs = saved.tabs.map(t => ({
                filePath: t.filePath,
                content: '',
                isDirty: false,
                cursorPosition: isValidViewMode(t.viewMode)
                    ? {line: 1, column: 1}
                    : (t.cursorPosition ?? {line: 1, column: 1}),
                viewMode: isValidViewMode(t.viewMode) ? t.viewMode : 'edit',
            }));

            // activeFilePath must exist in restored tabs
            const activeExists = this._tabs.some(t => t.filePath === saved.activeFilePath);
            this._activeFilePath = activeExists ? saved.activeFilePath : (this._tabs[0]?.filePath ?? '');
        } catch (e) {
            // localStorage may be unavailable or data corrupted
            log.debug('Failed to restore editor area state:', e);
        }
    }

    private _persist() {
        try {
            if (this._tabs.length === 0) {
                localStorage.removeItem(STORAGE_KEYS.editorArea);
                return;
            }
            const data: PersistedEditorAreaData = {
                tabs: this._tabs.map(t => ({
                    filePath: t.filePath,
                    viewMode: t.viewMode,
                    cursorPosition: t.cursorPosition,
                })),
                activeFilePath: this._activeFilePath,
            };
            localStorage.setItem(STORAGE_KEYS.editorArea, JSON.stringify(data));
        } catch (e) {
            // localStorage may be unavailable
            log.debug('Failed to persist editor area state:', e);
        }
    }

    /* ── Getters ── */

    get state(): EditorAreaState {
        return {
            tabs: this._tabs,
            activeFilePath: this._activeFilePath,
        };
    }

    get tabs(): readonly EditorTab[] {
        return this._tabs;
    }

    get activeFilePath(): string {
        return this._activeFilePath;
    }

    get activeTab(): EditorTab | undefined {
        return this._tabs.find(t => t.filePath === this._activeFilePath);
    }

    /* ── Actions ── */

    /**
     * Open a file
     *
     * Idempotent: if file is already open, only switches the tab without overwriting content.
     */
    private _openFile(filePath: string, content: string, viewMode: EditorViewMode = 'edit') {
        const existing = this._tabs.find(t => t.filePath === filePath);
        if (existing) {
            // Already open, only switch
            this._activeFilePath = filePath;
            this._persist();
            this._host.requestUpdate();
            return;
        }

        const newTab: EditorTab = {
            filePath,
            content,
            isDirty: false,
            cursorPosition: {line: 1, column: 1},
            viewMode,
        };

        this._tabs = [...this._tabs, newTab];
        this._activeFilePath = filePath;
        this._persist();
        this._host.requestUpdate();
    }

    /**
     * Close a tab
     *
     * Auto-switches to adjacent tab after closing. Clears activeFilePath if closing the last tab.
     */
    private _closeFile(filePath: string) {
        const index = this._tabs.findIndex(t => t.filePath === filePath);
        if (index === -1) return;

        const wasActive = filePath === this._activeFilePath;

        this._tabs = this._tabs.filter(t => t.filePath !== filePath);

        if (wasActive) {
            if (this._tabs.length === 0) {
                this._activeFilePath = '';
            } else {
                // Switch to adjacent tab (prefer left)
                const newIndex = Math.min(index, this._tabs.length - 1);
                this._activeFilePath = this._tabs[newIndex].filePath;
            }
        }

        this._persist();
        this._host.requestUpdate();
    }

    /**
     * Close all tabs
     */
    private _closeAll() {
        this._tabs = [];
        this._activeFilePath = '';
        this._persist();
        this._host.requestUpdate();
    }

    /**
     * Switch to a specific tab
     */
    private _switchTab(filePath: string) {
        const exists = this._tabs.some(t => t.filePath === filePath);
        if (!exists) return;

        this._activeFilePath = filePath;
        this._persist();
        this._host.requestUpdate();
    }

    /**
     * Update content (auto-marks dirty)
     */
    private _updateContent(filePath: string, content: string) {
        this._tabs = this._tabs.map(t => {
            if (t.filePath !== filePath) return t;
            return {
                ...t,
                content,
                isDirty: true,
            };
        });
        // Content changes frequently; skip persistence to avoid localStorage thrashing;
        // dirty state and content are authoritative in VFS; reload from VFS after refresh.
        this._host.requestUpdate();
    }

    /**
     * Save file (clears dirty flag)
     *
     * Note: actual VFS write is handled externally by listening to the editor-area-save event.
     */
    private _saveFile(filePath: string) {
        this._tabs = this._tabs.map(t => {
            if (t.filePath !== filePath) return t;
            return {...t, isDirty: false};
        });
        this._persist();
        this._host.requestUpdate();
    }

    /**
     * Set view mode
     */
    private _setViewMode(filePath: string, viewMode: EditorViewMode) {
        this._tabs = this._tabs.map(t => {
            if (t.filePath !== filePath) return t;
            return {...t, viewMode};
        });
        this._persist();
        this._host.requestUpdate();
    }

    /**
     * Update cursor position
     */
    private _setCursorPosition(filePath: string, position: {line: number; column: number}) {
        const tab = this._tabs.find(t => t.filePath === filePath);
        if (!tab) return;
        // Position unchanged, skip
        if (tab.cursorPosition.line === position.line && tab.cursorPosition.column === position.column) {
            return;
        }
        this._tabs = this._tabs.map(t => {
            if (t.filePath !== filePath) return t;
            return {...t, cursorPosition: position};
        });
        // Trigger host update so status bar updates in real time
        this._host.requestUpdate();
        // Throttle persistence: write localStorage only once per 2s to avoid IO thrashing from frequent cursor moves
        if (this._cursorPersistTimer) return;
        this._cursorPersistTimer = setTimeout(() => {
            this._cursorPersistTimer = undefined;
            this._persist();
        }, 2000);
    }

    /**
     * Silently set file content (does not mark dirty)
     *
     * Used to reload content from VFS into restored tabs after refresh.
     * Creates a new tab if the tab does not exist.
     */
    private _loadContent(filePath: string, content: string) {
        const existing = this._tabs.find(t => t.filePath === filePath);
        if (existing) {
            this._tabs = this._tabs.map(t => {
                if (t.filePath !== filePath) return t;
                // Clear isDirty when loading content (e.g., after restore default)
                return {...t, content, isDirty: false};
            });
            this._host.requestUpdate();
            return;
        }
        // Create tab when it does not exist (for cases where external code calls loadContent directly)
        const newTab: EditorTab = {
            filePath,
            content,
            isDirty: false,
            cursorPosition: {line: 1, column: 1},
            viewMode: 'edit',
        };
        this._tabs = [...this._tabs, newTab];
        if (!this._activeFilePath) {
            this._activeFilePath = filePath;
        }
        this._persist();
        this._host.requestUpdate();
    }
}
