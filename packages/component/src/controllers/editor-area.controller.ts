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
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {EditorTab, EditorViewMode} from '../types/index.js';

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
}

export class EditorAreaController implements ReactiveController {
    private _host: ReactiveControllerHost;
    private _tabs: EditorTab[] = [];
    private _activeFilePath = '';

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
        };
    }

    hostConnected() {}

    hostDisconnected() {}

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
            this._host.requestUpdate();
            return;
        }

        const newTab: EditorTab = {
            filePath,
            content,
            isDirty: false,
            cursorPosition: {line: 1, column: 1},
            viewMode: 'split',
        };

        this._tabs = [...this._tabs, newTab];
        this._activeFilePath = filePath;
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

        this._host.requestUpdate();
    }

    /**
     * 关闭所有标签
     */
    private _closeAll() {
        this._tabs = [];
        this._activeFilePath = '';
        this._host.requestUpdate();
    }

    /**
     * 切换到指定标签
     */
    private _switchTab(filePath: string) {
        const exists = this._tabs.some(t => t.filePath === filePath);
        if (!exists) return;

        this._activeFilePath = filePath;
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
        this._host.requestUpdate();
    }

    /**
     * 更新光标位置
     */
    private _setCursorPosition(filePath: string, position: {line: number; column: number}) {
        this._tabs = this._tabs.map(t => {
            if (t.filePath !== filePath) return t;
            return {...t, cursorPosition: position};
        });
        // 光标移动频繁，不触发 host update（避免性能问题）
    }
}
