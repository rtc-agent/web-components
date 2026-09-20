/**
 * Message Repository
 *
 * Manages per-session message data with a publish-subscribe pattern.
 * Each session maintains its own `messages`, `hasMore`, and `isLoadingMore` state.
 *
 * Key responsibilities:
 * - Per-session data isolation: each session's state is independent
 * - Subscription mechanism: multiple subscribers can watch the same session
 * - API encapsulation: wraps fetchMessages and fetchOlderMessages calls
 * - Immutability: all updates produce new arrays/objects
 *
 * Concurrency note: concurrent `loadMore` calls for the same session are
 * de-duplicated via the `isLoadingMore` flag — only one request is in-flight
 * at a time per session.
 */

import type {Message, MessageState} from '../types/index.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('MessageRepository');

/**
 * API contract for message fetching.
 *
 * Implementations can wrap REST calls, WebSocket queries, or persistence layer.
 *
 * Cursor format: "${timestamp}|${clientId}" for (created_at, client_id) composite pagination.
 */
export interface MessageApi {
    /** Fetch the latest messages for a session (initial load). */
    fetchMessages(sessionId: string): Promise<Message[]>;

    /** Fetch older messages before a given cursor (backward pagination). */
    fetchOlderMessages(sessionId: string, beforeCursor?: string): Promise<Message[]>;

    /** Fetch newer messages after a given cursor (forward pagination). */
    fetchNewerMessages(sessionId: string, afterCursor?: string): Promise<Message[]>;
}

/** Callback signature for session data subscriptions. */
export type SessionDataCallback = (data: MessageState) => void;

/** Page size for backward pagination. */
const PAGE_SIZE = 50;

/** Default session state for uninitialized sessions. */
const DEFAULT_STATE: MessageState = {
    messages: [],
    hasMore: false,
    isLoadingMore: false,
    hasMoreNewer: false,
    isLoadingNewer: false,
};

export class MessageRepository {
    /** Per-session message state. */
    private _sessions = new Map<string, MessageState>();

    /** Per-session subscriber sets. */
    private _subscribers = new Map<string, Set<SessionDataCallback>>();

    /** Tracks sessions with an in-flight loadMore (backward) request. */
    private _loadingSessions = new Set<string>();

    /** Tracks sessions with an in-flight loadNewer (forward) request. */
    private _loadingNewerSessions = new Set<string>();

    /** Per-session oldest loaded cursor for backward pagination. Format: "${timestamp}|${clientId}" */
    private _oldestCursors = new Map<string, string>();

    /** Per-session newest loaded cursor for forward pagination. Format: "${timestamp}|${clientId}" */
    private _newestCursors = new Map<string, string>();

    constructor(private readonly _api: MessageApi) {}

    // ── Subscription ──

    /**
     * Subscribe to data changes for a session.
     *
     * The callback is invoked immediately with the current state (if any),
     * and again whenever the state changes. Returns an unsubscribe function.
     */
    subscribe(sessionId: string, callback: SessionDataCallback): () => void {
        let subs = this._subscribers.get(sessionId);
        if (!subs) {
            subs = new Set();
            this._subscribers.set(sessionId, subs);
        }
        subs.add(callback);

        // Immediately notify with current state (errors are caught to prevent
        // breaking the subscribe call or other subscribers).
        try {
            callback(this._getState(sessionId));
        } catch (error) {
            log.error(
                `subscriber callback error for session ${sessionId}:`,
                error,
            );
        }

        return () => {
            const s = this._subscribers.get(sessionId);
            if (s) {
                s.delete(callback);
                if (s.size === 0) {
                    this._subscribers.delete(sessionId);
                }
            }
        };
    }

    // ── State access ──

    /**
     * Get the current state for a session.
     *
     * Returns a default empty state if the session has not been initialized.
     */
    getSessionState(sessionId: string): MessageState {
        return this._getState(sessionId);
    }

    // ── Mutation ──

    /**
     * Replace all messages for a session.
     *
     * Typically called when new data arrives from WebSocket or initial API load.
     * Notifies all subscribers of the change.
     */
    updateMessages(sessionId: string, messages: Message[]): void {
        const current = this._getState(sessionId);
        this._setState(sessionId, {
            ...current,
            messages: [...messages],
        });
    }

    /**
     * Append a single message to a session's message list.
     *
     * Creates a new messages array to preserve immutability of prior state.
     * Notifies all subscribers.
     */
    appendMessage(sessionId: string, message: Message): void {
        const current = this._getState(sessionId);
        this._setState(sessionId, {
            ...current,
            messages: [...current.messages, message],
        });
    }

