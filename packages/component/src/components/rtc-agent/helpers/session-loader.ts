/**
 * Session loading and tab synchronization for <rtc-agent>.
 *
 * Loads sessions from persistence, syncs them into SessionController,
 * manages tab restoration/creation/filtering, and handles auto-select
 * on initial load.
 *
 * Extracted from rtc-agent.ts to keep the root component lean.
 */
import { msg } from '@lit/localize';
import type { Logger } from '@rtc-agent/client';
import type { PersistenceLayer } from '@rtc-agent/persistence';
import type { Session, SessionStatus } from '../../../types/index.js';

// ── Dependency interfaces ──

export interface SessionLoaderDeps {
    persistenceLayer: PersistenceLayer | undefined;
    session: {
        value: { state: { currentSessionId: string | null } };
        actions: {
            setSessions(sessions: Session[]): void;
            switchSession(id: string): void;
            clearCurrentSession(): void;
        };
    };
    sessionTree: {
        actions: { rebuildTree(sessions: Session[]): void };
    };
    sessionTab: {
        value: {
            state: {
                tabs: ReadonlyArray<{ sessionId: string; title: string }>;
                activeSessionId: string | null;
            };
        };
        actions: {
            getStoredActiveSessionId(): string | null;
            openOrActivate(
                sessionId: string,
                title: string,
                opts?: {
                    activate?: boolean;
                    skipPersist?: boolean;
                    isUnsaved?: boolean;
                },
            ): void;
            setActiveTab(sessionId: string): void;
        };
        // Direct methods (not in actions interface but on the controller itself)
        filterInvalidTabs(validIds: Set<string>): boolean;
        updateTabTitles(titleMap: Map<string, string>): boolean;
        syncTabStatuses(statusMap: Map<string, SessionStatus>): void;
    };
    logger: Logger;
}

// ── Public API ──

/**
 * Load sessions list from persistence and sync into SessionController.
 *
 * On initial load (after refresh), auto-selects the most recently updated session
 * if none is currently selected.
 *
 * Side effects:
 * - Updates SessionController with the loaded sessions.
 * - Rebuilds the session tree.
 * - Restores tabs from DB on first load.
 * - Filters invalid tabs (sessions deleted from persistence).
 * - Syncs tab titles and statuses.
 * - Auto-selects a session on initial load.
 *
 * @param initialLoadDone - Whether the initial load has already been performed.
 * @param deps - Dependencies for session, tab, and tree management.
 * @returns `true` if the initial load was performed during this call.
 */
