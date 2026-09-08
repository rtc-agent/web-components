/**
 * Editor Area Controller
 *
 * 管理 Editor Area 的状态：
 * - 打开的文件标签列表
 * - 当前活动文件
 * - 每个标签的内容和脏状态
 * - 每个标签的视图模式
 *
 * 提供 actions 供组件或 Debug HTML 调用。
 *
 * 设计要点：
 * - 同一路径只允许开一个 tab（幂等打开）
 * - 关闭最后一个 tab 后 activeFilePath 清空
 * - 关闭当前活动 tab 后自动切到相邻 tab
 * - 内容变更时标记 isDirty
 * - 保存时清除 isDirty（实际写入 VFS 由外部处理）
 *
 * ## 持久化
 * - 通过 localStorage 保存打开的 tab 列表（filePath, viewMode, cursorPosition）
 *   和 activeFilePath。内容（content）不持久化，刷新后从 VFS 重新加载。
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {EditorTab, EditorViewMode} from '../types/index.js';
import {STORAGE_KEYS} from '../config/auth.js';

/** 持久化的 Tab 数据（不含 content） */
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
    /** 打开文件（幂等：已存在则切换到该 tab） */
    openFile(filePath: string, content: string): void;
    /** 关闭标签 */
    closeFile(filePath: string): void;
    /** 关闭所有标签 */
    closeAll(): void;
    /** 切换到指定标签 */
    switchTab(filePath: string): void;
    /** 更新内容（自动标记 dirty） */
    updateContent(filePath: string, content: string): void;
    /** 保存文件（清除 dirty 标记） */
    saveFile(filePath: string): void;
    /** 设置视图模式 */
    setViewMode(filePath: string, viewMode: EditorViewMode): void;
    /** 更新光标位置 */
    setCursorPosition(filePath: string, position: {line: number; column: number}): void;
    /**
     * 静默设置文件内容（不标记 dirty）
     *
     * 用于刷新后从 VFS 重新加载内容到已恢复的 tab。
     * 如果 tab 不存在，则创建新 tab。
     */
    loadContent(filePath: string, content: string): void;
}

export class EditorAreaController implements ReactiveController {
    private _host: ReactiveControllerHost;
    private _tabs: EditorTab[] = [];
    private _activeFilePath = '';

    /** 光标位置持久化节流：避免频繁写 localStorage */
    private _cursorPersistTimer?: ReturnType<typeof setTimeout>;

    readonly actions: EditorAreaActions;

    constructor(host: ReactiveControllerHost) {
        this._host = host;
        this._host.addController(this);
        this.actions = {
            openFile: (filePath, content) => this._openFile(filePath, content),
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
        // 清理节流定时器
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

            // 用空 content 恢复 tab；内容等待 VFS 就绪后由外部调用 loadContent 填充
            this._tabs = saved.tabs.map(t => ({
                filePath: t.filePath,
                content: '',
                isDirty: false,
                cursorPosition: isValidViewMode(t.viewMode)
                    ? {line: 1, column: 1}
                    : (t.cursorPosition ?? {line: 1, column: 1}),
                viewMode: isValidViewMode(t.viewMode) ? t.viewMode : 'edit',
            }));

            // activeFilePath 必须在恢复后的 tabs 中存在
            const activeExists = this._tabs.some(t => t.filePath === saved.activeFilePath);
            this._activeFilePath = activeExists ? saved.activeFilePath : (this._tabs[0]?.filePath ?? '');
        } catch {
            // localStorage may be unavailable or data corrupted
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
        } catch {
            // localStorage may be unavailable
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
     * 打开文件
     *
     * 幂等：如果文件已打开，只切换标签不覆盖内容。
     */
    private _openFile(filePath: string, content: string) {
        const existing = this._tabs.find(t => t.filePath === filePath);
        if (existing) {
            // 已打开，只切换
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
            viewMode: 'edit',
        };

        this._tabs = [...this._tabs, newTab];
        this._activeFilePath = filePath;
        this._persist();
        this._host.requestUpdate();
    }

    /**
     * 关闭标签
     *
     * 关闭后自动切换到相邻标签。如果关闭的是最后一个，清空 activeFilePath。
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
                // 切换到相邻标签（优先左侧）
                const newIndex = Math.min(index, this._tabs.length - 1);
                this._activeFilePath = this._tabs[newIndex].filePath;
            }
        }

        this._persist();
        this._host.requestUpdate();
    }

    /**
     * 关闭所有标签
     */
    private _closeAll() {
        this._tabs = [];
        this._activeFilePath = '';
        this._persist();
        this._host.requestUpdate();
    }

    /**
     * 切换到指定标签
     */
    private _switchTab(filePath: string) {
        const exists = this._tabs.some(t => t.filePath === filePath);
        if (!exists) return;

        this._activeFilePath = filePath;
        this._persist();
        this._host.requestUpdate();
    }

    /**
     * 更新内容（自动标记 dirty）
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
        // 内容变更频繁，不持久化（避免 localStorage 抖动）；
        // 脏状态和内容由 VFS 作为权威来源，刷新后从 VFS 重新加载。
        this._host.requestUpdate();
    }

    /**
     * 保存文件（清除 dirty 标记）
     *
     * 注意：实际写入 VFS 由外部监听 editor-area-save 事件处理。
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
     * 设置视图模式
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
     * 更新光标位置
     */
    private _setCursorPosition(filePath: string, position: {line: number; column: number}) {
        const tab = this._tabs.find(t => t.filePath === filePath);
        if (!tab) return;
        // 位置没变，跳过
        if (tab.cursorPosition.line === position.line && tab.cursorPosition.column === position.column) {
            return;
        }
        this._tabs = this._tabs.map(t => {
            if (t.filePath !== filePath) return t;
            return {...t, cursorPosition: position};
        });
        // 触发 host update 让 status bar 实时更新
        this._host.requestUpdate();
        // 节流持久化：2 秒内只写一次 localStorage，避免光标频繁移动导致的 IO 抖动
        if (this._cursorPersistTimer) return;
        this._cursorPersistTimer = setTimeout(() => {
            this._cursorPersistTimer = undefined;
            this._persist();
        }, 2000);
    }

    /**
     * 静默设置文件内容（不标记 dirty）
     *
     * 用于刷新后从 VFS 重新加载内容到已恢复的 tab。
     * 如果 tab 不存在，则创建新 tab。
     */
    private _loadContent(filePath: string, content: string) {
        const existing = this._tabs.find(t => t.filePath === filePath);
        if (existing) {
            this._tabs = this._tabs.map(t => {
                if (t.filePath !== filePath) return t;
                return {...t, content};
            });
            this._host.requestUpdate();
            return;
        }
        // tab 不存在时创建（兼容外部直接调用 loadContent 的场景）
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