    /**
     * Update a single message in place using an updater function.
     *
     * More efficient than updateMessages() for single-message changes (e.g., streaming).
     * Only the specified message is replaced in the array, avoiding full array copies.
     *
     * @param sessionId - Session ID
     * @param messageId - Message client ID to update
     * @param updater - Function that receives the current message and returns the updated message
     * @returns true if the message was found and updated, false otherwise
     */
    patchMessage(
        sessionId: string,
        messageId: string,
        updater: (msg: Message) => Message
    ): boolean {
        const current = this._getState(sessionId);
        const index = current.messages.findIndex(m => m.clientId === messageId);
        if (index === -1) return false;

        let updatedMessage: Message;
        try {
            updatedMessage = updater(current.messages[index]);
        } catch (error) {
            log.error(
                `patchMessage updater threw for session=${sessionId}, messageId=${messageId}:`,
                error,
            );
            return false;
        }

        const newMessages = [...current.messages];
        newMessages[index] = updatedMessage;

        this._setState(sessionId, {
            ...current,
            messages: newMessages,
        });
        return true;
    }

    /**
     * Load older messages for a session (backward pagination).
     *
     * Concurrent calls for the same session are de-duplicated: if a load is
     * already in-flight, subsequent calls return the existing promise.
     * On failure, `isLoadingMore` is reset to false.
     *
     * @returns the full message list after prepending older messages,
     *          or the current list if load was skipped (no hasMore / already loading).
     */
    async loadMore(sessionId: string): Promise<Message[]> {
        const current = this._getState(sessionId);

        log.debug(
            `loadMore(${sessionId}) called: hasMore=${current.hasMore}, ` +
            `isLoading=${this._loadingSessions.has(sessionId)}, cachedMessages=${current.messages.length}`
        );

        // Nothing to load
        if (!current.hasMore) {
            log.debug(`loadMore(${sessionId}): early return - hasMore=false`);
            return current.messages;
        }

        // Already loading — return current state
        if (this._loadingSessions.has(sessionId)) {
            log.debug(`loadMore(${sessionId}): early return - already loading`);
            return current.messages;
        }

        const oldestCursor = this._oldestCursors.get(sessionId);

        log.debug(
            `loadMore(${sessionId}): oldestCursor=${oldestCursor ?? 'none'}`
        );

        // Mark loading
        this._loadingSessions.add(sessionId);
        this._setState(sessionId, {...current, isLoadingMore: true});

        try {
            const olderMessages = await this._api.fetchOlderMessages(
                sessionId,
                oldestCursor,
            );

            const beforeState = this._getState(sessionId);
            const allMessages = [...olderMessages, ...beforeState.messages];
            const hasMore = olderMessages.length >= PAGE_SIZE;

            this._setState(sessionId, {
                messages: allMessages,
                hasMore,
                isLoadingMore: false,
            });

            return allMessages;
        } catch (error) {
            log.error(`loadMore(${sessionId}) failed:`, error);

            // Reset loading state on failure
            const failedState = this._getState(sessionId);
            this._setState(sessionId, {...failedState, isLoadingMore: false});

            return this._getState(sessionId).messages;
        } finally {
            this._loadingSessions.delete(sessionId);
        }
    }

    /**
     * Load newer messages for a session (forward pagination).
     *
     * Concurrent calls for the same session are de-duplicated: if a load is
     * already in-flight, subsequent calls return the existing promise.
     * On failure, `isLoadingNewer` is reset to false.
     *
     * @returns the full message list after appending newer messages,
     *          or the current list if load was skipped (no hasMoreNewer / already loading).
     */
    async loadNewer(sessionId: string): Promise<Message[]> {
        const current = this._getState(sessionId);

        // Nothing to load
        if (!current.hasMoreNewer) return current.messages;

        // Already loading — return current state
        if (this._loadingNewerSessions.has(sessionId)) return current.messages;

        const newestCursor = this._newestCursors.get(sessionId);

        // Mark loading
        this._loadingNewerSessions.add(sessionId);
        this._setState(sessionId, {...current, isLoadingNewer: true});

        try {
            const newerMessages = await this._api.fetchNewerMessages(
                sessionId,
                newestCursor,
            );

            const beforeState = this._getState(sessionId);
            const allMessages = [...beforeState.messages, ...newerMessages];
            const hasMoreNewer = newerMessages.length >= PAGE_SIZE;

            this._setState(sessionId, {
                messages: allMessages,
                hasMore: beforeState.hasMore,
                isLoadingMore: beforeState.isLoadingMore,
                hasMoreNewer,
                isLoadingNewer: false,
            });

            return allMessages;
        } catch (error) {
            log.error(`loadNewer(${sessionId}) failed:`, error);

            // Reset loading state on failure
            const failedState = this._getState(sessionId);
            this._setState(sessionId, {...failedState, isLoadingNewer: false});

            return this._getState(sessionId).messages;
        } finally {
            this._loadingNewerSessions.delete(sessionId);
        }
    }

