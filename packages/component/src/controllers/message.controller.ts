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

export class MessageController implements ReactiveController {
    host: ReactiveControllerHost & EventTarget;

    private _state: MessageState = {messages: []};

    /** Persistence layer — injected by root component after construction. */
    private _persistence?: PersistenceLayer;

    /** Session controller — injected by root component after construction. */
    private _sessionController?: SessionController;

    readonly actions: MessageActions;

    /** Setter for persistence injection (avoids circular deps). */
    set persistence(layer: PersistenceLayer) {
        this._persistence = layer;
    }

    /** Setter for session controller injection (avoids circular deps). */
    set sessionController(controller: SessionController) {
        this._sessionController = controller;
    }

    get value(): MessageContextValue {
        return {state: this._state, actions: this.actions};
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
        this._state = {messages: [...this._state.messages, msg]};
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
                // Only reload if the message belongs to the current session
                const currentSessionId =
                    this._sessionController?.value.state.currentSessionId;
                if (localMsg.session_client_id !== currentSessionId) {
                    return;
                }

                const newMsg = this._localMessageToUI(localMsg);
                const existed = this._state.messages.some((m) => m.clientId === entityId);
                let messages: Message[];
                if (existed) {
                    messages = this._state.messages.map((m) => m.clientId === entityId ? newMsg : m);
                } else {
                    // 添加新消息并按时间排序
                    messages = [...this._state.messages, newMsg].sort((a, b) => a.timestamp - b.timestamp);
                }
                this._state = {messages};
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
                };
                this._sessionController.actions.setCurrentSession(uiSession);

                // Reload messages from DB to reflect the just-written message.
                await this._reloadFromDB(result.session.client_id);
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

        // 切换到新 session
        if (this._sessionController) {
            this._sessionController.actions.switchSession(result.session.client_id);
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

        const localMessages = await this._persistence.listMessages(sessionClientId);
        const messages = localMessages.map((m) => this._localMessageToUI(m));
        this._state = {messages};
        this.host.requestUpdate();
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
        this._state = {messages};
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
        this._state = {messages};
        this.host.requestUpdate();
    }

    private _clearMessages() {
        this._state = {messages: []};
        this.host.requestUpdate();
    }
}
