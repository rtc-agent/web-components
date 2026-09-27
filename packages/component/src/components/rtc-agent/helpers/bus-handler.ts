/**
 * UIUpdateBus subscription handler for <rtc-agent>.
 *
 * Extracted from rtc-agent.ts connectedCallback to reduce complexity and improve
 * testability. Handles persistence-driven UI refreshes for messages, sessions,
 * RTC updates, and VFS file changes.
 *
 * Module-level constants (like SESSION_STRUCTURAL_FIELDS) are defined here to
 * avoid recreation on every callback invocation (performance optimization).
 */
import { msg } from '@lit/localize';
import type {SessionStatus} from '../../../types/index.js';
import type {UIUpdateEvent} from '@rtc-agent/persistence';
import type {Logger} from '@rtc-agent/client';

// Controller type interfaces (minimal, to avoid circular imports)
interface MessageControllerLike {
    updateMessageFromBus(entityId: string): Promise<void>;
    evictSession(sessionId: string): void;
}

interface SessionControllerLike {
    value: {state: {sessions: Array<{clientId: string; title: string}>}};
}

interface SessionTabControllerLike {
    actions: {
        closeTab(sessionId: string): void;
        openOrActivate(sessionId: string, title: string, options?: {activate?: boolean}): void;
        updateTabStatus(sessionId: string, status: SessionStatus): void;
    };
}

interface SessionTreeControllerLike {
    // Reserved for future session tree updates
}

interface PersistenceLayerLike {
    getSession(clientId: string): Promise<{pending_turn_count: number; running_turn_count: number} | undefined>;
}

interface MasterLockLike {
    isMaster: boolean;
}

interface RtcProcessorLike {
    onRtcUpdate(): void;
}

/**
 * Debounced session loader to prevent multiple concurrent loadSessions calls.
 *
 * When multiple session structural changes occur in quick succession (e.g., batch imports),
 * this class ensures only one loadSessions call is made after a debounce period.
 * It also serializes in-flight requests to prevent race conditions.
 *
 * Fix 40: Prevents IndexedDB query storms and UI jitter from rapid session events.
 */
export class DebouncedSessionLoader {
    private _timer?: ReturnType<typeof setTimeout>;
    private _inflight?: Promise<void>;
    private readonly _debounceMs: number;
    private readonly _loadSessions: () => Promise<void>;

    constructor(
        loadSessions: () => Promise<void>,
        debounceMs: number = 50
    ) {
        this._loadSessions = loadSessions;
        this._debounceMs = debounceMs;
    }

    /**
     * Request a session reload. If called multiple times within the debounce period,
     * only one actual loadSessions call will be made.
     */
    request(): void {
        if (this._timer) {
            clearTimeout(this._timer);
        }
        this._timer = setTimeout(() => {
            this._timer = undefined;
            // Catch errors to prevent unhandled rejections
            this._execute().catch(() => {
                // Error is already logged by the caller or will be handled gracefully
            });
        }, this._debounceMs);
    }

    /**
     * Execute the actual loadSessions call, serializing with any in-flight request.
     */
    private async _execute(): Promise<void> {
        // Serialize: if a previous load is still in progress, wait for it
        if (this._inflight) {
            await this._inflight;
        }
        this._inflight = this._loadSessions().finally(() => {
            this._inflight = undefined;
        });
        await this._inflight;
    }

    /**
     * Clean up pending timer on dispose.
     */
    dispose(): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
    }
}

/**
 * Session fields that require a full session list reload from persistence.
 *
 * Structural changes (title, status, deleted_at, etc.) affect the session list
 * display and require re-fetching the entire list. Lightweight changes (turn counts,
 * token stats) are handled by dedicated handlers below and don't need a full reload.
 *
 * Defined at module level to avoid recreation on every UIUpdateBus callback.
 */
const SESSION_STRUCTURAL_FIELDS: ReadonlySet<string> = new Set([
    'title',
    'status',
    'deleted_at',
    'root_client_session_id',
    'created_at',
    'updated_at',
]);

/**
 * Dependencies required by the UIUpdateBus handler.
 *
 * These are injected by rtc-agent.ts when subscribing to the bus.
 * Note: `rtcProcessor` is a getter function because it may be set after the
 * bus subscription is created (during _connectWithRetry).
 */
export interface BusHandlerDeps {
    message: MessageControllerLike;
    session: SessionControllerLike;
    sessionTab: SessionTabControllerLike;
    sessionTree: SessionTreeControllerLike;
    persistence: {
        layer?: PersistenceLayerLike;
        masterLock?: MasterLockLike;
    };
    /** Getter for rtcProcessor - may be undefined initially, set after connection. */
    getRtcProcessor(): RtcProcessorLike | undefined;
    /** Debounced session loader to prevent multiple concurrent loadSessions calls. */
    sessionLoader: DebouncedSessionLoader;
    refreshTurnCounts: () => Promise<void>;
    handleFileChange: (entityId: string, field: string) => Promise<void>;
    log: Logger;
}