export async function loadSessions(
    initialLoadDone: boolean,
    deps: SessionLoaderDeps,
): Promise<boolean> {
    if (!deps.persistenceLayer) return initialLoadDone;

    const sessions = await deps.persistenceLayer.listSessions();
    deps.logger.debug("Loaded sessions from DB:", sessions.length);

    const uiSessions: Session[] = sessions.map((s) => ({
        clientId: s.client_id,
        deviceId: s.device_id,
        title: s.title || "",
        createdAt: new Date(s.created_at).getTime(),
        updatedAt: new Date(s.updated_at).getTime(),
        todoList: s.todo_list,
        rootClientSessionId: s.root_client_session_id,
        status: s.status as SessionStatus | undefined,
        // Token usage fields (auto-populated after backend session.updated push).
        totalInputTokens: s.total_input_tokens,
        totalOutputTokens: s.total_output_tokens,
        totalTokens: s.total_tokens,
        currentContextTokens: s.current_context_tokens,
        totalCachedReadTokens: s.total_cached_read_tokens,
        totalCachedWriteTokens: s.total_cached_write_tokens,
        totalReasoningTokens: s.total_reasoning_tokens,
        totalCostUsd: s.total_cost_usd,
        lastTokenUpdateAt: s.last_token_update_at,
        // Token estimation fields (real-time computed by backend, pushed via session.updated).
        compressionThreshold: s.compression_threshold,
        compressionProgress: s.compression_progress,
        roundsUntilCompression: s.rounds_until_compression,
        estimatedNextRoundTokens: s.estimated_next_round_tokens,
    }));
    deps.session.actions.setSessions(uiSessions);

    // Sync to SessionTreeController (build hierarchical tree).
    deps.sessionTree.actions.rebuildTree(uiSessions);

    // ── Restore tabs from DB on initial load (replaces localStorage) ──
    let initialLoadDoneFlag = initialLoadDone;

    if (!initialLoadDoneFlag) {
        const openSessions = uiSessions
            .filter((s) => s.status !== "closed")
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

        const storedActiveId = deps.sessionTab.actions.getStoredActiveSessionId();

        // Use skipPersist: true for batch restore to avoid N localStorage overwrites.
        // Only the tab matching storedActiveId gets activate: true; others get activate: false.
        for (const session of openSessions) {
            const title = session.title || msg('未命名');
            const shouldActivate = session.clientId === storedActiveId;
            deps.sessionTab.actions.openOrActivate(session.clientId, title, {
                activate: shouldActivate,
                skipPersist: true,
            });
        }
        deps.logger.debug(
            "Restored tabs from DB:",
            openSessions.length,
            "storedActiveId:",
            storedActiveId,
        );

        // Fallback: if storedActiveId isn't in tabs, activate the first tab.
        if (
            deps.sessionTab.value.state.activeSessionId === null &&
            openSessions.length > 0
        ) {
            const fallbackId = openSessions[0].clientId;
            deps.logger.debug(
                "Active tab is null, falling back to first tab:",
                fallbackId,
            );
            deps.sessionTab.actions.setActiveTab(fallbackId);
        }
    }

    // Filter invalid tabs (clean up tabs whose sessions have been deleted from persistence).
    const validIds = new Set(uiSessions.map((s) => s.clientId));
    const hadInvalidTabs = deps.sessionTab.filterInvalidTabs(validIds);
    deps.logger.debug(
        "filterInvalidTabs:",
        hadInvalidTabs ? "removed some" : "none removed",
    );
    deps.logger.debug(
        "Tabs after filter:",
        deps.sessionTab.value.state.tabs.map((t) => `${t.sessionId}="${t.title}"`),
    );
    deps.logger.debug(
        "activeSessionId:",
        deps.sessionTab.value.state.activeSessionId,
    );

    // Sync SessionController.currentSessionId with Tab's activeSessionId.
    // When the active tab is filtered out, switch session to trigger message cleanup.
    const newActiveId = deps.sessionTab.value.state.activeSessionId;
    const currentId = deps.session.value.state.currentSessionId;
    if (currentId !== newActiveId) {
        deps.logger.debug(
            "Syncing currentSessionId:",
            currentId,
            "->",
            newActiveId,
        );
        if (newActiveId) {
            deps.session.actions.switchSession(newActiveId);
        } else {
            deps.session.actions.clearCurrentSession();
        }
    }

    // Sync existing tab titles with the latest titles from sessions.
    // Fix: new session tabs created with empty titles need updating when the server returns the real title.
    const titleMap = new Map(uiSessions.map((s) => [s.clientId, s.title]));
    const titlesUpdated = deps.sessionTab.updateTabTitles(titleMap);
    deps.logger.debug(
        "updateTabTitles:",
        titlesUpdated ? "updated" : "no change",
    );
    deps.logger.debug(
        "Tabs after title sync:",
        deps.sessionTab.value.state.tabs.map((t) => `${t.sessionId}="${t.title}"`),
    );

    // Sync existing tabs' status with latest status from sessions (drives status dot display).
    const statusMap = new Map(
        uiSessions.filter((s) => s.status).map((s) => [s.clientId, s.status!]),
    );
    if (statusMap.size > 0) {
        deps.sessionTab.syncTabStatuses(statusMap);
    }

    // Auto-select on initial load only (e.g. after refresh).
    // Don't auto-select on subsequent session updates (user may have clicked + to clear selection).
    // Only auto-select if there are open tabs (avoid selecting session when all tabs were closed).
    if (!initialLoadDoneFlag) {
        initialLoadDoneFlag = true;
        const hasOpenTabs = deps.sessionTab.value.state.tabs.length > 0;
        deps.logger.debug(
            "Initial load: hasOpenTabs=",
            hasOpenTabs,
            "currentSessionId=",
            deps.session.value.state.currentSessionId,
        );
        if (hasOpenTabs && !deps.session.value.state.currentSessionId) {
            // Prefer restoring the Tab bar's active tab (even if its session isn't in DB, e.g. unsaved tab).
            // Fall back to the most recently updated session (only when no active tab exists).
            const activeTabId = deps.sessionTab.value.state.activeSessionId;
            const targetId =
                activeTabId ??
                (uiSessions.length > 0
                    ? uiSessions.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
                            .clientId
                    : null);
            if (targetId) {
                deps.logger.debug(
                    "Auto-selecting session:",
                    targetId,
                    "(from activeTabId:",
                    activeTabId,
                    ")",
                );
                deps.session.actions.switchSession(targetId);
            }
        }
    }

    return initialLoadDoneFlag;
}