    /**
     * Fetch messages for a session (initial load).
     *
     * Sets `hasMore` based on whether the API returned PAGE_SIZE messages.
     * Returns the fetched messages.
     */
    async fetchMessages(sessionId: string): Promise<Message[]> {
        const messages = await this._api.fetchMessages(sessionId);
        const hasMore = messages.length >= PAGE_SIZE;

        this._setState(sessionId, {
            messages: [...messages],
            hasMore,
            isLoadingMore: false,
        });

        return messages;
    }

    /**
     * Evict a session: clear its data and remove all subscribers.
     *
     * Called when a tab is closed or a session should no longer be tracked.
     * After eviction, getSessionState returns the default empty state.
     */
    evictSession(sessionId: string): void {
        this._sessions.delete(sessionId);
        this._subscribers.delete(sessionId);
        this._loadingSessions.delete(sessionId);
        this._loadingNewerSessions.delete(sessionId);
        this._oldestCursors.delete(sessionId);
        this._newestCursors.delete(sessionId);
    }

    // ── Setters for pagination tracking (used by controller integration) ──

    /**
     * Set the hasMore flag for a session.
     *
     * This is used by the controller layer to sync pagination state after
     * operations like _reloadFromDB that calculate hasMore independently.
     * Without this, updateMessages only replaces the messages array but
     * keeps the existing hasMore value (which may be the DEFAULT_STATE's false).
     */
    setHasMore(sessionId: string, value: boolean): void {
        const current = this._getState(sessionId);
        this._setState(sessionId, {...current, hasMore: value});
    }

    /**
     * Set the hasMoreNewer flag for a session.
     *
     * This is used to indicate whether there are newer messages available
     * in the database for forward pagination.
     */
    setHasMoreNewer(sessionId: string, value: boolean): void {
        const current = this._getState(sessionId);
        this._setState(sessionId, {...current, hasMoreNewer: value});
    }

    /**
     * Set the oldest loaded cursor for a session.
     * Cursor format: "${timestamp}|${clientId}" for (created_at, client_id) composite pagination.
     *
     * This is used by the controller layer to track the backward pagination cursor.
     * Called after initial load or loadMore completes.
     */
    setOldestOffset(sessionId: string, cursor: string): void {
        this._oldestCursors.set(sessionId, cursor);
    }

    /**
     * Get the oldest loaded cursor for a session.
     */
    getOldestOffset(sessionId: string): string | undefined {
        return this._oldestCursors.get(sessionId);
    }

    /**
     * Set the newest loaded cursor for a session.
     * Cursor format: "${timestamp}|${clientId}" for (created_at, client_id) composite pagination.
     *
     * This is used by the controller layer to track the forward pagination cursor.
     * Called after initial load or loadNewer completes.
     */
    setNewestOffset(sessionId: string, cursor: string): void {
        this._newestCursors.set(sessionId, cursor);
    }

    /**
     * Get the newest loaded cursor for a session.
     */
    getNewestOffset(sessionId: string): string | undefined {
        return this._newestCursors.get(sessionId);
    }

    // ── Private helpers ──

    /**
     * Get the state for a session, returning a default if not initialized.
     * Always returns a new object to prevent external mutation.
     */
    private _getState(sessionId: string): MessageState {
        return this._sessions.get(sessionId) ?? {...DEFAULT_STATE};
    }

    /**
     * Set the state for a session and notify all subscribers.
     * Stores a shallow copy to maintain immutability.
     */
    private _setState(sessionId: string, state: MessageState): void {
        this._sessions.set(sessionId, {...state});
        this._notifySubscribers(sessionId);
    }

    /**
     * Notify all subscribers for a session with the current state.
     */
    private _notifySubscribers(sessionId: string): void {
        const subs = this._subscribers.get(sessionId);
        if (!subs || subs.size === 0) return;

        const state = this._getState(sessionId);
        for (const callback of subs) {
            try {
                callback(state);
            } catch (error) {
                log.error(
                    `subscriber callback error for session ${sessionId}:`,
                    error,
                );
            }
        }
    }
}
