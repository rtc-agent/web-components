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
import {MessageRepository} from '../repositories/index.js';

export class MessageController implements ReactiveController {
    host: ReactiveControllerHost & EventTarget;

    private _state: MessageState = {messages: [], hasMore: false, isLoadingMore: false};

    /** Oldest loaded cursor for backward pagination. Format: "${timestamp}|${clientId}" */
    private _oldestLoadedCursor?: string;

    /** Message repository for multi-session support. */
    private _repository?: MessageRepository;

    /** Persistence layer — injected by root component after construction. */
    private _persistence?: PersistenceLayer;

    /** Session controller — injected by root component after construction. */
    private _sessionController?: SessionController;

    readonly actions: MessageActions;

    /** Setter for persistence injection (avoids circular deps). */
    set persistence(layer: PersistenceLayer) {
        this._persistence = layer;
        // Initialize repository when persistence is set
        if (!this._repository) {
            this._repository = new MessageRepository({
                fetchMessages: async (sessionId: string) => {
                    if (!this._persistence) return [];
                    const messages = await this._persistence.listMessages(sessionId, undefined, 50, 'backward');
                    // Track pagination cursors using (created_at, client_id) composite key
                    if (messages.length > 0) {
                        this._repository?.setOldestOffset(sessionId, this._buildCursor(messages[0]));
                        this._repository?.setNewestOffset(sessionId, this._buildCursor(messages[messages.length - 1]));
                    }
                    return messages.map(m => this._localMessageToUI(m));
                },
                fetchOlderMessages: async (sessionId: string, beforeCursor?: string) => {
                    if (!this._persistence) return [];
                    const messages = await this._persistence.listMessages(sessionId, beforeCursor, 50, 'backward');
                    // Update pagination cursor
                    if (messages.length > 0) {
                        this._repository?.setOldestOffset(sessionId, this._buildCursor(messages[0]));
                    }
                    return messages.map(m => this._localMessageToUI(m));
                },
                fetchNewerMessages: async (sessionId: string, afterCursor?: string) => {
                    if (!this._persistence) return [];
                    const messages = await this._persistence.listMessages(sessionId, afterCursor, 50, 'forward');
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
        return {
            state: this._state,
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
        const msg: Message = {
            clientId: `msg-${Date.now()}-assistant`,
            role: 'assistant',
            content: {type: 'text', data: content},
            timestamp: Date.now(),
            syncStatus: 'synced',
        };
        this._state = {messages: [...this._state.messages, msg], hasMore: this._state.hasMore, isLoadingMore: this._state.isLoadingMore};

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
     * @param entityId - Message client ID
     */
    async updateMessageFromBus(entityId: string): Promise<void> {
        if (!this._persistence || !this._repository) return;

        // Get the message from DB to find its session
        const localMsg = await this._persistence.getMessage(entityId);
        if (!localMsg) {
            console.debug(`[MessageController.updateMessageFromBus] message not found in DB: ${entityId}`);
            return;
        }

        const messageSessionId = localMsg.session_client_id;
        if (!messageSessionId) {
            console.debug(`[MessageController.updateMessageFromBus] message has no session_client_id: ${entityId}`);
            return;
        }

        // Convert DB message to UI format
        const newMsg = this._localMessageToUI(localMsg);

        // Try to patch existing message, or append if new
        const patched = this._repository.patchMessage(messageSessionId, entityId, () => newMsg);
        if (!patched) {
            // Message not in repository yet - append it
            const current = this._repository.getSessionState(messageSessionId);
            const messages = [...current.messages, newMsg].sort((a, b) => a.timestamp - b.timestamp);
            this._repository.updateMessages(messageSessionId, messages);
        }

        // Also update legacy state if this is the current session
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (messageSessionId === currentSessionId) {
            const index = this._state.messages.findIndex(m => m.clientId === entityId);
            if (index !== -1) {
                const newMessages = [...this._state.messages];
                newMessages[index] = newMsg;
                this._state = {...this._state, messages: newMessages};
            } else {
                // New message - append to legacy state
                const messages = [...this._state.messages, newMsg].sort((a, b) => a.timestamp - b.timestamp);
                this._state = {...this._state, messages};
            }
        }

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
                // Update the repository for the session this message actually belongs to
                // (not just currentSessionId - supports multi-instance where multiple
                // rtc-message-list components can be active simultaneously)
                const messageSessionId = localMsg.session_client_id;

                const newMsg = this._localMessageToUI(localMsg);

                // Update repository state for this message's session
                if (this._repository && messageSessionId) {
                    const currentState = this._repository.getSessionState(messageSessionId);
                    const existed = currentState.messages.some((m) => m.clientId === entityId);
                    let messages: Message[];
                    if (existed) {
                        messages = currentState.messages.map((m) => m.clientId === entityId ? newMsg : m);
                    } else {
                        // 添加新消息并按时间排序
                        messages = [...currentState.messages, newMsg].sort((a, b) => a.timestamp - b.timestamp);
                    }
                    this._repository.updateMessages(messageSessionId, messages);
                }

                // Also update legacy state if this is the current session
                // (for MessageContext consumers like rtc-input-area)
                const currentSessionId = this._sessionController?.value.state.currentSessionId;
                if (messageSessionId === currentSessionId) {
                    const existed = this._state.messages.some((m) => m.clientId === entityId);
                    let messages: Message[];
                    if (existed) {
                        messages = this._state.messages.map((m) => m.clientId === entityId ? newMsg : m);
                    } else {
                        messages = [...this._state.messages, newMsg].sort((a, b) => a.timestamp - b.timestamp);
                    }
                    this._state = {messages, hasMore: this._state.hasMore, isLoadingMore: this._state.isLoadingMore};
                }

                this.host.requestUpdate();
            }
        } else {
            const currentSessionId =
                this._sessionController?.value.state.currentSessionId;
            if (currentSessionId) {
                await this._reloadFromDB(currentSessionId);
            }
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
            console.log('[MessageController._sendMessage] currentSessionId before:', currentSessionId);
            sessionClientId = currentSessionId ?? crypto.randomUUID();
            console.log('[MessageController._sendMessage] sessionClientId to use:', sessionClientId, currentSessionId ? '(existing)' : '(NEW)');
        } else {
            sessionClientId = crypto.randomUUID();
            console.log('[MessageController._sendMessage] No sessionController, created new sessionClientId:', sessionClientId);
        }

        // Write to persistence (local-first + background sync).
        const result = await this._persistence.sendMessage({
            content,
            messageClientId,
            sessionClientId,
        });
        console.log('[MessageController._sendMessage] persistence.sendMessage returned:');
        console.log('  session.client_id:', result.session.client_id);
        console.log('  message.session_client_id:', result.message.session_client_id);

        // Update session in SessionController (upsert + select).
        // Only update if the user hasn't moved to a different session in the meantime.
        if (this._sessionController) {
            const currentSessionId =
                this._sessionController.value.state.currentSessionId;
            console.log('[MessageController._sendMessage] currentSessionId after persistence:', currentSessionId, 'result.session.client_id:', result.session.client_id);
            // Only set if: no current session, or current session matches what we're updating
            if (!currentSessionId || currentSessionId === result.session.client_id) {
                const uiSession: Session = {
                    clientId: result.session.client_id,
                    title: result.session.title || '',
                    createdAt: new Date(result.session.created_at).getTime(),
                    updatedAt: new Date(result.session.updated_at).getTime(),
                    todoList: result.session.todo_list,
                };
                console.log('[MessageController._sendMessage] setCurrentSession:', uiSession.clientId, 'title:', `"${uiSession.title}"`);
                this._sessionController.actions.setCurrentSession(uiSession);

                // Reload messages from DB to reflect the just-written message.
                await this._reloadFromDB(result.session.client_id);
                console.log('[MessageController._sendMessage] _reloadFromDB completed');
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
     * 重新发送失败的消息（保留原 client_id 实现幂等重试）
     */
    private async _resendMessage(messageClientId: string, content: ContentData) {
        if (!this._persistence) {
            console.error('[MessageController] persistence not set');
            return;
        }

        // 必须使用当前 session（重发必须在已有 session 中）
        const sessionClientId = this._sessionController?.value.state.currentSessionId;
        if (!sessionClientId) {
            console.error('[MessageController] cannot resend: no current session');
            return;
        }

        // 使用相同的 messageClientId 调用 persistence（幂等重试）
        const result = await this._persistence.sendMessage({
            content,
            messageClientId,
            sessionClientId,
        });

        // 重新加载消息列表以反映状态变化
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
     * 分叉对话：基于旧消息创建新 session
     *
     * 注意：与 _sendMessage 一样，fork 完成后需要调用 setCurrentSession
     * 将新 session 加入 sessions 列表，否则 _ensureTabForSession 无法
     * 立即找到该 session 来获取真实标题。
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

        // 调用 persistence 层的 forkSession
        const result = await this._persistence.forkSession({
            oldSessionClientId: params.oldSessionClientId,
            oldMessageClientId: params.oldMessageClientId,
            newSessionClientId: params.newSessionClientId,
            newMessageClientId: params.newMessageClientId,
            content: params.content,
            limit: params.limit,
        });

        // 将新 session 加入 sessions 列表并设为 currentSession
        // （与 _sendMessage 保持一致，确保 _ensureTabForSession 能立即找到）
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

        // 重新加载新 session 的消息列表
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

        // Load the latest 50 messages (backward = from newest)
        const PAGE_SIZE = 50;
        const localMessages = await this._persistence.listMessages(
            sessionClientId, undefined, PAGE_SIZE, 'backward'
        );
        const messages = localMessages.map((m) => this._localMessageToUI(m));

        // Track pagination state using (created_at, client_id) composite cursor
        const hasMore = localMessages.length >= PAGE_SIZE;
        this._oldestLoadedCursor = localMessages.length > 0
            ? this._buildCursor(localMessages[0])
            : undefined;

        // Update legacy state (for MessageContext consumers like rtc-input-area)
        this._state = {messages, hasMore, isLoadingMore: false};

        // Update repository (for rtc-message-list subscription)
        // IMPORTANT: Must set hasMore explicitly — updateMessages only replaces messages array.
        // Without this, repository keeps hasMore=false (from DEFAULT_STATE), and
        // rtc-message-list won't trigger loadMore when user scrolls to top.
        if (this._repository) {
            this._repository.updateMessages(sessionClientId, messages);
            this._repository.setHasMore(sessionClientId, hasMore);
            if (this._oldestLoadedCursor !== undefined) {
                this._repository.setOldestOffset(sessionClientId, this._oldestLoadedCursor);
            }
            // Also set newestOffset so forward pagination cursor is correct
            if (localMessages.length > 0) {
                this._repository.setNewestOffset(
                    sessionClientId,
                    this._buildCursor(localMessages[localMessages.length - 1])
                );
            }
        }

        this.host.requestUpdate();
    }

    /**
     * Load older messages (backward pagination).
     * Prepends older messages to the existing list.
     */
    async loadMore(): Promise<void> {
        if (!this._persistence || !this._state.hasMore || this._state.isLoadingMore) {
            return;
        }

        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (!currentSessionId || this._oldestLoadedCursor === undefined) {
            return;
        }

        this._state = {...this._state, isLoadingMore: true};
        this.host.requestUpdate();

        try {
            const PAGE_SIZE = 50;
            const olderMessages = await this._persistence.listMessages(
                currentSessionId,
                this._oldestLoadedCursor,
                PAGE_SIZE,
                'backward'
            );

            const newMessages = olderMessages.map((m) => this._localMessageToUI(m));

            // Prepend older messages
            const allMessages = [...newMessages, ...this._state.messages];

            // Update pagination state
            const hasMore = olderMessages.length >= PAGE_SIZE;
            if (olderMessages.length > 0) {
                this._oldestLoadedCursor = this._buildCursor(olderMessages[0]);
            }

            this._state = {
                messages: allMessages,
                hasMore,
                isLoadingMore: false,
            };
            this.host.requestUpdate();
        } catch (error) {
            console.error('[MessageController] loadMore failed:', error);
            this._state = {...this._state, isLoadingMore: false};
            this.host.requestUpdate();
        }
    }

    /**
     * 获取当前 session 的用户消息历史（用于输入框上下箭头导航）
     *
     * 返回纯文本内容数组，按时间倒序（最新消息在前）。
     * 通过 PersistenceLayer 查询。
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
     * 从消息 content 中提取纯文本
     *
     * content 存储格式：
     * - 新格式（修复后）：完整的 ContentData JSON，如 '{"type":"user_message","data":{"text":"..."}}'
     * - 旧格式（历史数据）：纯文本字符串或只有 data 的对象，如 '{"text":"..."}'
     * - 纯文本：直接返回
     */
    private _extractTextFromContent(content: string | undefined): string {
        if (!content) return '';
        try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object') {
                // 新格式：完整的 ContentData（包含 type 字段）
                if ('type' in parsed) {
                    if (parsed.type === 'text' || parsed.type === 'markdown' || parsed.type === 'thinking') {
                        return parsed.data ?? '';
                    } else if (parsed.type === 'user_message') {
                        // user_message 类型：从 data.text 中提取
                        return parsed.data?.text ?? '';
                    }
                } else {
                    // 旧格式：没有 type 字段，尝试从常见字段提取
                    // 兼容历史 user_message 数据：{"text":"...","scenarios":[...]}
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
        const messages = [...this._state.messages];
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
        this._state = {messages, hasMore: this._state.hasMore, isLoadingMore: this._state.isLoadingMore};

        // Update repository for the current session
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (this._repository && currentSessionId) {
            this._repository.updateMessages(currentSessionId, messages);
        }

        this.host.requestUpdate();
    }

    private _finalizeLastMessage() {
        const messages = [...this._state.messages];
        if (messages.length === 0) return;
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = {
            ...last,
            streaming: false,
        };
        this._state = {messages, hasMore: this._state.hasMore, isLoadingMore: this._state.isLoadingMore};

        // Update repository for the current session
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (this._repository && currentSessionId) {
            this._repository.updateMessages(currentSessionId, messages);
        }

        this.host.requestUpdate();
    }

    private _clearMessages() {
        this._state = {messages: [], hasMore: false, isLoadingMore: false};

        // Update repository for the current session
        const currentSessionId = this._sessionController?.value.state.currentSessionId;
        if (this._repository && currentSessionId) {
            this._repository.updateMessages(currentSessionId, []);
        }

        this.host.requestUpdate();
    }
}
