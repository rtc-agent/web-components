/**
 * Shared type definitions for the RTC Agent component library.
 *
 * NOTE: These are UI-layer types for rendering. Once @rtc-agent/protocol
 * is fully integrated, import canonical types from there and re-export.
 */

// Re-export ContentData from protocol
export type { ContentData } from '@rtc-agent/protocol';
import type { ContentData } from '@rtc-agent/protocol';

/* ── Messages ── */

export type MessageRole = 'user' | 'assistant' | 'system';

/** 消息同步状态：pending=本地待同步, synced=已同步, failed=同步失败 */
export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface Message {
    clientId: string;
    role: MessageRole;
    content: ContentData;
    timestamp: number;
    /** Is the message still being streamed? */
    streaming?: boolean;
    /** 同步状态 */
    syncStatus: SyncStatus;
    /**
     * 父消息的 clientId。
     * toolcall_output 通过此字段指向对应的 toolcall_input。
     * 映射自协议层 Message.parent_message_id（server UUID → 解析为 client_id）。
     */
    parentClientId?: string;
}

/* ── Sessions ── */

export interface Session {
    clientId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

/* ── Modes ── */

export type Mode = 'manual' | 'edit' | 'plan' | 'auto' | 'bypass';

export interface ModeConfig {
    mode: Mode;
    label: string;
    icon: string;
    description: string;
}

/* ── Tool Calls ── */

export type ToolCallStatus = 'pending' | 'approved' | 'denied' | 'running' | 'done';

export interface ToolCall {
    id: string;
    toolName: string;
    command?: string;
    description?: string;
    parameters?: Record<string, unknown>;
    status: ToolCallStatus;
}

/* ── Window State ── */

export type WindowMode = 'normal' | 'maximized' | 'minimized';

export interface WindowState {
    mode: WindowMode;
    position: { x: number; y: number };
    size: { width: number; height: number };
    /** Snapshot before maximize/minimize for restore. */
    lastState?: {
        position: { x: number; y: number };
        size: { width: number; height: number };
    };
}

/* ── Auth ── */

export interface AuthState {
    isLoggedIn: boolean;
    accessToken?: string;
    refreshToken?: string;
    userId?: string;
    expiresAt?: number;
}

/* ── Window State Actions ── */

export interface WindowStateActions {
    setMode(mode: WindowMode): void;

    setPosition(pos: { x: number; y: number }): void;

    setSize(size: { width: number; height: number }): void;

    maximize(): void;

    minimize(): void;

    restore(): void;
}

/* ── Session Actions ── */

export interface SessionState {
    sessions: Session[];
    currentSessionId: string | null;
}

export interface SessionActions {
    createSession(): void;

    switchSession(id: string): void;

    renameSession(id: string, title: string): void;

    deleteSession(id: string): void;

    /** Reset all session state */
    reset(): void;

    /** Clear currentSessionId only (keep sessions list). Used when starting a new conversation. */
    clearCurrentSession(): void;

    /** Set current session (upsert + select). Used by MessageController after persistence write. */
    setCurrentSession(session: Session): void;

    /** Update sessions list without affecting currentSessionId. Used by UIUpdateBus subscription. */
    setSessions(sessions: Session[]): void;
}

/* ── Message Actions ── */

export interface MessageState {
    messages: Message[];
}

export interface MessageActions {
    sendMessage(content: ContentData): Promise<void>;

    /** 重新发送失败的消息（保留原 client_id 实现幂等重试） */
    resendMessage(messageClientId: string, content: ContentData): Promise<void>;

    /** 分叉对话：基于旧消息创建新 session，替换消息内容 */
    forkSession(params: {
        oldSessionClientId: string;
        oldMessageClientId: string;
        newSessionClientId: string;
        newMessageClientId: string;
        content: ContentData;
        limit?: number;
    }): Promise<void>;

    /** Called by the streaming handler as tokens arrive. */
    appendToLastMessage(chunk: string): void;

    /** Finalize the last streaming message. */
    finalizeLastMessage(): void;

    /** 清空所有消息。Session 切换时调用，也可作为用户主动操作。 */
    clearMessages(): void;
}

/* ── Mode Actions ── */

export interface ModeState {
    currentMode: Mode;
}

export interface ModeActions {
    setMode(mode: Mode): void;
}

/* ── Tool Call Actions ── */

export interface ToolCallState {
    pendingCalls: ToolCall[];
}

export interface ToolCallActions {
    approve(id: string): void;

    approveAll(toolName: string): void;

    deny(id: string): void;
}

/* ── Skill System ── */

export type {
    OpenAPISchema,
    ParameterDef,
    ReturnDef,
    VisualHooks,
    FunctionDef,
    FunctionGroupDef,
    RegistryConfig,
    ScenarioDef,
    ScenarioManifest,
} from './skill.js';