/**
 * Handle UIUpdateBus events and dispatch to appropriate controllers.
 *
 * This function is called for every persistence-layer change. It routes events
 * by entity type (message, session, rtc, file) and applies the appropriate
 * controller updates.
 *
 * For session events, distinguishes between structural changes (require full
 * reload) and lightweight changes (handled by dedicated handlers).
 *
 * @param event - The UIUpdateEvent from the persistence layer
 * @param deps - Controller dependencies for handling the event
 * @returns Promise<void> for message events (to enable queuing), undefined otherwise
 */
export function handleBusEvent(
    event: UIUpdateEvent,
    deps: BusHandlerDeps,
): void | Promise<void> {
    const {message, session, sessionTab, persistence, getRtcProcessor, sessionLoader, refreshTurnCounts, handleFileChange, log} = deps;

    if (event.entity === 'message') {
        // Use efficient single-message update instead of full reload.
        // Return the Promise so UIUpdateBus can queue events for the same
        // messageId, preventing race conditions where stale DB reads
        // overwrite newer state (e.g., streaming content or sync_status).
        return message.updateMessageFromBus(event.entityId);
    }

    if (event.entity === 'session') {
        handleSessionEvent(event, session, sessionTab, message, sessionLoader, refreshTurnCounts, log);
        return;
    }

    if (event.entity === 'rtc') {
        // RTC update: only Master Tab triggers RtcProcessor processing loop.
        // Skip when masterLock exists and isMaster=false.
        if (persistence.masterLock?.isMaster === false) {
            return;
        }
        getRtcProcessor()?.onRtcUpdate();
        return;
    }

    if (event.entity === 'file') {
        // VFS file change (from write/delete in other tabs).
        void handleFileChange(event.entityId, event.field ?? '');
        return;
    }
}

/**
 * Handle session-related UIUpdateBus events.
 *
 * Distinguishes between:
 * - Structural changes: require full session list reload (debounced)
 * - Status changes: sync to SessionTab (drives dot animation, tab close/reopen)
 * - Turn count changes: refresh turn count context
 */
function handleSessionEvent(
    event: UIUpdateEvent,
    session: SessionControllerLike,
    sessionTab: SessionTabControllerLike,
    message: MessageControllerLike,
    sessionLoader: DebouncedSessionLoader,
    refreshTurnCounts: () => Promise<void>,
    log: Logger,
): void {
    // Structural changes require full session list reload (debounced).
    const isStructuralChange =
        event.action === 'created' ||
        !event.field ||
        SESSION_STRUCTURAL_FIELDS.has(event.field);

    if (isStructuralChange) {
        sessionLoader.request();
    }

    // Status change -> sync to SessionTab (active/idle/closed drives dot animation).
    if (event.field === 'status') {
        handleSessionStatusChange(event, session, sessionTab, message, log);
    }

    // Turn count field changed -> push active turn count for current session into context.
    if (event.field === 'pending_turn_count' || event.field === 'running_turn_count') {
        void refreshTurnCounts();
    }
}

/**
 * Handle session status changes.
 *
 * Scenarios:
 * - Session closed (open -> closed): close the tab and evict message cache
 * - Session reopened (closed -> idle/active): create tab but don't activate
 * - Other status changes: only update status dot
 */
function handleSessionStatusChange(
    event: UIUpdateEvent,
    session: SessionControllerLike,
    sessionTab: SessionTabControllerLike,
    message: MessageControllerLike,
    log: Logger,
): void {
    const oldStatus = event.oldValue as SessionStatus | undefined;
    const newStatus = event.newValue as SessionStatus | undefined;
    const sessionId = event.entityId;

    if (!newStatus) return;

    // Scenario 1: session closed (open -> closed) -> close tab and evict message cache.
    if (newStatus === 'closed') {
        log.debug('Session closed, closing tab:', sessionId);
        sessionTab.actions.closeTab(sessionId);
        // Fix 45: Evict message cache to prevent memory leak
        message.evictSession(sessionId);
        return;
    }

    // Scenario 2: session reopened (closed -> idle/active) -> create tab but don't activate.
    if (oldStatus === 'closed' && (newStatus === 'idle' || newStatus === 'active')) {
        log.debug('Session reopened, creating tab:', sessionId);
        // Get title from session list.
        const sessionData = session.value.state.sessions.find(s => s.clientId === sessionId);
        const title = sessionData?.title || msg('未命名');
        sessionTab.actions.openOrActivate(sessionId, title, {activate: false});
        // Note: don't call switchSession, keep current activeSessionId unchanged.
        return;
    }

    // Other status changes -> only update status dot.
    sessionTab.actions.updateTabStatus(sessionId, newStatus);
}
