/**
 * Session Tree Controller
 *
 * Builds a hierarchical tree from a flat session list:
 * - Sessions with empty rootClientSessionId become root nodes
 * - Remaining sessions are grouped by rootClientSessionId under their corresponding root node's children
 *
 * Manages expand/collapse state. Tree is rebuilt via rebuildTree() when session list changes.
 *
 * Corresponds to: `SessionTreeContext` (contexts/session-tree.ts)
 * Consumed by: <rtc-session-tree>, <rtc-session-tree-item>
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Session, SessionTreeNode, SessionTreeState, SessionTreeActions} from '../types/index.js';
import {STORAGE_KEYS} from '../config/auth.js';

/** Expanded state: sessionId → isExpanded */
type ExpandedMap = Record<string, boolean>;

export class SessionTreeController implements ReactiveController {
    host: ReactiveControllerHost;

    private _state: SessionTreeState = {rootNodes: []};
    /** Expanded state Map: sessionId → isExpanded. Default is all collapsed. */
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
        // Default all collapsed, do not restore previous expand state
        // To persist expand state, read from localStorage here
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
     * Rebuild tree using currently cached sessions and expand state
     *
     * During rebuildTree, sessions are updated but expand state (_expanded) is preserved.
     * This method reads the latest expand state from _expanded to rebuild.
     */
    private _rebuildTreeFromCache() {
        // During rebuild, sessions are already in _state (updated by rebuildTree)
        // But _rebuildTreeFromCache needs sessions, so we cache them via closure
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
        // 1. Categorize: root sessions vs child sessions
        const rootSessions = sessions.filter(s => !s.rootClientSessionId);
        const childMap = new Map<string, Session[]>();
        for (const s of sessions) {
            if (s.rootClientSessionId) {
                const children = childMap.get(s.rootClientSessionId) ?? [];
                children.push(s);
                childMap.set(s.rootClientSessionId, children);
            }
        }

        // 2. Build tree, preserving existing expand state
        const rootNodes: SessionTreeNode[] = rootSessions.map(s =>
            this._buildNode(s, childMap)
        );

        // 3. Sort by updatedAt descending (most recent on top)
        rootNodes.sort((a, b) => b.session.updatedAt - a.session.updatedAt);

        this._state = {rootNodes};
        this.host.requestUpdate();
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
