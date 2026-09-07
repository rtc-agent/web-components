/**
 * Session Tab Controller
 *
 * 管理对话页面的 Tab 页签：
 * - 打开/切换到 session 的 tab
 * - 关闭 tab（关闭活动 tab 时自动激活相邻 tab）
 * - 清空所有 tab
 *
 * Tab 以 sessionId 为唯一标识，同一 session 只允许开一个 tab。
 *
 * 对应：`SessionTabContext`（contexts/session-tab.ts）
 * 消费方：<rtc-session-tab-bar>, <rtc-chat-layout>
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {SessionTab, SessionTabState, SessionTabActions} from '../types/index.js';
import {STORAGE_KEYS} from '../config/auth.js';

/** 持久化的 Tab 数据 */
interface PersistedTabData {
    tabs: SessionTab[];
    activeSessionId: string | null;
}

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
            openOrActivate: (sessionId: string, title: string, options?: { isUnsaved?: boolean }) =>
                this._openOrActivate(sessionId, title, options),
            closeTab: (sessionId: string) => this._closeTab(sessionId),
            setActiveTab: (sessionId: string | null) =>
                this._setActiveTab(sessionId),
            clearAll: () => this._clearAll(),
            updateTabTitles: (sessionTitleMap: Map<string, string>) =>
                this.updateTabTitles(sessionTitleMap),
            markSaved: (sessionId: string) => this._markSaved(sessionId),
            findUnsavedTab: () => this._findUnsavedTab(),
        };

        this._restoreTabs();
    }

    hostConnected() {}
    hostDisconnected() {}

    /* ─ Persistence ── */

    private _restoreTabs() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.sessionTabs);
            console.log('[SessionTabController._restoreTabs] localStorage data:', raw);
            if (!raw) return;
            const saved: PersistedTabData = JSON.parse(raw);
            if (saved.tabs && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
                const migrated = saved.tabs.map(t => ({
                    ...t,
                    isDefault: t.isDefault ?? this._isPlaceholderTitle(t.title),
                    isUnsaved: t.isUnsaved ?? false,
                }));
                this._state = {
                    tabs: migrated,
                    activeSessionId: saved.activeSessionId ?? null,
                };
                console.log('[SessionTabController._restoreTabs] Restored tabs:', migrated.map(t => `${t.sessionId}="${t.title}"(isDefault=${t.isDefault})`));
                console.log('[SessionTabController._restoreTabs] Restored activeSessionId:', saved.activeSessionId);
            }
        } catch {
            // localStorage may be unavailable or data corrupted
        }
    }

    private _persistTabs() {
        try {
            if (this._state.tabs.length === 0) {
                localStorage.removeItem(STORAGE_KEYS.sessionTabs);
                console.log('[SessionTabController._persistTabs] Cleared (no tabs)');
            } else {
                const data: PersistedTabData = {
                    tabs: this._state.tabs,
                    activeSessionId: this._state.activeSessionId,
                };
                localStorage.setItem(STORAGE_KEYS.sessionTabs, JSON.stringify(data));
                console.log('[SessionTabController._persistTabs] Saved tabs:', this._state.tabs.map(t => `${t.sessionId}="${t.title}"`));
                console.log('[SessionTabController._persistTabs] Saved activeSessionId:', this._state.activeSessionId);
            }
        } catch {
            // localStorage may be unavailable
        }
    }

    /**
     * 过滤掉无效 Tab（session 已被删除或不存在）
     *
     * 在 session 列表从 IndexedDB 加载后调用，清理持久化中残留的无效 Tab。
     * `isUnsaved === true` 的 tab 即使 sessionId 不在 DB 中也保留（它们是尚未持久化的 draft）。
     * 返回 true 表示有 Tab 被移除（调用方可能需要更新 UI）。
     */
    filterInvalidTabs(validSessionIds: Set<string>): boolean {
        const before = this._state.tabs.length;
        const tabs = this._state.tabs.filter(
            t => validSessionIds.has(t.sessionId) || t.isUnsaved === true
        );
        let activeSessionId = this._state.activeSessionId;

        console.log('[SessionTabController.filterInvalidTabs] before:', before, 'after:', tabs.length);
        console.log('[SessionTabController.filterInvalidTabs] activeSessionId:', activeSessionId);

        // 如果活动 Tab 被过滤掉了（且不属于保留的 unsaved tab），激活第一个可用的
        if (activeSessionId && !tabs.some(t => t.sessionId === activeSessionId)) {
            activeSessionId = tabs.length > 0 ? tabs[0].sessionId : null;
            console.log('[SessionTabController.filterInvalidTabs] activeTab filtered out, new activeSessionId:', activeSessionId);
        }

        if (tabs.length !== before) {
            this._state = {tabs, activeSessionId};
            this._persistTabs();
            this.host.requestUpdate();
            return true;
        }
        return false;
    }

    /**
     * 用 sessions 中的最新标题同步已有 Tab 的标题
     *
     * 新建会话发送消息时，Tab 以客户端生成的标题创建（从首条消息提取）。
     * 当 session 列表从 DB 刷新后（含 server 返回的标题），
     * 用此方法同步更新 Tab 标题。
     *
     * 只更新 `isDefault` 为 true 的 Tab（即默认/占位标题），避免覆盖已有真实标题。
     * 更新后将 `isDefault` 置为 false。
     *
     * 注意：服务器可能返回空标题或默认标题，此时应保留客户端从消息内容生成的标题。
     */
    updateTabTitles(sessionTitleMap: Map<string, string>): boolean {
        console.log('[SessionTabController.updateTabTitles] Called with', sessionTitleMap.size, 'titles');
        let changed = false;
        const tabs = this._state.tabs.map(t => {
            const newTitle = sessionTitleMap.get(t.sessionId);
            // 只更新 isDefault 的 Tab，且新标题非空
            const shouldUpdate = t.isDefault === true &&
                newTitle !== undefined &&
                newTitle.trim() !== '' &&
                newTitle !== t.title;
            if (shouldUpdate) {
                console.log('[SessionTabController.updateTabTitles] Updating tab', t.sessionId, ':', `"${t.title}"`, '->', `"${newTitle}"`);
                changed = true;
                return {...t, title: newTitle, isDefault: false, isUnsaved: false};
            }
            return t;
        });

        if (changed) {
            this._state = {...this._state, tabs};
            this._persistTabs();
            this.host.requestUpdate();
        }
        return changed;
    }

    /* ── Private ── */

    private _isPlaceholderTitle(title: string): boolean {
        return !title || title === 'Untitled' || title === 'New Chat';
    }

    /** 查找当前 unsaved tab，返回第一个 isUnsaved === true 的 tab。 */
    private _findUnsavedTab(): SessionTab | undefined {
        return this._state.tabs.find(t => t.isUnsaved === true);
    }

    /** 将指定 tab 标记为已保存。 */
    private _markSaved(sessionId: string): void {
        const tab = this._state.tabs.find(t => t.sessionId === sessionId);
        if (!tab || tab.isUnsaved !== true) return;
        const tabs = this._state.tabs.map(t =>
            t.sessionId === sessionId ? {...t, isUnsaved: false} : t
        );
        this._state = {...this._state, tabs};
        this._persistTabs();
        this.host.requestUpdate();
    }

    private _openOrActivate(sessionId: string, title: string, options?: { isUnsaved?: boolean }) {
        console.log('[SessionTabController._openOrActivate] sessionId:', sessionId, 'title:', `"${title}"`);
        console.log('[SessionTabController._openOrActivate] Current tabs:', this._state.tabs.map(t => `${t.sessionId}="${t.title}"(isDefault=${t.isDefault})`));

        const isPlaceholder = this._isPlaceholderTitle(title);
        const existingIndex = this._state.tabs.findIndex(
            t => t.sessionId === sessionId
        );

        if (existingIndex >= 0) {
            const existing = this._state.tabs[existingIndex];
            // 保护已有真实标题的 Tab 不被占位标题覆盖
            if (isPlaceholder && !existing.isDefault && existing.title !== title) {
                console.log('[SessionTabController._openOrActivate] Protected tab title:', existing.title);
                // 仍然激活该 Tab，但不更新标题
                if (this._state.activeSessionId !== sessionId) {
                    this._state = {...this._state, activeSessionId: sessionId};
                    this._persistTabs();
                    this.host.requestUpdate();
                }
                return;
            }
            const tabs = this._state.tabs.map((t, i) =>
                i === existingIndex
                    ? {...t, title, isDefault: isPlaceholder ? true : false}
                    : t
            );
            this._state = {tabs, activeSessionId: sessionId};
        } else {
            const newTab: SessionTab = {
                sessionId,
                title,
                isDefault: isPlaceholder ? true : false,
                isUnsaved: options?.isUnsaved ?? false,
            };
            const tabs = [...this._state.tabs, newTab];
            this._state = {tabs, activeSessionId: sessionId};
        }

        console.log('[SessionTabController._openOrActivate] Final tabs:', this._state.tabs.map(t => `${t.sessionId}="${t.title}"(isDefault=${t.isDefault})`));
        this._persistTabs();
        this.host.requestUpdate();
    }

    private _closeTab(sessionId: string) {
        const tabIndex = this._state.tabs.findIndex(t => t.sessionId === sessionId);
        if (tabIndex < 0) return;

        const tabs = this._state.tabs.filter(t => t.sessionId !== sessionId);

        let activeSessionId = this._state.activeSessionId;

        if (activeSessionId === sessionId) {
            // 关闭的是活动 tab → 激活相邻 tab
            if (tabs.length === 0) {
                activeSessionId = null;
            } else {
                // 优先激活右侧 tab，否则激活左侧
                const nextIndex = Math.min(tabIndex, tabs.length - 1);
                activeSessionId = tabs[nextIndex].sessionId;
            }
        }

        this._state = {tabs, activeSessionId};
        this._persistTabs();
        this.host.requestUpdate();
    }

    private _setActiveTab(sessionId: string | null) {
        if (sessionId !== null && sessionId !== this._state.activeSessionId) {
            this._state = {...this._state, activeSessionId: sessionId};
            this._persistTabs();
            this.host.requestUpdate();
        } else if (sessionId === null && this._state.activeSessionId !== null) {
            this._state = {...this._state, activeSessionId: null};
            this._persistTabs();
            this.host.requestUpdate();
        }
    }

    private _clearAll() {
        this._state = {tabs: [], activeSessionId: null};
        this._persistTabs();
        this.host.requestUpdate();
    }
}
