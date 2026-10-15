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

import { createLogger } from '@rtc-agent/protocol';
import type { ReactiveControllerHost } from 'lit';
import { STORAGE_KEYS } from '../config/auth.js';
import { CachedContextController } from '../core/cached-context.controller.js';
import type { EditorTab, EditorViewMode } from '../types/index.js';

const log = createLogger('EditorAreaController');

/** Persisted Tab data (excluding content) */
interface PersistedTabMeta {
  filePath: string;
  viewMode: EditorViewMode;
  cursorPosition: { line: number; column: number };
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
  setCursorPosition(
    filePath: string,
    position: { line: number; column: number },
  ): void;
  /**
   * Silently set file content (does not mark dirty)
   *
   * Used to reload content from VFS into restored tabs after refresh.
   * Creates a new tab if the tab does not exist.
   */
  loadContent(filePath: string, content: string): void;
}

export class EditorAreaController extends CachedContextController<
  EditorAreaState,
  EditorAreaActions
> {
  /** Cursor position persistence throttle: avoid frequent localStorage writes */
  private _cursorPersistTimer?: ReturnType<typeof setTimeout>;

  /** Current tabs (readonly quick access) */
  get tabs(): readonly EditorTab[] {
    return this._state.tabs;
  }

  /** Current active file path (readonly quick access) */
  get activeFilePath(): string {
    return this._state.activeFilePath;
  }

  /** Current active tab (readonly quick access) */
  get activeTab(): EditorTab | undefined {
    return this._state.tabs.find(
      (t) => t.filePath === this._state.activeFilePath,
    );
  }

  constructor(host: ReactiveControllerHost) {
    const initialState: EditorAreaState = { tabs: [], activeFilePath: '' };
    const actions: EditorAreaActions = {
      openFile: (filePath, content, viewMode) =>
        this._openFile(filePath, content, viewMode),
      closeFile: (filePath) => this._closeFile(filePath),
      closeAll: () => this._closeAll(),
      switchTab: (filePath) => this._switchTab(filePath),
      updateContent: (filePath, content) =>
        this._updateContent(filePath, content),
      saveFile: (filePath) => this._saveFile(filePath),
      setViewMode: (filePath, viewMode) =>
        this._setViewMode(filePath, viewMode),
      setCursorPosition: (filePath, position) =>
        this._setCursorPosition(filePath, position),
      loadContent: (filePath, content) => this._loadContent(filePath, content),
    };
    super(host, initialState, actions, log);
    this._restore();
  }

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
      const restoredTabs: EditorTab[] = saved.tabs.map((t) => ({
        filePath: t.filePath,
        content: '',
        isDirty: false,
        cursorPosition: isValidViewMode(t.viewMode)
          ? { line: 1, column: 1 }
          : (t.cursorPosition ?? { line: 1, column: 1 }),
        viewMode: isValidViewMode(t.viewMode) ? t.viewMode : 'edit',
      }));

      // activeFilePath must exist in restored tabs
      const activeExists = restoredTabs.some(
        (t) => t.filePath === saved.activeFilePath,
      );
      const activeFilePath = activeExists
        ? saved.activeFilePath
        : (restoredTabs[0]?.filePath ?? '');

      this._setState({ tabs: restoredTabs, activeFilePath });
    } catch (e) {
      // localStorage may be unavailable or data corrupted
      log.debug('Failed to restore editor area state:', e);
    }
  }

  private _persist() {
    try {
      if (this._state.tabs.length === 0) {
        localStorage.removeItem(STORAGE_KEYS.editorArea);
        return;
      }
      const data: PersistedEditorAreaData = {
        tabs: this._state.tabs.map((t) => ({
          filePath: t.filePath,
          viewMode: t.viewMode,
          cursorPosition: t.cursorPosition,
        })),
        activeFilePath: this._state.activeFilePath,
      };
      localStorage.setItem(STORAGE_KEYS.editorArea, JSON.stringify(data));
    } catch (e) {
      // localStorage may be unavailable
      log.debug('Failed to persist editor area state:', e);
    }
  }

  /* ── Actions ── */

  /**
   * Open a file
   *
   * Idempotent: if file is already open, only switches the tab without overwriting content.
   */
  private _openFile(
    filePath: string,
    content: string,
    viewMode: EditorViewMode = 'edit',
  ) {
    const existing = this._state.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      // Already open, only switch
      this._updateState({ activeFilePath: filePath });
      this._persist();
      this.host.requestUpdate();
      return;
    }

    const newTab: EditorTab = {
      filePath,
      content,
      isDirty: false,
      cursorPosition: { line: 1, column: 1 },
      viewMode,
    };

    this._setState({
      tabs: [...this._state.tabs, newTab],
      activeFilePath: filePath,
    });
    this._persist();
    this.host.requestUpdate();
  }

  /**
   * Close a tab
   *
   * Auto-switches to adjacent tab after closing. Clears activeFilePath if closing the last tab.
   */
  private _closeFile(filePath: string) {
    const index = this._state.tabs.findIndex((t) => t.filePath === filePath);
    if (index === -1) return;

    const wasActive = filePath === this._state.activeFilePath;

    const newTabs = this._state.tabs.filter((t) => t.filePath !== filePath);

    let newActiveFilePath = this._state.activeFilePath;
    if (wasActive) {
      if (newTabs.length === 0) {
        newActiveFilePath = '';
      } else {
        // Switch to adjacent tab (prefer left)
        const newIndex = Math.min(index, newTabs.length - 1);
        newActiveFilePath = newTabs[newIndex].filePath;
      }
    }

    this._setState({ tabs: newTabs, activeFilePath: newActiveFilePath });
    this._persist();
    this.host.requestUpdate();
  }

  /**
   * Close all tabs
   */
  private _closeAll() {
    this._setState({ tabs: [], activeFilePath: '' });
    this._persist();
    this.host.requestUpdate();
  }

  /**
   * Switch to a specific tab
   */
  private _switchTab(filePath: string) {
    const exists = this._state.tabs.some((t) => t.filePath === filePath);
    if (!exists) return;

    this._updateState({ activeFilePath: filePath });
    this._persist();
    this.host.requestUpdate();
  }

  /**
   * Update content (auto-marks dirty)
   */
  private _updateContent(filePath: string, content: string) {
    const newTabs = this._state.tabs.map((t) => {
      if (t.filePath !== filePath) return t;
      return {
        ...t,
        content,
        isDirty: true,
      };
    });
    // Content changes frequently; skip persistence to avoid localStorage thrashing;
    // dirty state and content are authoritative in VFS; reload from VFS after refresh.
    this._setState({
      tabs: newTabs,
      activeFilePath: this._state.activeFilePath,
    });
    this.host.requestUpdate();
  }

  /**
   * Save file (clears dirty flag)
   *
   * Note: actual VFS write is handled externally by listening to the editor-area-save event.
   */
  private _saveFile(filePath: string) {
    const newTabs = this._state.tabs.map((t) => {
      if (t.filePath !== filePath) return t;
      return { ...t, isDirty: false };
    });
    this._setState({
      tabs: newTabs,
      activeFilePath: this._state.activeFilePath,
    });
    this._persist();
    this.host.requestUpdate();
  }

  /**
   * Set view mode
   */
  private _setViewMode(filePath: string, viewMode: EditorViewMode) {
    const newTabs = this._state.tabs.map((t) => {
      if (t.filePath !== filePath) return t;
      return { ...t, viewMode };
    });
    this._setState({
      tabs: newTabs,
      activeFilePath: this._state.activeFilePath,
    });
    this._persist();
    this.host.requestUpdate();
  }

  /**
   * Update cursor position
   */
  private _setCursorPosition(
    filePath: string,
    position: { line: number; column: number },
  ) {
    const tab = this._state.tabs.find((t) => t.filePath === filePath);
    if (!tab) return;
    // Position unchanged, skip
    if (
      tab.cursorPosition.line === position.line &&
      tab.cursorPosition.column === position.column
    ) {
      return;
    }
    const newTabs = this._state.tabs.map((t) => {
      if (t.filePath !== filePath) return t;
      return { ...t, cursorPosition: position };
    });
    this._setState({
      tabs: newTabs,
      activeFilePath: this._state.activeFilePath,
    });
    // Trigger host update so status bar updates in real time
    this.host.requestUpdate();
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
    const existing = this._state.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      const newTabs = this._state.tabs.map((t) => {
        if (t.filePath !== filePath) return t;
        // Clear isDirty when loading content (e.g., after restore default)
        return { ...t, content, isDirty: false };
      });
      this._setState({
        tabs: newTabs,
        activeFilePath: this._state.activeFilePath,
      });
      this.host.requestUpdate();
      return;
    }
    // Create tab when it does not exist (for cases where external code calls loadContent directly)
    const newTab: EditorTab = {
      filePath,
      content,
      isDirty: false,
      cursorPosition: { line: 1, column: 1 },
      viewMode: 'edit',
    };
    const newTabs = [...this._state.tabs, newTab];
    const newActiveFilePath = this._state.activeFilePath || filePath;
    this._setState({ tabs: newTabs, activeFilePath: newActiveFilePath });
    this._persist();
    this.host.requestUpdate();
  }
}
