/**
 * Shared type definitions for the RTC Agent component library.
 *
 * NOTE: These are UI-layer types for rendering. Once @rtc-agent/protocol
 * is fully integrated, import canonical types from there and re-export.
 */

// Re-export ContentData and TodoItem from protocol
export type { ContentData, TodoItem } from '@rtc-agent/protocol';
import type { ContentData, TodoItem } from '@rtc-agent/protocol';

// Re-export SyncStatus from persistence (single source of truth)
export type { SyncStatus } from '@rtc-agent/persistence';
import type { SyncStatus } from '@rtc-agent/persistence';

/* ── Messages ── */

export type MessageRole = 'user' | 'assistant' | 'system';

/** 消息同步状态：pending=本地待同步, synced=已同步, failed=同步失败 */
// SyncStatus re-exported from @rtc-agent/persistence above

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
    todoList?: TodoItem[];
    /**
     * 父级 root session 的 clientId（fork 产生的子 session 指向其根 session）。
     * 为空表示该 session 本身就是 root session。
     */
    rootClientSessionId?: string;
}

/* ── Session Tree ── */

/**
 * 会话树节点（递归结构）
 *
 * root session 作为"文件夹"，子 session（通过 rootClientSessionId 关联）
 * 嵌套在 children 中。
 */
export interface SessionTreeNode {
    session: Session;
    children: SessionTreeNode[];
    isExpanded: boolean;
}

export interface SessionTreeState {
    /** 根节点列表（rootClientSessionId 为空的 session） */
    rootNodes: SessionTreeNode[];
}

export interface SessionTreeActions {
    /** 切换节点展开/折叠状态 */
    toggleExpand(sessionId: string): void;
    /** 展开指定节点 */
    expand(sessionId: string): void;
    /** 折叠指定节点 */
    collapse(sessionId: string): void;
    /** 重建整棵树（session 列表变化时调用） */
    rebuildTree(sessions: Session[]): void;
}

/* ── Session Tab ── */

/**
 * 会话 Tab 页签
 *
 * 以 sessionId 为唯一标识，同一 session 只允许开一个 tab。
 */
export interface SessionTab {
    /** Session clientId（唯一标识） */
    sessionId: string;
    /** 显示标题 */
    title: string;
    /** 标题是否为默认/占位值（空、"Untitled"、"New Chat"）。用于标题同步判断。 */
    isDefault?: boolean;
    /** 该 Session 是否尚未持久化（未发送过消息）。 */
    isUnsaved?: boolean;
}

export interface SessionTabState {
    /** 打开的 tab 列表（顺序即显示顺序） */
    tabs: SessionTab[];
    /** 当前活动 tab 的 sessionId */
    activeSessionId: string | null;
}

export interface SessionTabActions {
    /** 打开或切换到指定 session 的 tab。`options.isUnsaved` 用于新建 unsaved draft tab。 */
    openOrActivate(sessionId: string, title: string, options?: { isUnsaved?: boolean }): void;
    /** 关闭指定 tab。若关闭的是活动 tab，自动激活相邻 tab。 */
    closeTab(sessionId: string): void;
    /** 设置活动 tab */
    setActiveTab(sessionId: string | null): void;
    /** 清空所有 tab */
    clearAll(): void;
    /** 用 sessions 中的最新标题同步已有 Tab 的标题 */
    updateTabTitles(sessionTitleMap: Map<string, string>): void;
    /** 将指定 tab 标记为已保存。 */
    markSaved(sessionId: string): void;
    /** 查找当前 unsaved tab，返回第一个 isUnsaved === true 的 tab。 */
    findUnsavedTab(): SessionTab | undefined;
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
    /** 创建新 session 并设为 current。返回新 session 的 clientId（同步可得，规避 context 异步传播）。 */
    createSession(): string;

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
    /** Whether there are older messages available to load */
    hasMore: boolean;
    /** Whether a loadMore request is in progress */
    isLoadingMore: boolean;
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

    /** 加载更多历史消息（向上翻页） */
    loadMore(): Promise<void>;
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

/* ── File Explorer & Editor (Phase 1) ── */

/**
 * Activity Bar 的活动类型
 *
 * - files: 资源管理器（文件树 + 编辑器）
 * - chat: 聊天模式（当前主界面）
 * - settings: 设置（底部）
 */
export type Activity = 'files' | 'chat' | 'settings';

/**
 * 文件树节点（递归结构）
 *
 * 对应 VirtualFS 的目录/文件条目。`children` 为 undefined 表示"未加载"
 * （懒加载语义），与空数组（空目录）区分。
 */
export interface FileNode {
    /** 绝对路径，如 '/scenarios/checkout.md' */
    path: string;
    /** 文件名（不含路径） */
    name: string;
    /** 节点类型 */
    type: 'file' | 'folder';
    /** 子节点。仅 folder 有意义；undefined 表示尚未加载。 */
    children?: FileNode[];
    /** 是否展开。仅 folder 有意义。 */
    isExpanded?: boolean;
    /** 是否正在懒加载子节点。仅 folder 有意义。 */
    isLoading?: boolean;
}

/**
 * 编辑器视图模式
 *
 * - edit: 仅显示编辑面板
 * - preview: 仅显示预览面板
 * - split: 左右分屏（中间可拖动分割条）
 */
export type EditorViewMode = 'edit' | 'preview' | 'split';

/**
 * 编辑器标签页
 *
 * 以 filePath 为唯一标识，同一路径只允许开一个 tab。
 */
export interface EditorTab {
    /** 文件路径（唯一标识） */
    filePath: string;
    /** 当前编辑内容 */
    content: string;
    /** 是否有未保存修改 */
    isDirty: boolean;
    /** 光标位置（行号 / 列号，均 1-based） */
    cursorPosition: {line: number; column: number};
    /** 当前 tab 的视图模式（每个 tab 独立） */
    viewMode: EditorViewMode;
}

/**
 * 状态栏显示信息
 *
 * 由 StatusBarController 从 EditorAreaController 派生，
 * 供 rtc-status-bar 组件渲染。
 */
export interface StatusBarInfo {
    /** 文件类型标签（如 "Markdown"、"JavaScript"） */
    fileType: string;
    /** 编码（固定 "UTF-8"，后续可扩展） */
    encoding: string;
    /** 光标位置（行号 / 列号，均 1-based） */
    cursor: {line: number; column: number};
    /** 保存状态：saved=已保存，unsaved=有未保存修改，none=无文件打开 */
    saveStatus: 'saved' | 'unsaved' | 'none';
}

