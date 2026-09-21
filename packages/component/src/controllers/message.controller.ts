/**
 * Message Controller
 *
 * Encapsulates message list management: send, streaming append, finalize, clear.
 * Dispatches `rtc-message-sent` event for external consumers.
 *
 * Cross-controller note: When the session switches, the root component calls
 * `reload()` on this controller to load the message history for the new session.
 *
 * Corresponds to: `messageContext` (defined in `contexts/message.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-content-area>`, `<rtc-message-list>`, `<rtc-input-area>`
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Message, MessageState, MessageActions, MessageRole, ContentData} from '../types/index.js';
import type {MessageContextValue} from '../contexts/message.js';
import type {PersistenceLayer, LocalMessage} from '@rtc-agent/persistence';
import type {SessionController} from './session.controller.js';
import type {Session} from '../types/index.js';
import {MessageRepository, MESSAGE_PAGE_SIZE} from '../repositories/index.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('MessageController');

export class MessageController implements ReactiveController {
    host: ReactiveControllerHost & EventTarget;

    /** Message repository for multi-session support. */
    private _repository?: MessageRepository;

    /** Persistence layer — injected by root component after construction. */
    private _persistence?: PersistenceLayer;

    /** Session controller — injected by root component after construction. */
    private _sessionController?: SessionController;

    /**
     * Per-session promise chain to serialize updateMessageFromBus calls.
     * Prevents race condition when multiple messages arrive concurrently from UIUpdateBus.
     * Key: sessionClientId, Value: pending promise chain for that session.
     */
    private _sessionUpdateChains = new Map<string, Promise<void>>();

    readonly actions: MessageActions;

    /** Setter for persistence injection (avoids circular deps). */
    set persistence(layer: PersistenceLayer) {
        this._persistence = layer;
        // Initialize repository when persistence is set
        if (!this._repository) {
            this._repository = new MessageRepository({
                fetchMessages: async (sessionId: string) => {
                    if (!this._persistence) return [];
                    const messages = await this._persistence.listMessages(sessionId, undefined, MESSAGE_PAGE_SIZE, 'backward');
                    // Track pagination cursors using (created_at, client_id) composite key
                    if (messages.length > 0) {
                        this._repository?.setOldestOffset(sessionId, this._buildCursor(messages[0]));
                        this._repository?.setNewestOffset(sessionId, this._buildCursor(messages[messages.length - 1]));
                    }
                    return messages.map(m => this._localMessageToUI(m));
                },
                fetchOlderMessages: async (sessionId: string, beforeCursor?: string) => {
                    if (!this._persistence) return [];
                    const messages = await this._persistence.listMessages(sessionId, beforeCursor, MESSAGE_PAGE_SIZE, 'backward');
                    // Update pagination cursor
                    if (messages.length > 0) {
                        this._repository?.setOldestOffset(sessionId, this._buildCursor(messages[0]));
                    }
                    return messages.map(m => this._localMessageToUI(m));
                },
                fetchNewerMessages: async (sessionId: string, afterCursor?: string) => {
                    if (!this._persistence) return [];
                    const messages = await this._persistence.listMessages(sessionId, afterCursor, MESSAGE_PAGE_SIZE, 'forward');
                    // Update pagination cursor
                    if (messages.length > 0) {
                        this._repository?.setNewestOffset(sessionId, this._buildCursor(messages[messages.length - 1]));
                    }
                    return messages.map(m => this._localMessageToUI(m));
                },
            });
        }
    }

    /**
     * Build pagination cursor from a message.
     * Format: "${timestamp}|${clientId}" for (created_at, client_id) composite sorting.
     */
    private _buildCursor(msg: { created_at: string; client_id: string }): string {
        const ts = new Date(msg.created_at).getTime();
        return `${ts}|${msg.client_id}`;
    }

    /**
     * Build pagination cursor from a UI Message.
     *
     * UI Message.timestamp = new Date(created_at).getTime(), which is the same
     * numeric value that _buildCursor produces from LocalMessage.created_at.
     * So "${msg.timestamp}|${msg.clientId}" produces an identical cursor string.
     */
    private _buildCursorFromUI(msg: Message): string {
        return `${msg.timestamp}|${msg.clientId}`;
    }

    /** Get the message repository for multi-session support. */
    get repository(): MessageRepository {
        if (!this._repository) {
            throw new Error('[MessageController] Repository not initialized. Set persistence first.');
        }
        return this._repository;
    }

    /** Setter for session controller injection (avoids circular deps). */
    set sessionController(controller: SessionController) {
        this._sessionController = controller;
    }

    get value(): MessageContextValue {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        // Derive state from repository (single source of truth), return shallow copy to prevent external mutation
        const source = currentSessionId && this._repository
            ? this._repository.getSessionState(currentSessionId)
            : {messages: [], hasMore: false, isLoadingMore: false};
        const state: MessageState = {
            messages: [...source.messages],
            hasMore: source.hasMore,
            isLoadingMore: source.isLoadingMore,
            hasMoreNewer: source.hasMoreNewer,
            isLoadingNewer: source.isLoadingNewer,
        };

        return {
            state,
            actions: this.actions,
            getUserMessageHistory: (sessionId: string, limit?: number) =>
                this.getUserMessageHistory(sessionId, limit),
        };
    }

    constructor(host: ReactiveControllerHost & EventTarget) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            sendMessage: async (content: ContentData) => { await this._sendMessage(content); },
            resendMessage: async (messageClientId: string, content: ContentData) => {
                await this._resendMessage(messageClientId, content);
            },
            forkSession: async (params) => { await this._forkSession(params); },
            appendToLastMessage: (chunk: string) =>
                this._appendToLastMessage(chunk),
            finalizeLastMessage: () => this._finalizeLastMessage(),
            clearMessages: () => this._clearMessages(),
        };
    }

    hostConnected() {}
    hostDisconnected() {
        // Clear pending update chains to prevent stale promises from referencing
        // disconnected host. Without this, in-flight UIUpdateBus updates for
        // sessions that were evicted could still call host.requestUpdate().
        this._sessionUpdateChains.clear();
    }

    /**
     * Add a mock assistant message (demo page only).
     *
     * **Note**: This method is NOT part of `MessageActions` and is not exposed
     * via Context. In a real environment, assistant messages are injected by the
     * protocol layer via `sendMessage` or a dedicated method.
     */
    addDemoAssistantMessage(content: string) {
        const msg: Message = {
            clientId: `msg-${Date.now()}-assistant`,
            role: 'assistant',
            content: {type: 'text', data: content},
            timestamp: Date.now(),
            syncStatus: 'synced',
        };

        // Update repository for the current session
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (this._repository && currentSessionId) {
            this._repository.appendMessage(currentSessionId, msg);
        }

        this.host.requestUpdate();
    }

    /**
     * Fetch initial messages for a session (if repository doesn't have data yet).
     * Called by rtc-message-list in willUpdate.
     */
    async fetchInitialMessages(sessionId: string): Promise<void> {
        if (!this._repository) return;

        const state = this._repository.getSessionState(sessionId);
        if (state.messages.length === 0) {
            await this._repository.fetchMessages(sessionId);
        }
        this.host.requestUpdate();
    }

    /**
     * Load more messages for a specific session (backward pagination).
     * Called by rtc-message-list when user scrolls to top.
     */
    async loadMoreForSession(sessionId: string): Promise<void> {
        if (!this._repository) return;
        await this._repository.loadMore(sessionId);
        this.host.requestUpdate();
    }

    /**
     * Load newer messages for a session (forward pagination).
     * Called by rtc-message-list when virtual scroll needs to load newer messages.
     */
    async loadNewerForSession(sessionId: string): Promise<void> {
        if (!this._repository) return;
        await this._repository.loadNewer(sessionId);
        this.host.requestUpdate();
    }

    /**
     * Evict a session from the repository cache.
     * Called when a tab is closed to free memory.
     */
    evictSession(sessionId: string): void {
        this._repository?.evictSession(sessionId);
    }

    /**
     * Update a single message field from UIUpdateBus event.
     * More efficient than reload() for streaming updates.
     *
     * Handles both existing messages (patch) and new messages (append).
     *
     * Uses per-session promise chain to serialize updates and prevent race conditions
     * when multiple messages arrive concurrently from UIUpdateBus.
     *
     * @param entityId - Message client ID
     */
    async updateMessageFromBus(entityId: string): Promise<void> {
        if (!this._persistence || !this._repository) return;

        // Get the message from DB to find its session (read-only, no race)
        const localMsg = await this._persistence.getMessage(entityId);
        if (!localMsg) {
            log.debug(`message not found in DB: ${entityId}`);
            return;
        }

        const messageSessionId = localMsg.session_client_id;
        if (!messageSessionId) {
            log.debug(`message has no session_client_id: ${entityId}`);
            return;
        }


        // Serialize the read-modify-write part per session to prevent race conditions.
        // Multiple concurrent calls for the same session must not interleave.
        const prev = this._sessionUpdateChains.get(messageSessionId) ?? Promise.resolve();
        const next = prev.then(
            () => {
                this._applyBusUpdate(messageSessionId, entityId, localMsg);
            },
            () => {
                this._applyBusUpdate(messageSessionId, entityId, localMsg);
            }
        );
        this._sessionUpdateChains.set(messageSessionId, next);

        // Clean up the chain when it settles
        next.finally(() => {
            if (this._sessionUpdateChains.get(messageSessionId) === next) {
                this._sessionUpdateChains.delete(messageSessionId);
            }
        });

        return next;
    }

    /**
     * Apply a single UIUpdateBus update to repository and legacy state.
     * Called within the per-session promise chain to ensure serialization.
     */
    private _applyBusUpdate(messageSessionId: string, entityId: string, localMsg: LocalMessage): void {
        if (!this._repository) return;

        const newMsg = this._localMessageToUI(localMsg);
        this._upsertMessage(messageSessionId, entityId, newMsg);
        this.host.requestUpdate();
    }

    /**
     * Reload messages from persistence. Public method for UIUpdateBus / root wiring.
     *
     * - With entityId: immutable single-message update (replace matching clientId).
     * - Without entityId: full reload for the current session (from SessionController).
     */
    async reload(entityId?: string) {
        if (!this._persistence) return;

        if (entityId) {
            const localMsg = await this._persistence.getMessage(entityId);
            if (localMsg) {
                const messageSessionId = localMsg.session_client_id;
                if (messageSessionId) {
                    const newMsg = this._localMessageToUI(localMsg);
                    this._upsertMessage(messageSessionId, entityId, newMsg);
                    this.host.requestUpdate();
                }
            }
        } else {
            const currentSessionId =
                this._sessionController?.value.state.currentSessionId;
            if (currentSessionId) {
                await this._reloadFromDB(currentSessionId);
            }
        }
    }

    /**
     * Upsert a single message into the repository.
     *
     * Shared by `reload(entityId)` and `_applyBusUpdate()` to eliminate duplication.
     * Repository is updated via patchMessage (O(1) for existing messages) with fallback
     * to append+sort for new messages.
     */
    private _upsertMessage(sessionId: string, messageId: string, newMsg: Message): void {
        // Update repository state for this message's session.
        // Supports multi-instance: repository tracks all active sessions,
        // not just the currently visible one.
        if (this._repository) {
            const patched = this._repository.patchMessage(sessionId, messageId, () => newMsg);
            if (!patched) {
                const current = this._repository.getSessionState(sessionId);
                const messages = [...current.messages, newMsg].sort((a, b) => {
                    const tsDiff = a.timestamp - b.timestamp;
                    if (tsDiff !== 0) return tsDiff;
                    return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
                });
                this._repository.updateMessages(sessionId, messages);
            }
        }
    }

    private async _sendMessage(content: ContentData) {
        if (!this._persistence) {
            log.error('persistence not set');
            return;
        }

        const messageClientId = crypto.randomUUID();

        // Determine session: use current session if set, otherwise create a new one.
        let sessionClientId: string;
        if (this._sessionController) {
            const currentSessionId =
                this._sessionController.value.state.currentSessionId;
            log.debug('currentSessionId before:', currentSessionId);
            sessionClientId = currentSessionId ?? crypto.randomUUID();
            log.debug('sessionClientId to use:', sessionClientId, currentSessionId ? '(existing)' : '(NEW)');
        } else {
            sessionClientId = crypto.randomUUID();
            log.debug('No sessionController, created new sessionClientId:', sessionClientId);
        }

        // Write to persistence (local-first + background sync).
        const result = await this._persistence.sendMessage({
            content,
            messageClientId,
            sessionClientId,
        });
        log.debug('persistence.sendMessage returned:', {
            sessionClientId: result.session.client_id,
            messageSessionClientId: result.message.session_client_id,
        });

        // Update session in SessionController (upsert + select).
        // Only update if the user hasn't moved to a different session in the meantime.
        if (this._sessionController) {
            const currentSessionId =
                this._sessionController.value.state.currentSessionId;
            log.debug('currentSessionId after persistence:', currentSessionId, 'result.session.client_id:', result.session.client_id);
            // Only set if: no current session, or current session matches what we're updating
            if (!currentSessionId || currentSessionId === result.session.client_id) {
                const uiSession: Session = {
                    clientId: result.session.client_id,
                    title: result.session.title || '',
                    createdAt: new Date(result.session.created_at).getTime(),
                    updatedAt: new Date(result.session.updated_at).getTime(),
                    todoList: result.session.todo_list,
                };
                log.debug('setCurrentSession:', uiSession.clientId, 'title:', `"${uiSession.title}"`);
                this._sessionController.actions.setCurrentSession(uiSession);

                // Reload messages from DB to reflect the just-written message.
                await this._reloadFromDB(result.session.client_id);
                log.debug('_reloadFromDB completed');
            }
        }

        // Notify external listeners.
        this.host.dispatchEvent(
            new CustomEvent('rtc-message-sent', {
                bubbles: true,
                composed: true,
                detail: {message: result.message},
            })
        );
    }

    /**
     * Re-send a failed message (preserves original client_id for idempotent retry).
     */
    private async _resendMessage(messageClientId: string, content: ContentData) {
        if (!this._persistence) {
            log.error('persistence not set');
            return;
        }

        // Must use current session (resend always happens within an existing session)
        const sessionClientId = this._sessionController?.value.state.currentSessionId;
        if (!sessionClientId) {
            log.error('cannot resend: no current session');
            return;
        }

        // Re-use the same messageClientId when calling persistence (idempotent retry)
        const result = await this._persistence.sendMessage({
            content,
            messageClientId,
            sessionClientId,
        });

        // Reload message list to reflect the state change
        await this._reloadFromDB(sessionClientId);

        // Notify external listeners.
        this.host.dispatchEvent(
            new CustomEvent('rtc-message-sent', {
                bubbles: true,
                composed: true,
                detail: {message: result.message},
            })
        );
    }

    /**
     * Fork a conversation: create a new session based on an existing message.
     *
     * Note: After forking, setCurrentSession must be called to add the new
     * session to the sessions list, otherwise _ensureTabForSession cannot
     * immediately locate the session to fetch its real title.
     */
    private async _forkSession(params: {
        oldSessionClientId: string;
        oldMessageClientId: string;
        newSessionClientId: string;
        newMessageClientId: string;
        content: ContentData;
        limit?: number;
    }) {
        if (!this._persistence) {
            log.error('persistence not set');
            return;
        }


        // Call persistence layer's forkSession
        const result = await this._persistence.forkSession({
            oldSessionClientId: params.oldSessionClientId,
            oldMessageClientId: params.oldMessageClientId,
            newSessionClientId: params.newSessionClientId,
            newMessageClientId: params.newMessageClientId,
            content: params.content,
            limit: params.limit,
        });


        // Add new session to sessions list and set as currentSession
        // (consistent with _sendMessage, so _ensureTabForSession can locate it immediately)
        if (this._sessionController) {
            const uiSession: Session = {
                clientId: result.session.client_id,
                title: result.session.title || '',
                createdAt: new Date(result.session.created_at).getTime(),
                updatedAt: new Date(result.session.updated_at).getTime(),
                todoList: result.session.todo_list,
            };
            this._sessionController.actions.setCurrentSession(uiSession);
        }

        // Reload the new session's message list
        await this._reloadFromDB(result.session.client_id);


        // Notify external listeners
        this.host.dispatchEvent(
            new CustomEvent('rtc-message-sent', {
                bubbles: true,
                composed: true,
                detail: {message: result.message},
            })
        );
    }

    private async _reloadFromDB(sessionClientId: string) {
        if (!this._persistence) return;

        const existing = this._repository?.getSessionState(sessionClientId);
        const existingMessages = existing?.messages ?? [];

        // Load the latest messages (backward = from newest)
        const localMessages = await this._persistence.listMessages(
            sessionClientId, undefined, MESSAGE_PAGE_SIZE, 'backward'
        );
        const freshMessages = localMessages.map((m) => this._localMessageToUI(m));

        // Merge: preserve existing messages not in fresh batch
        const merged = this._mergeMessages(existingMessages, freshMessages);

        // ── Cursor logic (critical fix) ──
        //
        // Cursor must point to the oldest/newest message in the MERGED array,
        // not the fresh batch from DB. Otherwise loadMore will use a wrong cursor
        // and return duplicate messages.
        //
        // Example:
        //   existing = [msg1..msg69], fresh = [msg20..msg69] (DB's latest 50)
        //   merged = [msg1..msg69]
        //   ❌ old: oldestCursor = cursor(msg20) → loadMore returns msg1..msg19 → duplicates!
        //   ✅ new: oldestCursor = cursor(msg1)  → loadMore requests before msg1 → no duplicates

        if (merged.length > 0) {
            const oldestInMerged = merged[0];
            const newestInMerged = merged[merged.length - 1];

            // hasMore logic:
            // - If merged[0] came from existing (preserved older loaded messages),
            //   inherit existing.hasMore (that question was already answered)
            // - If merged[0] came from fresh (no older messages preserved),
            //   use standard check: did DB return a full page?
            const freshClientIds = new Set(freshMessages.map(m => m.clientId));
            const hasMore = freshClientIds.has(oldestInMerged.clientId)
                ? (localMessages.length >= MESSAGE_PAGE_SIZE)
                : (existing?.hasMore ?? (localMessages.length >= MESSAGE_PAGE_SIZE));

            if (this._repository) {
                this._repository.updateMessages(sessionClientId, merged);
                this._repository.setHasMore(sessionClientId, hasMore);
                this._repository.setOldestOffset(
                    sessionClientId,
                    this._buildCursorFromUI(oldestInMerged)
                );
                this._repository.setNewestOffset(
                    sessionClientId,
                    this._buildCursorFromUI(newestInMerged)
                );
            }
        } else {
            // Merged is empty (both existing and fresh are empty)
            if (this._repository) {
                this._repository.updateMessages(sessionClientId, []);
                this._repository.setHasMore(sessionClientId, false);
            }
        }

        this.host.requestUpdate();
    }

    /**
     * Merge existing messages with freshly fetched messages.
     *
     * Strategy: Pure clientId deduplication.
     * - Put existing first, then overwrite with fresh for same clientId (fresh is newer version)
     * - Sort by (timestamp, clientId) composite key, matching persistence layer sorting
     *
     * Why not timestamp-based partitioning?
     * - Timestamps are not unique (multiple messages can be created in the same millisecond)
     * - clientId is the unique business identifier, deduplication by it is unambiguous
     */
    private _mergeMessages(existing: Message[], fresh: Message[]): Message[] {
        const map = new Map<string, Message>();
        for (const msg of existing) map.set(msg.clientId, msg);
        for (const msg of fresh) map.set(msg.clientId, msg); // fresh overwrites existing
        // Composite sort (timestamp, clientId) to match persistence layer (entity-repository.ts)
        // Sorting by timestamp alone is non-deterministic when timestamps are equal
        // (e.g., toolcall_input/output pairs created in the same millisecond)
        return [...map.values()].sort((a, b) => {
            const tsDiff = a.timestamp - b.timestamp;
            if (tsDiff !== 0) return tsDiff;
            return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
        });
    }

    /**
     * Get user message history for the current session (used for up/down arrow navigation in input).
     *
     * Returns an array of plain text content in reverse chronological order (newest first).
     * Queried via PersistenceLayer.
     */
    async getUserMessageHistory(sessionId: string, limit = 200): Promise<string[]> {
        if (!this._persistence) return [];

        try {
            const messages = await this._persistence.listMessages(
                sessionId, undefined, limit, 'backward'
            );

            return messages
                .filter(m => m.role === 'user' && m.content)
                .reverse()
                .map(m => this._extractTextFromContent(m.content));
        } catch (error) {
            log.warn('getUserMessageHistory failed:', error);
            return [];
        }
    }

    /**
     * Extract plain text from a message's content field.
     *
     * Content storage formats:
     * - Current format (post-fix): full ContentData JSON, e.g. '{"type":"user_message","data":{"text":"..."}}'
     * - Legacy format (historical data): plain text string or object with data only, e.g. '{"text":"..."}'
     * - Plain text: returned as-is
     */
    private _extractTextFromContent(content: string | undefined): string {
        if (!content) return '';
        try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object') {
                // Current format: full ContentData (contains type field)
                if ('type' in parsed) {
                    if (parsed.type === 'text' || parsed.type === 'markdown' || parsed.type === 'thinking') {
                        return parsed.data ?? '';
                    } else if (parsed.type === 'user_message') {
                        // user_message type: extract from data.text
                        return parsed.data?.text ?? '';
                    }
                } else {
                    // Legacy format: no type field, attempt to extract from known fields
                    // Compatible with historical user_message data: {"text":"...","scenarios":[...]}
                    if ('text' in parsed && typeof parsed.text === 'string') {
                        return parsed.text;
                    }
                }
            }
        } catch {
            // Not JSON — treat as plain text
        }
        return content;
    }

    private _localMessageToUI(local: LocalMessage): Message {
        // local.content is a JSON string of ContentData from the DB — parse it
        let contentData: ContentData = {type: 'text', data: ''};
        if (local.content) {
            try {
                const parsed = JSON.parse(local.content);
                if (parsed && typeof parsed === 'object' && 'type' in parsed) {
                    contentData = parsed as ContentData;
                } else {
                    // Fallback: treat raw string as text data
                    contentData = {type: 'text', data: local.content};
                }
            } catch {
                // Not valid JSON — use as plain text
                contentData = {type: 'text', data: local.content};
            }
        }
        return {
            clientId: local.client_id,
            role: local.role as MessageRole,
            content: contentData,
            timestamp: new Date(local.created_at).getTime(),
            streaming: local.streaming_status === 'streaming',
            syncStatus: local.sync_status,
            parentClientId: local.parent_client_id,
        };
    }

    private _appendToLastMessage(chunk: string) {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (!this._repository || !currentSessionId) return;

        const state = this._repository.getSessionState(currentSessionId);
        const lastMsg = state.messages[state.messages.length - 1];
        if (!lastMsg) return;

        // Append chunk to the ContentData's data field (text type uses string data)
        const newData = typeof lastMsg.content.data === 'string'
            ? (lastMsg.content.data as string) + chunk
            : JSON.stringify(lastMsg.content.data) + chunk;

        this._repository.patchMessage(currentSessionId, lastMsg.clientId, (msg) => ({
            ...msg,
            content: {...msg.content, data: newData},
            streaming: true,
        }));

        this.host.requestUpdate();
    }

    private _finalizeLastMessage() {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (!this._repository || !currentSessionId) return;

        const state = this._repository.getSessionState(currentSessionId);
        const lastMsg = state.messages[state.messages.length - 1];
        if (!lastMsg) return;

        this._repository.patchMessage(currentSessionId, lastMsg.clientId, (msg) => ({
            ...msg,
            streaming: false,
        }));

        this.host.requestUpdate();
    }

    private _clearMessages() {
        // Reset repository state for the current session.
        // Must clear hasMore and cursors alongside the messages array to prevent
        // stale pagination state from triggering loadMore on an empty session.
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (this._repository && currentSessionId) {
            this._repository.updateMessages(currentSessionId, []);
            this._repository.setHasMore(currentSessionId, false);
            this._repository.setHasMoreNewer(currentSessionId, false);
            // Clear residual cursors to maintain state consistency
            this._repository.setOldestOffset(currentSessionId, '');
            this._repository.setNewestOffset(currentSessionId, '');
        }

        this.host.requestUpdate();
    }
}
