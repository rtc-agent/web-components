/**
 * Message Controller
 *
 * Encapsulates message list management: send, streaming append, finalize, clear.
 * Dispatches `rtc-message-sent` event for external consumers.
 *
 * Architecture: This controller holds a MessageRepository instance for per-session
 * message state management. The repository handles caching, pagination, and
 * subscriptions. The controller coordinates between persistence layer, session
 * controller, and repository.
 *
 * Cross-controller note: When the session switches, the root component calls
 * `reloadForSession()` on this controller to load the message history for the
 * new session. Single-message updates (e.g. streaming status change) go through
 * `updateMessage()`.
 *
 * Corresponds to: `messageContext` (defined in `contexts/message.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-content-area>`, `<rtc-message-list>`, `<rtc-input-area>`
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Message, MessageActions, MessageRole, ContentData} from '../types/index.js';
import type {MessageContextValue} from '../contexts/message.js';
import type {PersistenceLayer, LocalMessage} from '@rtc-agent/persistence';
import type {SessionController} from './session.controller.js';
import type {Session} from '../types/index.js';
import {MessageRepository} from '../repositories/message.repository.js';

export class MessageController implements ReactiveController {
    host: ReactiveControllerHost & EventTarget;

    /** Message repository for per-session state management. */
    private _repository?: MessageRepository;

    /** Persistence layer — injected by root component after construction. */
    private _persistence?: PersistenceLayer;

    /** Session controller — injected by root component after construction. */
    private _sessionController?: SessionController;

    readonly actions: MessageActions;

    /** Expose repository for view layer subscription. */
    get repository(): MessageRepository {
        if (!this._repository) {
            throw new Error('[MessageController] repository not initialized. Set persistence first.');
        }
        return this._repository;
    }

    /** Setter for persistence injection (avoids circular deps). */
    set persistence(layer: PersistenceLayer) {
        this._persistence = layer;
        // Initialize repository with persistence-backed fetch callbacks.
        // The mapping `local -> UI` lives here so the repository stays persistence-agnostic.
        // The closure captures `this`, so `this._repository` is set by the time the
        // callbacks run (fetchMessages is only invoked after persistence assignment).
        if (!this._repository) {
            this._repository = new MessageRepository({
                fetchMessages: async (sessionId: string) => {
                    const messages = await layer.listMessages(sessionId, undefined, 50, 'backward');
                    // Track oldest offset inside the same persistence round-trip
                    if (messages.length > 0 && messages[0].global_offset !== undefined) {
                        this._repository?.setOldestOffset(sessionId, messages[0].global_offset);
                    }
                    return messages.map(m => this._localMessageToUI(m));
                },
                fetchOlderMessages: async (sessionId: string, beforeOffset?: number) => {
                    const messages = await layer.listMessages(sessionId, beforeOffset, 50, 'backward');
                    // Update oldest offset on each pagination page
                    if (messages.length > 0 && messages[0].global_offset !== undefined) {
                        this._repository?.setOldestOffset(sessionId, messages[0].global_offset);
                    }
                    return messages.map(m => this._localMessageToUI(m));
                },
            });
        }
    }

    /** Setter for session controller injection (avoids circular deps). */
    set sessionController(controller: SessionController) {
        this._sessionController = controller;
    }

    get value(): MessageContextValue {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        const state = currentSessionId && this._repository
            ? this._repository.getSessionState(currentSessionId)
            : {messages: [], hasMore: false, isLoadingMore: false};

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
            loadMore: async () => { await this.loadMore(); },
        };
    }

    hostConnected() {}
    hostDisconnected() {}

    /**
     * Add a mock assistant message (demo page only).
     *
     * **Note**: This method is NOT part of `MessageActions` and is not exposed
     * via Context. In a real environment, assistant messages are injected by the
     * protocol layer via `sendMessage` or a dedicated method.
     */
    addDemoAssistantMessage(content: string) {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (!currentSessionId || !this._repository) return;

        const msg: Message = {
            clientId: `msg-${Date.now()}-assistant`,
            role: 'assistant',
            content: {type: 'text', data: content},
            timestamp: Date.now(),
            syncStatus: 'synced',
        };
        this._repository.appendMessage(currentSessionId, msg);
        this.host.requestUpdate();
    }

    /**
     * Reload messages for a specific session (session switch).
     *
     * Called by the root component when the current session changes. If the
     * repository already holds messages for the session this is a no-op
     * (just triggers a host update). Otherwise it loads the initial page from
     * persistence, which sets `hasMore` / `isLoadingMore` via the repository.
     */
    async reloadForSession(sessionId?: string): Promise<void> {
        if (!this._repository) return;

        const targetSessionId =
            sessionId ?? this._sessionController?.value.state.currentSessionId;
        if (!targetSessionId) return;

        const state = this._repository.getSessionState(targetSessionId);
        if (state.messages.length === 0) {
            await this._loadFromPersistence(targetSessionId);
        }
        this.host.requestUpdate();
    }

    /**
     * Update a single message from persistence (single-message update).
     *
     * Called by UIUpdateBus when a message record changes (e.g. streaming
     * status flips, sync status advances). Only touches the repository if the
     * message belongs to the current session — background-session messages are
     * ignored and will be reloaded on the next session switch.
     */
    async updateMessage(entityId: string): Promise<void> {
        if (!this._persistence || !this._repository || !this._sessionController) return;

        const currentSessionId = this._sessionController.value.state.currentSessionId;
        if (!currentSessionId) return;

        const localMsg = await this._persistence.getMessage(entityId);
        if (!localMsg) return;

        // Ignore messages that belong to a different session
        if (localMsg.session_client_id !== currentSessionId) return;

        const uiMessage = this._localMessageToUI(localMsg);
        const state = this._repository.getSessionState(currentSessionId);
        const messages = this._upsertMessage(state.messages, uiMessage);
        this._repository.updateMessages(currentSessionId, messages);
        this.host.requestUpdate();
    }

    /**
     * Fetch initial messages for a session (if repository doesn't have data yet).
     * Called by rtc-message-list in connectedCallback.
     */
    async fetchInitialMessages(sessionId: string) {
        if (!this._repository) return;

        const state = this._repository.getSessionState(sessionId);
        if (state.messages.length === 0) {
            await this._loadFromPersistence(sessionId);
        }
    }

    /**
     * Load the first page of messages from persistence into the repository.
     *
     * Uses `repository.fetchMessages()` (not `updateMessages()`) so that the
     * repository correctly sets `hasMore` based on the returned page size and
     * resets `isLoadingMore`. The oldest offset is tracked inside the
     * `fetchMessages` closure set up in the `persistence` setter.
     */
    private async _loadFromPersistence(sessionId: string) {
        if (!this._persistence || !this._repository) return;

        try {
            await this._repository.fetchMessages(sessionId);
        } catch (error) {
            console.error('[MessageController] Failed to load messages:', error);
        }
    }

    private async _sendMessage(content: ContentData) {
        if (!this._persistence) {
            console.error('[MessageController] persistence not set');
            return;
        }

        const messageClientId = crypto.randomUUID();

        // Determine session: use current session if set, otherwise create a new one.
        let sessionClientId: string;
        if (this._sessionController) {
            const currentSessionId =
                this._sessionController.value.state.currentSessionId;
            sessionClientId = currentSessionId ?? crypto.randomUUID();
        } else {
            sessionClientId = crypto.randomUUID();
        }

        // Write to persistence (local-first + background sync).
        const result = await this._persistence.sendMessage({
            content,
            messageClientId,
            sessionClientId,
        });

        // Update session in SessionController (upsert + select).
        // Only update if the user hasn't moved to a different session in the meantime.
        if (this._sessionController) {
            const currentSessionId =
                this._sessionController.value.state.currentSessionId;
            // Only set if: no current session, or current session matches what we're updating
            if (!currentSessionId || currentSessionId === result.session.client_id) {
                const uiSession: Session = {
                    clientId: result.session.client_id,
                    title: result.session.title || '',
                    createdAt: new Date(result.session.created_at).getTime(),
                    updatedAt: new Date(result.session.updated_at).getTime(),
                    todoList: result.session.todo_list,
                };
                this._sessionController.actions.setCurrentSession(uiSession);

                // Reload messages from persistence to reflect the just-written message.
                if (this._repository) {
                    await this._loadFromPersistence(result.session.client_id);
                    this.host.requestUpdate();
                }
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
     * Resend a failed message (preserves original client_id for idempotent retry).
     */
    private async _resendMessage(messageClientId: string, content: ContentData) {
        if (!this._persistence) {
            console.error('[MessageController] persistence not set');
            return;
        }

        // Must use the current session (resend always happens within an existing session)
        const sessionClientId = this._sessionController?.value.state.currentSessionId;
        if (!sessionClientId) {
            console.error('[MessageController] cannot resend: no current session');
            return;
        }

        // Call persistence with the same messageClientId (idempotent retry)
        const result = await this._persistence.sendMessage({
            content,
            messageClientId,
            sessionClientId,
        });

        // Reload message list to reflect status change
        if (this._repository) {
            await this._loadFromPersistence(sessionClientId);
            this.host.requestUpdate();
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
     * Fork a conversation: create a new session branched from an existing message.
     *
     * Like `_sendMessage`, after the fork we call `setCurrentSession` so that
     * `_ensureTabForSession` can immediately locate the new session for title
     * updates.
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
            console.error('[MessageController] persistence not set');
            return;
        }

        // Delegate to the persistence layer
        const result = await this._persistence.forkSession({
            oldSessionClientId: params.oldSessionClientId,
            oldMessageClientId: params.oldMessageClientId,
            newSessionClientId: params.newSessionClientId,
            newMessageClientId: params.newMessageClientId,
            content: params.content,
            limit: params.limit,
        });

        // Add the new session to the sessions list and mark it as current
        // (mirrors _sendMessage so _ensureTabForSession can locate it immediately)
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

        // Load the new session's messages
        if (this._repository) {
            await this._loadFromPersistence(result.session.client_id);
            this.host.requestUpdate();
        }

        // Notify external listeners
        this.host.dispatchEvent(
            new CustomEvent('rtc-message-sent', {
                bubbles: true,
                composed: true,
                detail: {message: result.message},
            })
        );
    }

    /**
     * Evict a session in the repository.
     *
     * Called when a Tab is closed or a session should no longer be tracked.
     */
    evictSession(sessionId: string) {
        this._repository?.evictSession(sessionId);
    }

    /**
     * Load older messages (backward pagination) for the current session.
     * Delegates to repository.
     */
    async loadMore(): Promise<void> {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (!currentSessionId || !this._repository) return;

        await this._repository.loadMore(currentSessionId);
        this.host.requestUpdate();
    }

    /**
     * Load older messages for a specific session (supports background sessions).
     * Delegates to repository.
     */
    async loadMoreForSession(sessionId: string): Promise<void> {
        if (!this._repository) return;
        await this._repository.loadMore(sessionId);
        this.host.requestUpdate();
    }

    /**
     * Get user message history for a session (for up/down arrow input navigation).
     *
     * Returns plain-text contents in reverse chronological order (newest first).
     * Queries the PersistenceLayer directly.
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
            console.warn('[MessageController] getUserMessageHistory failed:', error);
            return [];
        }
    }

    /**
     * Extract plain text from a stored message content string.
     *
     * Storage formats:
     * - New (post-fix): full ContentData JSON, e.g.
     *   '{"type":"user_message","data":{"text":"..."}}'
     * - Legacy: plain text or bare data object, e.g. '{"text":"..."}'
     * - Plain text: returned as-is
     */
    private _extractTextFromContent(content: string | undefined): string {
        if (!content) return '';
        try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object') {
                // New format: full ContentData (has `type`)
                if ('type' in parsed) {
                    if (parsed.type === 'text' || parsed.type === 'markdown' || parsed.type === 'thinking') {
                        return parsed.data ?? '';
                    } else if (parsed.type === 'user_message') {
                        // user_message: text lives under data.text
                        return parsed.data?.text ?? '';
                    }
                } else {
                    // Legacy format without `type`; try common fields.
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

    /**
     * Helper: replace an existing message (by clientId) or insert+sort.
     */
    private _upsertMessage(messages: Message[], updated: Message): Message[] {
        const index = messages.findIndex(m => m.clientId === updated.clientId);
        if (index >= 0) {
            return [...messages.slice(0, index), updated, ...messages.slice(index + 1)];
        }
        return [...messages, updated].sort((a, b) => a.timestamp - b.timestamp);
    }

    private _appendToLastMessage(chunk: string) {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (!currentSessionId || !this._repository) return;

        const state = this._repository.getSessionState(currentSessionId);
        const messages = [...state.messages];
        if (messages.length === 0) return;
        const last = messages[messages.length - 1];
        // Append chunk to the ContentData's data field (text type uses string data)
        const newData = typeof last.content.data === 'string'
            ? (last.content.data as string) + chunk
            : JSON.stringify(last.content.data) + chunk;
        messages[messages.length - 1] = {
            ...last,
            content: {...last.content, data: newData},
            streaming: true,
        };
        this._repository.updateMessages(currentSessionId, messages);
        this.host.requestUpdate();
    }

    private _finalizeLastMessage() {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (!currentSessionId || !this._repository) return;

        const state = this._repository.getSessionState(currentSessionId);
        const messages = [...state.messages];
        if (messages.length === 0) return;
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = {
            ...last,
            streaming: false,
        };
        this._repository.updateMessages(currentSessionId, messages);
        this.host.requestUpdate();
    }

    private _clearMessages() {
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (!currentSessionId || !this._repository) return;

        this._repository.updateMessages(currentSessionId, []);
        this.host.requestUpdate();
    }
}
