/**
 * Session Tree Controller
 *
 * 将平铺的 session 列表构建为层级树：
 * - rootClientSessionId 为空的 session 作为根节点
 * - 其余 session 按 rootClientSessionId 分组，挂到对应根节点的 children 中
 *
 * 管理展开/折叠状态。session 列表变化时通过 rebuildTree() 重建。
 *
 * 对应：`SessionTreeContext`（contexts/session-tree.ts）
 * 消费方：<rtc-session-tree>, <rtc-session-tree-item>
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Session, SessionTreeNode, SessionTreeState, SessionTreeActions} from '../types/index.js';
import {STORAGE_KEYS} from '../config/auth.js';

/** Expanded state: sessionId → isExpanded */
type ExpandedMap = Record<string, boolean>;

export class SessionTreeController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: SessionTreeState = {rootNodes: []};
    /** 展开状态的 Map：sessionId → isExpanded。默认全部折叠。 */
    private _expanded = new Map<string, boolean>();

    readonly actions: SessionTreeActions;

    get value(): {state: SessionTreeState; actions: SessionTreeActions} {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            toggleExpand: (id: string) => this._toggleExpand(id),
            expand: (id: string) => this._setExpanded(id, true),
            collapse: (id: string) => this._setExpanded(id, false),
            rebuildTree: (sessions: Session[]) => this._rebuildTree(sessions),
        };

        this._restoreExpanded();
    }

    hostConnected() {}
    hostDisconnected() {}

    /* ── Persistence ── */

    private _restoreExpanded() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.sessionTreeExpanded);
            if (!raw) return;
            const saved: ExpandedMap = JSON.parse(raw);
            for (const [sessionId, isExpanded] of Object.entries(saved)) {
                this._expanded.set(sessionId, Boolean(isExpanded));
            }
        } catch {
            // localStorage may be unavailable or data corrupted
        }
    }

    private _persistExpanded() {
        try {
            const map: ExpandedMap = {};
            this._expanded.forEach((isExpanded, sessionId) => {
                if (isExpanded) {
                    map[sessionId] = true;
                }
            });
            // Only persist non-empty state
            if (Object.keys(map).length > 0) {
                localStorage.setItem(STORAGE_KEYS.sessionTreeExpanded, JSON.stringify(map));
            } else {
                localStorage.removeItem(STORAGE_KEYS.sessionTreeExpanded);
            }
        } catch {
            // localStorage may be unavailable
        }
    }

    /* ── Private ── */

    private _toggleExpand(sessionId: string) {
        const current = this._expanded.get(sessionId) ?? false;
        this._setExpanded(sessionId, !current);
    }

    private _setExpanded(sessionId: string, expanded: boolean) {
        this._expanded.set(sessionId, expanded);
        this._persistExpanded();
        this._rebuildTreeFromCache();
    }

    /**
     * 用当前缓存的 sessions 和展开状态重建树
     *
     * rebuildTree 时 sessions 会更新，但展开状态 (_expanded) 保留。
     * 此方法从 _expanded 读取最新展开状态来重建。
     */
    private _rebuildTreeFromCache() {
        // 重建时 sessions 已经在 _state 中（由 rebuildTree 更新）
        // 但 _rebuildTreeFromCache 需要 sessions，我们用闭包缓存
        if (this._cachedSessions) {
            this._buildTree(this._cachedSessions);
        }
    }

    private _cachedSessions?: Session[];

    private _rebuildTree(sessions: Session[]) {
        this._cachedSessions = sessions;
        this._buildTree(sessions);
    }

    private _buildTree(sessions: Session[]) {
        console.log('[SessionTreeController._buildTree] Building tree from', sessions.length, 'sessions');
        // 1. 分类：root sessions vs child sessions
        const rootSessions = sessions.filter(s => !s.rootClientSessionId);
        console.log('[SessionTreeController._buildTree] Root sessions:', rootSessions.length);
        const childMap = new Map<string, Session[]>();
        for (const s of sessions) {
            if (s.rootClientSessionId) {
                const children = childMap.get(s.rootClientSessionId) ?? [];
                children.push(s);
                childMap.set(s.rootClientSessionId, children);
            }
        }
        console.log('[SessionTreeController._buildTree] Child sessions grouped:', childMap.size, 'groups');

        // 2. 构建树，保留已有展开状态
        const rootNodes: SessionTreeNode[] = rootSessions.map(s =>
            this._buildNode(s, childMap)
        );

        // 3. 按 updatedAt 降序排列（最近的在上面）
        rootNodes.sort((a, b) => b.session.updatedAt - a.session.updatedAt);

        this._state = {rootNodes};
        this.host.requestUpdate();
        console.log('[SessionTreeController._buildTree] Tree built, rootNodes:', rootNodes.length);
    }

    private _buildNode(session: Session, childMap: Map<string, Session[]>): SessionTreeNode {
        const children = (childMap.get(session.clientId) ?? [])
            .sort((a, b) => a.createdAt - b.createdAt)
            .map(child => this._buildNode(child, childMap));

        return {
            session,
            children,
            isExpanded: this._expanded.get(session.clientId) ?? false,
        };
    }
}
